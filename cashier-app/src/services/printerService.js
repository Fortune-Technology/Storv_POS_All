/**
 * printerService.js
 * ESC/POS receipt building and printing.
 * Supports QZ Tray (USB/Serial) and Network TCP (via backend proxy).
 */

import { connectQZ, printRaw, isQZConnected } from './qzService.js';
import api from '../api/client.js';

// ── ESC/POS command constants ─────────────────────────────────────────────
const ESC = '\x1B';
const GS  = '\x1D';
const LF  = '\x0A';
const NUL = '\x00';

export const ESCPOS = {
  INIT:           ESC + '\x40',
  CUT_FULL:       GS  + '\x56' + NUL,
  CUT_PARTIAL:    GS  + '\x56' + '\x01',
  ALIGN_LEFT:     ESC + '\x61\x00',
  ALIGN_CENTER:   ESC + '\x61\x01',
  ALIGN_RIGHT:    ESC + '\x61\x02',
  BOLD_ON:        ESC + '\x45\x01',
  BOLD_OFF:       ESC + '\x45\x00',
  DOUBLE_SIZE:    ESC + '\x21\x30',
  NORMAL_SIZE:    ESC + '\x21\x00',
  UNDERLINE_ON:   ESC + '\x2D\x01',
  UNDERLINE_OFF:  ESC + '\x2D\x00',
  DRAWER_KICK:    ESC + '\x70\x00\x19\xFA',
  FEED_3:         ESC + '\x64\x03',
};

const pad  = (str, len) => String(str || '').substring(0, len).padEnd(len);
const rpad = (str, len) => String(str || '').substring(0, len).padStart(len);
const line = (left, right, width = 42) => {
  const r = String(right || '');
  const l = String(left  || '').substring(0, width - r.length).padEnd(width - r.length);
  return l + r + LF;
};

