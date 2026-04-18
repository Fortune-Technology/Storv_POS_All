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

  r += ESCPOS.BOLD_ON;
  const totalAmt = Number(receipt.total || 0);
  r += line(totalAmt < -0.005 ? 'REFUND DUE' : 'TOTAL',
            (totalAmt < -0.005 ? '-$' : '$') + Math.abs(totalAmt).toFixed(2), W);
  r += ESCPOS.BOLD_OFF;
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