// ── Build full receipt string ────────────────────────────────────────────
export const buildReceiptString = (receipt) => {
  // Paper width: 80mm = 42 chars, 58mm = 32 chars
  const W = receipt.paperWidth === '58mm' ? 32 : 42;
  let r = '';

  r += ESCPOS.INIT;
  r += ESCPOS.ALIGN_CENTER;

  // ── HEADER ──────────────────────────────────────────────────────────────
  r += ESCPOS.DOUBLE_SIZE + ESCPOS.BOLD_ON;
  r += (receipt.storeName || 'STORE') + LF;
  r += ESCPOS.NORMAL_SIZE + ESCPOS.BOLD_OFF;

  if (receipt.storeAddress) r += receipt.storeAddress + LF;
  if (receipt.storePhone)   r += receipt.storePhone   + LF;
  if (receipt.storeEmail)   r += receipt.storeEmail   + LF;
  if (receipt.storeWebsite) r += receipt.storeWebsite + LF;
  if (receipt.storeTaxId) {
    const label = receipt.taxIdLabel || 'Tax ID';
    r += label + ': ' + receipt.storeTaxId + LF;
  }
  if (receipt.headerLine1)  r += receipt.headerLine1  + LF;
  if (receipt.headerLine2)  r += receipt.headerLine2  + LF;

  r += LF;
  r += ESCPOS.ALIGN_LEFT;
  r += '-'.repeat(W) + LF;

  // ── TRANSACTION INFO ────────────────────────────────────────────────────
  if (receipt.showCashier !== false) {
    r += 'Cashier: ' + (receipt.cashierName || 'Cashier') + LF;
  }
  r += 'Date: ' + new Date(receipt.date || Date.now()).toLocaleString() + LF;
  if (receipt.showTransactionId !== false && receipt.invoiceNumber) {
    r += 'Ref: ' + receipt.invoiceNumber + LF;
  }
  r += '-'.repeat(W) + LF;

  // ── LINE ITEMS ─────────────────────────────────────────────────────────
  let itemCount = 0;
  (receipt.items || []).forEach(item => {
    const isLottery     = item.isLottery;
    const isBottleReturn = item.isBottleReturn;
    const prefix = isBottleReturn
      ? '♻ RETURN   '
      : isLottery
        ? (item.lotteryType === 'payout' ? '** PAYOUT  ' : '>> LOTTERY ')
        : '';
    const name  = prefix + (item.name || 'Item');
    const price = (item.lineTotal < 0 ? '-' : '') + '$' + Math.abs(item.lineTotal || 0).toFixed(2);

    if (item.qty && item.qty !== 1 && !isLottery) {
      r += name.substring(0, W) + LF;
      r += line('  ' + item.qty + ' x $' + Number(item.unitPrice || 0).toFixed(2), price, W);
    } else {
      r += line(name.substring(0, W - 10), price, W);
    }

    if (receipt.showSavings !== false && item.discountAmount) {
      r += line('  Discount', '-$' + Math.abs(item.discountAmount).toFixed(2), W);
    }
    if (!isLottery) itemCount += (item.qty || 1);
  });

  r += '-'.repeat(W) + LF;

  // ── TOTALS ──────────────────────────────────────────────────────────────
  if (receipt.subtotal   != null) r += line('Subtotal',    '$' + Number(receipt.subtotal).toFixed(2),    W);

  if (receipt.showTaxBreakdown && receipt.taxLines?.length) {
    receipt.taxLines.forEach(tl => {
      r += line('  ' + tl.label, '$' + Number(tl.amount).toFixed(2), W);
    });
  } else if (receipt.totalTax != null) {
    r += line('Tax',         '$' + Number(receipt.totalTax).toFixed(2),    W);
  }

  if (receipt.totalDeposit > 0)  r += line('Deposit/CRV', '$' + Number(receipt.totalDeposit).toFixed(2), W);
  if (receipt.showSavings !== false && receipt.discount > 0) {
    r += line('Savings',     '-$' + Number(receipt.discount).toFixed(2),   W);
  }

  // Session 51 — Dual Pricing surcharge line. Shown only when the saved
  // transaction recorded a non-zero surcharge (i.e. customer paid by card
  // on a dual_pricing store). Cash transactions print no surcharge line
  // even when the store is on dual pricing.
  const sa = Number(receipt.surchargeAmount || 0);
  const sat = Number(receipt.surchargeTaxAmount || 0);
  if (sa > 0.005) {
    const rate = Number(receipt.surchargeRate || 0);
    const fee  = Number(receipt.surchargeFixedFee || 0);
    const lbl  = `Surcharge (${rate.toFixed(2)}%${fee > 0 ? ` + $${fee.toFixed(2)}` : ''})`;
    r += line(lbl, '$' + sa.toFixed(2), W);
    if (sat > 0.005) {
      r += line('  Tax on Surcharge', '$' + sat.toFixed(2), W);
    }
  }

  r += ESCPOS.BOLD_ON;
  const totalAmt = Number(receipt.total || 0);
  r += line(totalAmt < -0.005 ? 'REFUND DUE' : 'TOTAL',
            (totalAmt < -0.005 ? '-$' : '$') + Math.abs(totalAmt).toFixed(2), W);
  r += ESCPOS.BOLD_OFF;

  // Session 51 — "You saved $X by paying cash" — only on cash receipts when
  // dual pricing is active and surcharge would have applied to a card payment.
  // The cashier app passes potentialSavings on the receipt envelope when the
  // transaction was a cash tender on a dual_pricing store.
  const savings = Number(receipt.potentialSavings || 0);
  if (savings > 0.005 && sa < 0.005) {
    r += ESCPOS.ALIGN_CENTER;
    r += LF + 'You saved $' + savings.toFixed(2) + ' by paying cash' + LF;
    r += ESCPOS.ALIGN_LEFT;
  }
  r += '-'.repeat(W) + LF;

  // ── TENDER ──────────────────────────────────────────────────────────────
  if (receipt.tenderMethod) {
    const methodLabel = receipt.tenderMethod.toUpperCase();
    r += line(methodLabel, '$' + Number(receipt.amountTendered || receipt.total || 0).toFixed(2), W);
    if (receipt.changeDue > 0) r += line('CHANGE',   '$' + Number(receipt.changeDue).toFixed(2), W);
    if (receipt.authCode)      r += line('Auth Code', receipt.authCode, W);
    if (receipt.cardType)      r += line('Card',      receipt.cardType + ' ****' + (receipt.lastFour || ''), W);
  }

  r += '-'.repeat(W) + LF;

  // ── FOOTER ──────────────────────────────────────────────────────────────
  r += ESCPOS.ALIGN_CENTER;

  // Helper: print each \n-separated line from a multi-line footer field
  const printFooterBlock = (text) => {
    if (!text) return;
    text.split('\n').forEach(ln => { if (ln.trim()) r += ln.trim() + LF; });
  };

  const footer1 = receipt.footerLine1 || receipt.footerMessage || 'Thank you! Please come again.';
  const footer2 = receipt.footerLine2 || '';
  printFooterBlock(footer1);
  printFooterBlock(footer2);

  if (receipt.showReturnPolicy && receipt.returnPolicy) {
    r += LF;
    printFooterBlock(receipt.returnPolicy);
  }

  // Session 51 — Dual Pricing disclosure block. Required by most state laws
  // when running surcharge or cash-discount programs (NY GBL § 518, etc.).
  // Always printed when dualPricingDisclosure is set on the receipt envelope,
  // regardless of tender (the customer needs to see it on cash + card both).
  if (receipt.dualPricingDisclosure) {
    r += LF;
    r += '-'.repeat(W) + LF;
    printFooterBlock(receipt.dualPricingDisclosure);
    r += '-'.repeat(W) + LF;
  }

  if (receipt.showItemCount && itemCount > 0) {
    r += LF + itemCount + ' item' + (itemCount !== 1 ? 's' : '') + ' purchased' + LF;
  }

  if (receipt.loyaltyPoints != null) {
    r += LF;
    r += ESCPOS.BOLD_ON;
    r += 'Points Earned: ' + receipt.loyaltyPoints + LF;
    r += 'Total Points: ' + (receipt.totalPoints || 0) + LF;
    r += ESCPOS.BOLD_OFF;
  }

  r += ESCPOS.FEED_3;
  r += ESCPOS.CUT_PARTIAL;

  return r;
};

// ── Kick cash drawer ────────────────────────────────────────────────────
export const kickCashDrawer = async (printerName, method = 'qz') => {
  if (method === 'qz' && printerName) {
    await printRaw(printerName, [ESCPOS.DRAWER_KICK]);
  }
};

// ── Print receipt via QZ Tray ────────────────────────────────────────────
export const printReceiptQZ = async (printerName, receipt) => {
  if (!isQZConnected()) await connectQZ();
  const data = buildReceiptString(receipt);
  await printRaw(printerName, [data]);
};

// ── Print receipt via network (backend proxy) ────────────────────────────
export const printReceiptNetwork = async (ip, port, receipt) => {
  const data = buildReceiptString(receipt);
  // Send as base64 to backend which forwards to printer TCP socket
  await api.post('/pos-terminal/print-network', {
    ip, port,
    data: btoa(unescape(encodeURIComponent(data))),
  });
};

// ─────────────────────────────────────────────────────────────────────────
// END-OF-DAY REPORT — ESC/POS template for thermal printer
// ─────────────────────────────────────────────────────────────────────────
// Input shape must match the /api/reports/end-of-day response:
//   { header, payouts[], tenders[], transactions[], reconciliation, totals }
//
// Paper width: 80mm = 42 chars (default) or 58mm = 32 chars
//
export const buildEoDReceiptString = (report, opts = {}) => {
  const W = opts.paperWidth === '58mm' ? 32 : 42;
  const money = (n) => {
    if (n == null) return '—';
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    const sign = v < 0 ? '-' : '';
    return `${sign}$${Math.abs(v).toFixed(2)}`;
  };
  const row = (left, right) => line(left, right, W);
  const divider = '-'.repeat(W) + LF;
  const hr = '='.repeat(W) + LF;

  let r = '';
  r += ESCPOS.INIT;
  r += ESCPOS.ALIGN_CENTER;

  // Header
  if (report.header.storeName) {
    r += ESCPOS.BOLD_ON + ESCPOS.DOUBLE_SIZE + report.header.storeName + LF + ESCPOS.NORMAL_SIZE + ESCPOS.BOLD_OFF;
  }
  if (report.header.storeAddress) r += report.header.storeAddress + LF;
  if (report.header.storePhone)   r += report.header.storePhone + LF;
  r += LF;
  r += ESCPOS.BOLD_ON + 'END OF DAY REPORT' + LF + ESCPOS.BOLD_OFF;
  r += hr;
  r += ESCPOS.ALIGN_LEFT;

  // Header details
  if (report.header.stationName) r += row('Register:', report.header.stationName);
  if (report.header.cashierName) r += row('Cashier:',  report.header.cashierName);
  if (report.header.shiftId)     r += row('Shift:',    String(report.header.shiftId).slice(-8));

  const fromStr = new Date(report.header.from).toLocaleString();
  const toStr   = new Date(report.header.to).toLocaleString();
  r += 'Period:' + LF;
  r += '  ' + fromStr + LF;
  r += '  ' + toStr + LF;
  r += row('Printed:', new Date(report.header.printedAt).toLocaleString());
  r += hr;

  // ── Section 1: Payouts ────────────────────────────────────────────────
  r += ESCPOS.BOLD_ON + 'PAYOUTS' + LF + ESCPOS.BOLD_OFF;
  r += divider;
  r += pad('Type', W - 18) + rpad('Count', 6) + rpad('Amount', 12) + LF;
  r += divider;
  let payoutsTotal = 0;
  for (const p of (report.payouts || [])) {
    r += pad(p.label, W - 18) + rpad(String(p.count), 6) + rpad(money(p.amount), 12) + LF;
    payoutsTotal += Number(p.amount) || 0;
  }
  r += divider;
  r += row('Payouts Total', money(payoutsTotal));
  r += LF;

  // ── Section 2: Tender Details ─────────────────────────────────────────
  r += ESCPOS.BOLD_ON + 'TENDER DETAILS' + LF + ESCPOS.BOLD_OFF;
  r += divider;
  r += pad('Type', W - 18) + rpad('Count', 6) + rpad('Amount', 12) + LF;
  r += divider;
  let tenderTotal = 0;
  for (const t of (report.tenders || [])) {
    r += pad(t.label, W - 18) + rpad(String(t.count), 6) + rpad(money(t.amount), 12) + LF;
    tenderTotal += Number(t.amount) || 0;
  }
  r += divider;
  r += row('Tender Total', money(tenderTotal));
  r += LF;

  // ── Section 3: Transactions ───────────────────────────────────────────
  r += ESCPOS.BOLD_ON + 'TRANSACTIONS' + LF + ESCPOS.BOLD_OFF;
  r += divider;
  r += pad('Type', W - 18) + rpad('Count', 6) + rpad('Amount', 12) + LF;
  r += divider;
  for (const tx of (report.transactions || [])) {
    r += pad(tx.label, W - 18) + rpad(String(tx.count), 6) + rpad(money(tx.amount), 12) + LF;
  }

  // ── Section 3b: Pass-through Fees (bag fees + bottle deposits) ────────
  const feeRows = (report.fees || []).filter(f => Math.abs(f.amount || 0) > 0.001 || (f.count || 0) > 0);
  if (feeRows.length) {
    r += LF + hr;
    r += ESCPOS.BOLD_ON + 'PASS-THROUGH FEES' + LF + ESCPOS.BOLD_OFF;
    r += 'Not revenue / not profit' + LF;
    r += divider;
    r += pad('Type', W - 18) + rpad('Count', 6) + rpad('Amount', 12) + LF;
    r += divider;
    for (const f of feeRows) {
      r += pad(f.label, W - 18) + rpad(String(f.count), 6) + rpad(money(f.amount), 12) + LF;
    }
  }

  // ── S67: Department Breakdown (opt-in via store.pos.eodReport.showDepartmentBreakdown) ──
  if (report.departments?.rows?.length) {
    r += LF + hr;
    r += ESCPOS.BOLD_ON + 'DEPARTMENT BREAKDOWN' + LF + ESCPOS.BOLD_OFF;
    r += divider;
    r += pad('Department', W - 18) + rpad('Tx', 4) + rpad('Net', 14) + LF;
    r += divider;
    for (const d of report.departments.rows) {
      r += pad(d.name, W - 18) + rpad(String(d.txCount), 4) + rpad(money(d.netSales), 14) + LF;
    }
    r += divider;
    r += ESCPOS.BOLD_ON + pad('Total', W - 18) + rpad('—', 4) + rpad(money(report.departments.total), 14) + LF + ESCPOS.BOLD_OFF;
  }

  // ── Lottery Summary (always when activity) ───────────────────────────
  // Per-game sale + payouts + net cash. Mirror of the fuel block.
  // Distinct from the cash-flow detail elsewhere in the receipt.
  if (report.lottery?.rows?.length) {
    r += LF + hr;
    r += ESCPOS.BOLD_ON + 'LOTTERY SUMMARY' + LF + ESCPOS.BOLD_OFF;
    r += divider;
    // 3-column layout: Game | Sales $ | Payouts $   (Net shown on Total row)
    r += pad('Game', W - 24) + rpad('Sales', 12) + rpad('Payouts', 12) + LF;
    r += divider;
    for (const g of report.lottery.rows) {
      r += pad(g.gameName || 'Game', W - 24)
         + rpad(money(g.saleAmount), 12)
         + rpad(money(g.payoutAmount), 12)
         + LF;
    }
    r += divider;
    r += ESCPOS.BOLD_ON
       + pad('Total', W - 24)
       + rpad(money(report.lottery.totals.saleAmount), 12)
       + rpad(money(report.lottery.totals.payoutAmount), 12)
       + LF
       + ESCPOS.BOLD_OFF;
    // Highlight the bottom-line net cash from lottery (sale − payouts)
    r += ESCPOS.BOLD_ON
       + pad('Lottery Cash (sale − payouts)', W - 12)
       + rpad(money(report.lottery.totals.netCash), 12)
       + LF
       + ESCPOS.BOLD_OFF;
  }

  // ── Section 4: Fuel Sales (only when fuel sales exist) ────────────────
  if (report.fuel?.rows?.length) {
    r += LF + hr;
    r += ESCPOS.BOLD_ON + 'FUEL SALES' + LF + ESCPOS.BOLD_OFF;
    r += divider;
    r += pad('Type', W - 22) + rpad('Gal', 9) + rpad('Amount', 13) + LF;
    r += divider;
    for (const f of report.fuel.rows) {
      const label = (f.name || 'Fuel') + (f.gradeLabel ? ' ' + f.gradeLabel : '');
      r += pad(label, W - 22) + rpad(Number(f.netGallons).toFixed(3), 9) + rpad(money(f.netAmount), 13) + LF;
    }
    r += divider;
    r += ESCPOS.BOLD_ON
      + pad('Total', W - 22)
      + rpad(Number(report.fuel.totals.gallons).toFixed(3), 9)
      + rpad(money(report.fuel.totals.amount), 13)
      + LF
      + ESCPOS.BOLD_OFF;
    // Highlight the bottom-line net cash from fuel (sale − refunds)
    r += ESCPOS.BOLD_ON
      + pad('Fuel Total (sale − refunds)', W - 13)
      + rpad(money(report.fuel.totals.amount), 13)
      + LF
      + ESCPOS.BOLD_OFF;
  }

  // ── Section 5: Dual Pricing (only when store ran dual_pricing) ────────
  if (report.dualPricing) {
    r += LF + hr;
    r += ESCPOS.BOLD_ON + 'DUAL PRICING SUMMARY' + LF + ESCPOS.BOLD_OFF;
    r += divider;
    r += row('Card Tx Surcharged',    String(report.dualPricing.surchargedTxCount));
    r += row('Cash/EBT (No Surcharge)', String(report.dualPricing.cashTxOnDualCount));
    r += row('Surcharge Collected',   money(report.dualPricing.surchargeCollected));
    if (report.dualPricing.surchargeTaxCollected > 0.005) {
      r += row('Tax on Surcharge',    money(report.dualPricing.surchargeTaxCollected));
    }
    r += divider;
    r += ESCPOS.BOLD_ON + row('Total Surcharge', money(report.dualPricing.surchargeTotal)) + ESCPOS.BOLD_OFF;
    if (report.dualPricing.cashSavingsTotal > 0.005) {
      r += row('Customer Savings',    money(report.dualPricing.cashSavingsTotal));
    }
  }

  // ── S67: Standalone Lottery section. Only when settings.lotterySeparateFromDrawer=true. ──
  if (report.settings?.lotterySeparateFromDrawer && report.reconciliation?.lottery) {
    const L = report.reconciliation.lottery;
    const anyActivity = L.ticketMathSales > 0 || L.posLotterySales > 0 ||
                        L.machineDrawSales > 0 || L.machineCashings > 0 || L.instantCashings > 0;
    if (anyActivity) {
      r += LF + hr;
      r += ESCPOS.BOLD_ON + 'LOTTERY CASH FLOW' + LF + ESCPOS.BOLD_OFF;
      r += '(separate from drawer)' + LF;
      r += divider;
      if (L.ticketMathSales > 0)  r += row('Ticket-math Sales',     money(L.ticketMathSales));
      if (L.posLotterySales > 0)  r += row('POS-Recorded Sales',    money(L.posLotterySales));
      if (L.unreportedCash > 0)   r += row('+ Un-rung Tickets',     money(L.unreportedCash));
      if (L.machineDrawSales > 0) r += row('+ Machine Draw Sales',  money(L.machineDrawSales));
      if (L.machineCashings > 0)  r += row('- Machine Cashings',    money(L.machineCashings));
      if (L.instantCashings > 0)  r += row('- Instant Cashings',    money(L.instantCashings));
      r += divider;
      r += ESCPOS.BOLD_ON + row('= Net Lottery Cash', money(L.netLotteryCash)) + ESCPOS.BOLD_OFF;
    }
  }

  // ── Reconciliation (shift only) ───────────────────────────────────────
  if (report.reconciliation) {
    r += LF + hr;
    r += ESCPOS.BOLD_ON + 'CASH RECONCILIATION' + LF + ESCPOS.BOLD_OFF;
    r += divider;
    r += row('Opening',     money(report.reconciliation.openingAmount));
    r += row('+ Cash Sales',money(report.reconciliation.cashCollected));
    if (report.reconciliation.cashIn != null && report.reconciliation.cashIn > 0) {
      r += row('+ Cash In',  money(report.reconciliation.cashIn));
    }
    r += row('- Drops',     money(report.reconciliation.cashDropsTotal));
    r += row('- Cash Out',  money(report.reconciliation.cashOut ?? report.reconciliation.cashPayoutsTotal));
    r += divider;
    r += ESCPOS.BOLD_ON + row('Expected',   money(report.reconciliation.expectedInDrawer)) + ESCPOS.BOLD_OFF;
    if (report.reconciliation.closingAmount != null) {
      r += row('Counted',     money(report.reconciliation.closingAmount));
      r += ESCPOS.BOLD_ON + row('Variance',   money(report.reconciliation.variance)) + ESCPOS.BOLD_OFF;
    }
  }

  r += LF + hr;
  r += ESCPOS.ALIGN_CENTER;
  r += 'End of Report' + LF;
  r += ESCPOS.FEED_3;
  r += ESCPOS.CUT_PARTIAL;
  return r;
};

// ── Print EoD report — routes through QZ Tray (USB) or network-proxy ─────
// Mirrors printReceiptQZ / printReceiptNetwork so the cashier-app can use
// whichever printer transport is configured in hardware settings.
export const printEoDReportQZ = async (printerName, report, paperWidth = '80mm') => {
  if (!isQZConnected()) await connectQZ();
  const data = buildEoDReceiptString(report, { paperWidth });
  await printRaw(printerName, [data]);
};

export const printEoDReportNetwork = async (ip, port, report, paperWidth = '80mm') => {
  const data = buildEoDReceiptString(report, { paperWidth });
  await api.post('/pos-terminal/print-network', {
    ip, port,
    data: btoa(unescape(encodeURIComponent(data))),
  });
};

// Top-level convenience dispatcher — picks transport based on config
export const printEoDReport = async (config, report) => {
  const method     = config?.receiptPrinter?.method || 'qz';
  const qzName     = config?.receiptPrinter?.qzName || config?.receiptPrinter?.name;
  const ip         = config?.receiptPrinter?.ip;
  const port       = config?.receiptPrinter?.port || 9100;
  const paperWidth = config?.receiptPrinter?.paperWidth || '80mm';

  if (method === 'network') {
    if (!ip) throw new Error('Receipt printer network IP not configured');
    await printEoDReportNetwork(ip, port, report, paperWidth);
    return;
  }
  if (!qzName) throw new Error('Receipt printer name not configured');
  await printEoDReportQZ(qzName, report, paperWidth);
};

// ─────────────────────────────────────────────────────────────────────────
// S77 (C9) — CASH DRAWER EVENT RECEIPT — ESC/POS template
// ─────────────────────────────────────────────────────────────────────────
// Single template covers all 5 event types via the `kind` field. Every type
// shares the layout (header → banner → meta → body → amount → signature →
// footer); body fields vary per kind, signature only renders on the house
// copy.
//
// Branding: full legal-entity header (name + address + phone + tax id).
// Skips the customer-facing receipt extras (marketing header lines, return
// policy, "thank you" footer) since these are internal/audit documents.
//
// Input shape (caller assembles from the persisted CashDrop / CashPayout):
//   {
//     kind: 'cash_drop' | 'cash_in' | 'vendor_payout' | 'loan' | 'received_on_account',
//     amount: number,
//     referenceNumber: string,    // e.g. 'VP-20260504-003'
//     createdAt: Date | string,
//     cashierName: string,
//     stationName?: string,
//     shiftId?: string,
//     vendorName?: string,         // vendor_payout only
//     payoutType?: string,         // 'expense' | 'merchandise'
//     tenderMethod?: string,       // 'cash' / 'cheque' / etc.
//     customerName?: string,       // received_on_account only
//     recipient?: string,          // loan only — free-text
//     note?: string,
//     copyLabel?: 'STORE COPY' | 'VENDOR COPY' | 'CUSTOMER COPY' | null,
//     showSignatureLine?: boolean, // true = house copy
//   }
// Plus header fields piped from storeBranding:
//   storeName, storeAddress, storePhone, storeTaxId, taxIdLabel, paperWidth
//
const KIND_BANNER = {
  cash_drop:           'CASH DROP',
  cash_in:             'CASH IN / PAID-IN',
  vendor_payout:       'VENDOR PAYOUT',
  loan:                'CASHIER LOAN',
  received_on_account: 'RECEIVED ON ACCOUNT',
};
const KIND_DIRECTION = {
  cash_drop:           'OUT',  // money OUT of drawer to safe
  cash_in:             'IN',   // money INTO drawer
  vendor_payout:       'OUT',  // money OUT to vendor
  loan:                'OUT',  // money OUT (cashier advance)
  received_on_account: 'IN',   // money IN (customer paying balance)
};

export const buildCashEventReceiptString = (event, opts = {}) => {
  const W = (event.paperWidth === '58mm' || opts.paperWidth === '58mm') ? 32 : 42;
  const money = (n) => {
    if (n == null) return '—';
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return `$${Math.abs(v).toFixed(2)}`;
  };
  const row      = (left, right) => line(left, right, W);
  const divider  = '-'.repeat(W) + LF;
  const hr       = '='.repeat(W) + LF;

  const kind     = event.kind || 'cash_drop';
  const banner   = KIND_BANNER[kind]    || 'CASH DRAWER EVENT';
  const direction = KIND_DIRECTION[kind] || 'OUT';

  let r = '';
  r += ESCPOS.INIT;
  r += ESCPOS.ALIGN_CENTER;

  // ── HEADER (legal entity / invoice-style branding) ─────────────────────
  if (event.storeName) {
    r += ESCPOS.BOLD_ON + ESCPOS.DOUBLE_SIZE;
    r += event.storeName + LF;
    r += ESCPOS.NORMAL_SIZE + ESCPOS.BOLD_OFF;
  }
  if (event.storeAddress) r += event.storeAddress + LF;
  if (event.storePhone)   r += event.storePhone   + LF;
  if (event.storeTaxId) {
    const label = event.taxIdLabel || 'Tax ID';
    r += label + ': ' + event.storeTaxId + LF;
  }
  r += LF;

  // ── EVENT BANNER ────────────────────────────────────────────────────────
  r += ESCPOS.BOLD_ON + ESCPOS.DOUBLE_SIZE;
  r += '*** ' + banner + ' ***' + LF;
  r += ESCPOS.NORMAL_SIZE + ESCPOS.BOLD_OFF;
  r += hr;
  r += ESCPOS.ALIGN_LEFT;

  // ── META (ref / date / cashier / register / shift) ─────────────────────
  if (event.referenceNumber) {
    r += row('Ref:',      event.referenceNumber);
  }
  const ts = event.createdAt ? new Date(event.createdAt) : new Date();
  r += row('Date:',     ts.toLocaleString());
  if (event.cashierName) r += row('Cashier:',  event.cashierName);
  if (event.stationName) r += row('Register:', event.stationName);
  if (event.shiftId)     r += row('Shift:',    String(event.shiftId).slice(-8));

  r += divider;

  // ── BODY (type-specific fields) ────────────────────────────────────────
  if (kind === 'vendor_payout') {
    if (event.payoutType) {
      const ptypeLabel = event.payoutType === 'merchandise' ? 'Merchandise' : 'Expense';
      r += row('Type:',   ptypeLabel);
    }
    if (event.vendorName)   r += row('Vendor:',  event.vendorName);
    if (event.tenderMethod) r += row('Tender:',  event.tenderMethod);
  } else if (kind === 'loan') {
    if (event.recipient)    r += row('Loan to:', event.recipient);
  } else if (kind === 'received_on_account') {
    if (event.customerName) r += row('From:',    event.customerName);
    if (event.tenderMethod) r += row('Tender:',  event.tenderMethod);
  }
  // cash_drop and cash_in: just note (no extra body fields)

  if (event.note) {
    r += 'Note:' + LF;
    // Wrap note across lines at W-2 width with 2-space indent
    const noteText = String(event.note);
    for (let i = 0; i < noteText.length; i += W - 2) {
      r += '  ' + noteText.substring(i, i + (W - 2)) + LF;
    }
  }

  if (kind === 'vendor_payout' || kind === 'loan' || kind === 'received_on_account' || event.note) {
    r += divider;
  }

  // ── AMOUNT (large/bold, with direction tag) ────────────────────────────
  r += LF;
  r += ESCPOS.ALIGN_CENTER;
  r += ESCPOS.BOLD_ON + ESCPOS.DOUBLE_SIZE;
  r += money(event.amount) + LF;
  r += ESCPOS.NORMAL_SIZE + ESCPOS.BOLD_OFF;
  r += '(Money ' + direction + ' of drawer)' + LF;
  r += LF;
  r += ESCPOS.ALIGN_LEFT;

  // ── SIGNATURE LINE (house copy only) ───────────────────────────────────
  if (event.showSignatureLine) {
    r += divider;
    r += LF;
    r += 'Cashier signature:' + LF;
    r += '_'.repeat(W - 2) + LF;
    r += LF;
    // Vendor payouts get a vendor / receiver acknowledgment line on the
    // house copy too — proves the vendor accepted the cash.
    if (kind === 'vendor_payout' || kind === 'received_on_account') {
      const otherLabel = kind === 'vendor_payout' ? 'Vendor signature:' : 'Customer signature:';
      r += otherLabel + LF;
      r += '_'.repeat(W - 2) + LF;
      r += LF;
    }
  }

  // ── FOOTER (copy label) ────────────────────────────────────────────────
  r += hr;
  r += ESCPOS.ALIGN_CENTER;
  if (event.copyLabel) {
    r += ESCPOS.BOLD_ON + '*** ' + event.copyLabel + ' ***' + LF + ESCPOS.BOLD_OFF;
  }
  r += LF;
  r += 'Printed: ' + new Date().toLocaleString() + LF;
  r += ESCPOS.FEED_3;
  r += ESCPOS.CUT_PARTIAL;
  return r;
};

// ── Print cash drawer event — routes through QZ Tray or network-proxy ────
export const printCashEventQZ = async (printerName, event, paperWidth = '80mm') => {
  if (!isQZConnected()) await connectQZ();
  const data = buildCashEventReceiptString(event, { paperWidth });
  await printRaw(printerName, [data]);
};

export const printCashEventNetwork = async (ip, port, event, paperWidth = '80mm') => {
  const data = buildCashEventReceiptString(event, { paperWidth });
  await api.post('/pos-terminal/print-network', {
    ip, port,
    data: btoa(unescape(encodeURIComponent(data))),
  });
};

// Top-level dispatcher — same shape as printEoDReport / printReceipt.
// Caller passes `event` already enriched with branding fields (the modal /
// POSScreen know storeBranding); this function only handles transport.
export const printCashEvent = async (config, event) => {
  const method     = config?.receiptPrinter?.method || 'qz';
  const qzName     = config?.receiptPrinter?.qzName || config?.receiptPrinter?.name;
  const ip         = config?.receiptPrinter?.ip;
  const port       = config?.receiptPrinter?.port || 9100;
  const paperWidth = config?.receiptPrinter?.paperWidth || '80mm';

  if (method === 'network') {
    if (!ip) throw new Error('Receipt printer network IP not configured');
    await printCashEventNetwork(ip, port, event, paperWidth);
    return;
  }
  if (!qzName) throw new Error('Receipt printer name not configured');
  await printCashEventQZ(qzName, event, paperWidth);
};

// ── Build ZPL shelf label ────────────────────────────────────────────────
export const buildShelfLabelZPL = ({ productName = '', price = '0.00', upc = '', size = '' }) => `
^XA
^CF0,30
^FO20,15^FD${productName.substring(0, 22)}^FS
^CF0,22
^FO20,55^FD${size}^FS
^CF0,50
^FO20,80^FD$${price}^FS
^BY2,3,60
^FO20,150^BCN,,Y,N,N^FD${upc}^FS
^XZ
`.trim();

// ── Print ZPL label via QZ ────────────────────────────────────────────────
export const printLabelQZ = async (printerName, zplString) => {
  const { printZPL } = await import('./qzService.js');
  if (!isQZConnected()) await connectQZ();
  await printZPL(printerName, zplString);
};

// ── Test print receipt ────────────────────────────────────────────────────
export const printTestReceipt = async (printerName, method = 'qz', ip, port) => {
  const testReceipt = {
    storeName:    'TEST PRINT',
    storeAddress: '123 Main St',
    cashierName:  'Setup Wizard',
    date:         Date.now(),
    items: [
      { name: 'Test Item 1', qty: 2, unitPrice: 5.00, lineTotal: 10.00 },
      { name: 'Test Item 2', qty: 1, unitPrice: 3.50, lineTotal: 3.50 },
    ],
    subtotal: 13.50, totalTax: 1.76, total: 15.26,
    tenderMethod: 'CASH', amountTendered: 20.00, changeDue: 4.74,
    footerMessage: '✓ Receipt printer is working correctly!',
  };
  if (method === 'network') {
    await printReceiptNetwork(ip, port, testReceipt);
  } else {
    await printReceiptQZ(printerName, testReceipt);
  }
};
