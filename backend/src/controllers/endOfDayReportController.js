/**
 * End-of-Day Report Controller
 *
 * Produces the store-level EoD reconciliation report with three sections:
 *   1. PAYOUTS       (Cashback, Loans, Pickups, Paid-ins, Paid-outs,
 *                     Received on Acct, Refunds, Tips, Voids)
 *   2. TENDER        (Cash, EBT Cash, Check, Debit Card, Credit Card,
 *                     EFS, Paper FS, In-store charge, Store Giftcard)
 *   3. TRANSACTIONS  (Avg Tx, Net Sales, Gross Sales, Cash Collected)
 *
 * Usage:
 *   GET /api/reports/end-of-day
 *     ?shiftId=...                        (single shift — cashier app default)
 *     OR
 *     ?date=YYYY-MM-DD                    (single day)
 *     ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 *     Additional filters:
 *     ?storeId=...
 *     ?cashierId=...
 *     ?stationId=...
 *
 * Response shape matches what both the back-office EndOfDayReport.jsx page
 * and the cashier-app thermal-printer template need to render.
 */

import prisma from '../config/postgres.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// ─── Local-day window helpers (same as listTransactions fix) ────────────────
const startOfLocalDay = (str) => {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};
const endOfLocalDay = (str) => {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
};

// ─── Tender method normalization (maps to the 9 report categories) ─────────
// Accepts the variety of method strings that tenderLines can have in the
// wild (legacy 'card' / 'credit' / 'debit' / 'ebt' etc.) and maps them to
// a stable label used in the report.
export const TENDER_CATEGORIES = [
  { key: 'cash',          label: 'Cash'                  },
  { key: 'ebt_cash',      label: 'EBT Cash'              },
  { key: 'check',         label: 'Check'                 },
  { key: 'debit',         label: 'Debit Card'            },
  { key: 'credit',        label: 'Credit Card'           },
  { key: 'efs',           label: 'Electronic Food Stamp' },
  { key: 'paper_fs',      label: 'Paper Food Stamp'      },
  { key: 'house_charge',  label: 'In-store Charge'       },
  { key: 'gift_card',     label: 'Store Gift Card'       },
];

function mapTenderMethod(method) {
  const m = (method || '').toLowerCase().trim();
  if (!m) return null;
  if (m === 'cash')                                      return 'cash';
  if (m === 'ebt_cash' || m === 'ebtcash')               return 'ebt_cash';
  if (m === 'check' || m === 'cheque')                   return 'check';
  if (m === 'debit' || m === 'debit_card')               return 'debit';
  if (m === 'credit' || m === 'credit_card' || m === 'card') return 'credit';
  if (m === 'efs' || m === 'ebt' || m === 'ebt_food' || m === 'snap') return 'efs';
  if (m === 'paper_fs' || m === 'paper_food_stamp' || m === 'wic') return 'paper_fs';
  if (m === 'charge' || m === 'house' || m === 'house_charge' || m === 'account' || m === 'house_account') return 'house_charge';
  if (m === 'gift' || m === 'gift_card' || m === 'giftcard' || m === 'store_credit') return 'gift_card';
  return null;
}

// ─── Payout/event category mapping (9 categories) ───────────────────────────
// Covers every cash-movement event the user wants reported.
export const PAYOUT_CATEGORIES = [
  { key: 'cashback',         label: 'Cashback'             }, // cashback given on card purchases
  { key: 'loans',            label: 'Loans'                }, // CashPayout.payoutType='loan'
  { key: 'pickups',          label: 'Pickups'              }, // CashDrop (cash removed for safety)
  { key: 'paid_in',          label: 'Paid-in'              }, // CashPayout.payoutType='paid_in' (rare)
  { key: 'paid_out',         label: 'Paid-out'             }, // generic expense CashPayout
  { key: 'received_on_acct', label: 'Received on Account'  }, // house-charge payments (tender=house_charge on refund-flow)
  { key: 'refunds',          label: 'Refunds'              }, // Transaction.status='refund'
  { key: 'tips',             label: 'Tips'                 }, // lineItem.isTip or tenderLines 'tip'
  { key: 'voids',            label: 'Voids'                }, // Transaction.status='voided'
];

// ─── Build where clauses for a given scope ──────────────────────────────────
async function resolveScope(req) {
  const orgId = req.orgId || req.user?.orgId;
  if (!orgId) throw new Error('orgId not resolved');

  const { shiftId, date, dateFrom, dateTo, storeId, cashierId, stationId } = req.query;

  // 1. If shiftId provided — use the shift's time window and cashier
  if (shiftId) {
    const shift = await prisma.shift.findFirst({
      where: { id: shiftId, orgId },
      include: { drops: true, payouts: true },
    });
    if (!shift) { const e = new Error('Shift not found'); e.statusCode = 404; throw e; }
    const [cashier, station] = await Promise.all([
      prisma.user.findUnique({ where: { id: shift.cashierId }, select: { name: true } }),
      shift.stationId ? prisma.station.findUnique({ where: { id: shift.stationId }, select: { name: true } }) : null,
    ]);
    return {
      orgId,
      storeId: shift.storeId,
      cashierId: shift.cashierId,
      stationId: shift.stationId,
      cashierName: cashier?.name || 'Unknown',
      stationName: station?.name || null,
      from: shift.openedAt,
      to:   shift.closedAt || new Date(),
      shift,
    };
  }

  // 2. Otherwise explicit date window + optional cashier/station/store filters
  const effectiveStoreId = storeId || req.storeId || null;
  let from, to;
  if (dateFrom || dateTo) {
    from = dateFrom ? startOfLocalDay(dateFrom) : startOfLocalDay(dateTo);
    to   = dateTo   ? endOfLocalDay(dateTo)   : endOfLocalDay(dateFrom);
  } else if (date) {
    from = startOfLocalDay(date);
    to   = endOfLocalDay(date);
  } else {
    // Default: today
    const nowStr = new Date().toISOString().slice(0, 10);
    from = startOfLocalDay(nowStr);
    to   = endOfLocalDay(nowStr);
  }

  // Resolve names for the header
  const [cashier, station] = await Promise.all([
    cashierId ? prisma.user.findUnique({ where: { id: cashierId }, select: { name: true } }) : null,
    stationId ? prisma.station.findUnique({ where: { id: stationId }, select: { name: true } }) : null,
  ]);

  return {
    orgId,
    storeId: effectiveStoreId,
    cashierId: cashierId || null,
    stationId: stationId || null,
    cashierName: cashier?.name || null,
    stationName: station?.name || (station?.stationNumber ? `POS-${station.stationNumber}` : null),
    from, to,
    shift: null,
  };
}

// ─── Aggregate transactions (tender, gross/net, cash collected) ─────────────
async function aggregateTransactions(scope) {
  const where = {
    orgId: scope.orgId,
    createdAt: { gte: scope.from, lte: scope.to },
  };
  if (scope.storeId)   where.storeId   = scope.storeId;
  if (scope.cashierId) where.cashierId = scope.cashierId;
  if (scope.stationId) where.stationId = scope.stationId;
  // Include complete + refund + voided — report counts each separately
  where.status = { in: ['complete', 'refund', 'voided'] };

  const txns = await prisma.transaction.findMany({
    where,
    select: {
      id: true, status: true, subtotal: true, taxTotal: true, depositTotal: true, grandTotal: true,
      changeGiven: true, tenderLines: true, lineItems: true, createdAt: true,
    },
  });

  // Initialise tender counters
  const tenderMap = {};
  for (const c of TENDER_CATEGORIES) tenderMap[c.key] = { key: c.key, label: c.label, count: 0, amount: 0 };

  // Tx counters
  let completeCount  = 0;
  let refundCount    = 0, refundAmount    = 0;
  let voidCount      = 0, voidAmount      = 0;
  let grossSales     = 0;   // Σ grandTotal (B2: tender total, incl. tax)
  let netSales       = 0;   // Σ subtotal   (B2: pre-tax, post-discount)
  let taxCollected   = 0;
  let cashCollected  = 0;   // Σ cash tenderLines.amount − Σ changeGiven
  let cashBackTotal  = 0, cashBackCount = 0;
  let tipsTotal      = 0, tipsCount = 0;

  // Pass-through fees — NOT revenue, NOT profit. Reported separately so the
  // retailer can reconcile what they collected on behalf of the state (deposits)
  // vs what they charged for disposable bags. Both are already baked into
  // grandTotal, so nothing else needs to change in the math.
  let depositsCollected = 0;   // Σ Transaction.depositTotal
  let depositsRefunded  = 0;   // tracked on refund txs
  let bagFeeTotal       = 0;   // Σ lineItems where isBagFee
  let bagFeeQty         = 0;   // Σ bag counts

  for (const tx of txns) {
    const gt = Number(tx.grandTotal) || 0;
    const st = Number(tx.subtotal)   || 0;
    const tt = Number(tx.taxTotal)   || 0;
    const dt = Number(tx.depositTotal) || 0;
    const ch = Number(tx.changeGiven) || 0;

    if (tx.status === 'voided') {
      voidCount += 1;
      voidAmount += Math.abs(gt);
      continue;
    }
    if (tx.status === 'refund') {
      refundCount += 1;
      refundAmount += Math.abs(gt);
      // Refunds reduce gross/net
      grossSales -= Math.abs(gt);
      netSales   -= Math.abs(st);
      taxCollected -= Math.abs(tt);
      depositsRefunded += Math.abs(dt);
    } else {
      completeCount += 1;
      grossSales   += gt;
      netSales     += st;
      taxCollected += tt;
      depositsCollected += dt;
    }

    // Bag fees — stored as synthetic line items with isBagFee:true
    const liArr = Array.isArray(tx.lineItems) ? tx.lineItems : [];
    for (const li of liArr) {
      if (li.isBagFee) {
        const amt = Number(li.lineTotal) || 0;
        const q   = Number(li.qty) || 1;
        if (tx.status === 'refund') { bagFeeTotal -= Math.abs(amt); bagFeeQty -= Math.abs(q); }
        else                         { bagFeeTotal += amt;          bagFeeQty += q; }
      }
    }

    // Tender breakdown per tenderLines entry
    const tenders = Array.isArray(tx.tenderLines) ? tx.tenderLines : [];
    let cashLineAmt = 0;
    for (const t of tenders) {
      const cat = mapTenderMethod(t.method);
      const amt = Number(t.amount) || 0;
      if (cat && tenderMap[cat]) {
        tenderMap[cat].count  += 1;
        tenderMap[cat].amount += amt;
      }
      if (cat === 'cash') cashLineAmt += amt;
      // Tips may be denoted with method='tip' or a separate tip field
      if (t.method === 'tip' || t.isTip) {
        tipsCount += 1;
        tipsTotal += amt;
      }
    }

    // Cash collected (what actually stayed in the drawer from cash tender):
    // For sales: cashLineAmt − changeGiven
    // For refunds: cash paid OUT goes negative
    if (tx.status === 'refund') {
      cashCollected -= cashLineAmt;   // cash refunded = cash leaving drawer
    } else {
      cashCollected += cashLineAmt - ch;
      // Cashback tender method — occasionally stored as method='cashback'
      for (const t of tenders) {
        if ((t.method || '').toLowerCase() === 'cashback') {
          cashBackCount += 1;
          cashBackTotal += Number(t.amount) || 0;
        }
      }
      // Line-item fallback for tips / cashback
      const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
      for (const li of items) {
        if (li.isTip) { tipsCount += 1; tipsTotal += Number(li.lineTotal) || 0; }
        if (li.isCashback) { cashBackCount += 1; cashBackTotal += Math.abs(Number(li.lineTotal) || 0); }
      }
    }
  }

  return {
    tenderMap,
    completeCount, refundCount, refundAmount, voidCount, voidAmount,
    grossSales, netSales, taxCollected, cashCollected,
    cashBackCount, cashBackTotal, tipsCount, tipsTotal,
    depositsCollected, depositsRefunded, bagFeeTotal, bagFeeQty,
  };
}

// ─── Aggregate fuel transactions for the scope window ──────────────────────
async function aggregateFuel(scope) {
  const where = {
    orgId:     scope.orgId,
    createdAt: { gte: scope.from, lte: scope.to },
  };
  if (scope.storeId)   where.storeId   = scope.storeId;
  if (scope.cashierId) where.cashierId = scope.cashierId;
  if (scope.stationId) where.stationId = scope.stationId;
  if (scope.shift)     where.shiftId   = scope.shift.id;

  const txs = await prisma.fuelTransaction.findMany({
    where,
    include: { fuelType: { select: { name: true, gradeLabel: true, color: true } } },
  });

  const byType = new Map();
  let totalGallons = 0, totalAmount = 0;
  let totalSalesGallons = 0, totalSalesAmount = 0;
  let totalRefundGallons = 0, totalRefundAmount = 0;
  let salesCount = 0, refundCount = 0;

  for (const t of txs) {
    const id = t.fuelTypeId || `__${t.fuelTypeName || 'unknown'}`;
    if (!byType.has(id)) {
      byType.set(id, {
        fuelTypeId: t.fuelTypeId || null,
        name:       t.fuelType?.name || t.fuelTypeName || 'Fuel',
        gradeLabel: t.fuelType?.gradeLabel || null,
        color:      t.fuelType?.color || null,
        salesGallons: 0, salesAmount: 0, salesCount: 0,
        refundGallons: 0, refundAmount: 0, refundCount: 0,
        netGallons: 0, netAmount: 0,
        avgPrice: 0,
      });
    }
    const row = byType.get(id);
    const gal = Number(t.gallons) || 0;
    const amt = Number(t.amount)  || 0;
    if (t.type === 'refund') {
      row.refundGallons += gal;
      row.refundAmount  += amt;
      row.refundCount   += 1;
      totalRefundGallons += gal; totalRefundAmount += amt; refundCount += 1;
    } else {
      row.salesGallons += gal;
      row.salesAmount  += amt;
      row.salesCount   += 1;
      totalSalesGallons += gal; totalSalesAmount += amt; salesCount += 1;
    }
  }

  const rows = Array.from(byType.values()).map(r => {
    r.netGallons = r.salesGallons - r.refundGallons;
    r.netAmount  = r.salesAmount  - r.refundAmount;
    r.avgPrice   = r.netGallons > 0 ? r.netAmount / r.netGallons : 0;
    r.salesGallons  = r3(r.salesGallons);
    r.salesAmount   = r2(r.salesAmount);
    r.refundGallons = r3(r.refundGallons);
    r.refundAmount  = r2(r.refundAmount);
    r.netGallons    = r3(r.netGallons);
    r.netAmount     = r2(r.netAmount);
    r.avgPrice      = r3(r.avgPrice);
    return r;
  }).sort((a, b) => b.netAmount - a.netAmount);

  totalGallons = totalSalesGallons - totalRefundGallons;
  totalAmount  = totalSalesAmount  - totalRefundAmount;

  return {
    rows,
    totals: {
      gallons:        r3(totalGallons),
      amount:         r2(totalAmount),
      salesGallons:   r3(totalSalesGallons),
      salesAmount:    r2(totalSalesAmount),
      refundGallons:  r3(totalRefundGallons),
      refundAmount:   r2(totalRefundAmount),
      salesCount,
      refundCount,
      avgPrice:       r3(totalGallons > 0 ? totalAmount / totalGallons : 0),
    },
  };
}

// ─── Aggregate shift-scoped payouts and drops ───────────────────────────────
// When scope has a specific shift, we pull the shift's drops[] / payouts[]
// directly. Otherwise we query CashPayout / CashDrop by date range.
async function aggregateCashEvents(scope) {
  if (scope.shift) {
    return {
      payouts: scope.shift.payouts || [],
      drops:   scope.shift.drops   || [],
    };
  }

  // CashDrop / CashPayout don't have a direct storeId column — they're scoped via shift.
  // Filter by shift.storeId when a storeId is provided.
  const where = {
    orgId:     scope.orgId,
    createdAt: { gte: scope.from, lte: scope.to },
    ...(scope.storeId ? { shift: { storeId: scope.storeId } } : {}),
  };

  const [payouts, drops] = await Promise.all([
    prisma.cashPayout.findMany({ where, orderBy: { createdAt: 'asc' } }),
    prisma.cashDrop  .findMany({ where, orderBy: { createdAt: 'asc' } }),
  ]);

  return { payouts, drops };
}

// ─── MAIN ENDPOINT ──────────────────────────────────────────────────────────
export const getEndOfDayReport = async (req, res) => {
  try {
    const scope = await resolveScope(req);

    const [txAgg, cashEvents, openingRow, fuelAgg] = await Promise.all([
      aggregateTransactions(scope),
      aggregateCashEvents(scope),
      // Opening cash amount — only meaningful for single-shift scope
      scope.shift ? Promise.resolve({ openingAmount: Number(scope.shift.openingAmount || 0) })
                  : Promise.resolve(null),
      aggregateFuel(scope),
    ]);

    // ── PAYOUTS section (9 categories) ───────────────────────────────────────
    const payoutMap = {};
    for (const c of PAYOUT_CATEGORIES) payoutMap[c.key] = { key: c.key, label: c.label, count: 0, amount: 0 };

    // CashPayout rows → map by payoutType
    for (const p of cashEvents.payouts) {
      const amt = Number(p.amount) || 0;
      const ptype = (p.payoutType || '').toLowerCase().trim();
      let bucket = 'paid_out'; // default
      if (ptype === 'loan' || ptype === 'loans')             bucket = 'loans';
      else if (ptype === 'paid_in' || ptype === 'received')  bucket = 'paid_in';
      else if (ptype === 'received_on_acct' || ptype === 'on_account' || ptype === 'house_payment') bucket = 'received_on_acct';
      else if (ptype === 'tip' || ptype === 'tips')          bucket = 'tips';
      else                                                   bucket = 'paid_out';
      payoutMap[bucket].count  += 1;
      payoutMap[bucket].amount += amt;
    }

    // CashDrop rows → Pickups
    for (const d of cashEvents.drops) {
      payoutMap.pickups.count  += 1;
      payoutMap.pickups.amount += Number(d.amount) || 0;
    }

    // Cashback from transactions
    payoutMap.cashback.count  = txAgg.cashBackCount;
    payoutMap.cashback.amount = txAgg.cashBackTotal;

    // Tips from transactions (merged with any payout-based tips)
    payoutMap.tips.count  += txAgg.tipsCount;
    payoutMap.tips.amount += txAgg.tipsTotal;

    // Refunds + Voids from transactions (already computed in aggregator)
    payoutMap.refunds.count  = txAgg.refundCount;
    payoutMap.refunds.amount = txAgg.refundAmount;
    payoutMap.voids.count    = txAgg.voidCount;
    payoutMap.voids.amount   = txAgg.voidAmount;

    // Round
    for (const k of Object.keys(payoutMap)) payoutMap[k].amount = r2(payoutMap[k].amount);
    for (const k of Object.keys(txAgg.tenderMap)) txAgg.tenderMap[k].amount = r2(txAgg.tenderMap[k].amount);

    // ── TRANSACTIONS section ─────────────────────────────────────────────────
    // Average tx uses GROSS *before* refund-subtraction over total successful
    // tickets (completes + refunds), so a $40 sale + a $10 refund averages
    // ~$25 not $30. This is the standard convention for POS daily-summary reports.
    const grossBeforeRefunds = txAgg.grossSales + txAgg.refundAmount;
    const allTxCount         = txAgg.completeCount + txAgg.refundCount;
    const avgTxAmount        = allTxCount > 0 ? grossBeforeRefunds / allTxCount : 0;
    const transactionSection = [
      { key: 'avgTransaction', label: 'Average Transaction', count: allTxCount,           amount: r2(avgTxAmount) },
      { key: 'netSales',       label: 'Net Sales',           count: txAgg.completeCount,  amount: r2(txAgg.netSales) },
      { key: 'grossSales',     label: 'Gross Sales',         count: txAgg.completeCount,  amount: r2(txAgg.grossSales) },
      { key: 'tax',            label: 'Tax Collected',       count: txAgg.completeCount,  amount: r2(txAgg.taxCollected) },
      { key: 'cashCollected',  label: 'Cash Collected',      count: txAgg.tenderMap.cash?.count || 0, amount: r2(txAgg.cashCollected) },
    ];

    // Pass-through fees — collected on behalf of the state (deposits) or
    // as a flat charge per bag. Both are already baked into Gross Sales
    // (which mirrors customer-facing tender total), so this section is purely
    // a breakdown for accounting — it does NOT affect profit or revenue math.
    const feesSection = [
      { key: 'bagFees',        label: 'Bag Fees (pass-through)',           count: txAgg.bagFeeQty,      amount: r2(txAgg.bagFeeTotal),        passThrough: true },
      { key: 'bottleDeposits', label: 'Bottle Deposits Collected',         count: txAgg.completeCount,  amount: r2(txAgg.depositsCollected),  passThrough: true },
      { key: 'depositsRefunded',label:'Bottle Deposits Refunded',          count: txAgg.refundCount,    amount: r2(txAgg.depositsRefunded),   passThrough: true },
    ];

    // ── Totals for reconciliation (only if shift-scope) ──────────────────────
    // Cash flow into the drawer:  opening + cashCollected + paid_in + received_on_acct
    // Cash flow out of the drawer: pickups (drops) + paid_out + loans
    // (refunds + cashback are already netted out of cashCollected via tx tender lines)
    let reconciliation = null;
    if (scope.shift) {
      const opening           = Number(scope.shift.openingAmount) || 0;
      const cashDropsTotal    = payoutMap.pickups.amount;
      const cashIn            = payoutMap.paid_in.amount + payoutMap.received_on_acct.amount;
      const cashOut           = payoutMap.paid_out.amount + payoutMap.loans.amount;
      const expectedInDrawer  = opening + txAgg.cashCollected + cashIn - cashDropsTotal - cashOut;
      reconciliation = {
        openingAmount:    r2(opening),
        cashCollected:    r2(txAgg.cashCollected),
        cashIn:           r2(cashIn),                    // Paid-in + Received on Account
        cashOut:          r2(cashOut),                   // Paid-out + Loans
        cashDropsTotal:   r2(cashDropsTotal),            // Pickups
        // Legacy field kept for back-compat with existing UI/print templates
        cashPayoutsTotal: r2(cashOut),
        expectedInDrawer: r2(expectedInDrawer),
        closingAmount:    scope.shift.closingAmount != null ? Number(scope.shift.closingAmount) : null,
        variance:         scope.shift.variance      != null ? Number(scope.shift.variance)      : null,
      };
    }

    // ── Build header ─────────────────────────────────────────────────────────
    const storeName = scope.storeId ? (await prisma.store.findUnique({
      where: { id: scope.storeId }, select: { name: true },
    })) : null;

    res.json({
      header: {
        reportType:   scope.shift ? 'shift' : 'date-range',
        storeId:      scope.storeId,
        storeName:    storeName?.name || null,
        storeAddress: null,
        storePhone:   null,
        cashierId:    scope.cashierId,
        cashierName:  scope.cashierName,
        stationId:    scope.stationId,
        stationName:  scope.stationName,
        shiftId:      scope.shift?.id || null,
        from:         scope.from,
        to:           scope.to,
        printedAt:    new Date().toISOString(),
      },
      payouts:      PAYOUT_CATEGORIES.map(c => payoutMap[c.key]),
      tenders:      TENDER_CATEGORIES.map(c => txAgg.tenderMap[c.key]),
      transactions: transactionSection,
      fees:         feesSection,
      fuel:         fuelAgg,
      reconciliation,
      totals: {
        grossSales:       r2(txAgg.grossSales),
        netSales:         r2(txAgg.netSales),
        taxCollected:     r2(txAgg.taxCollected),
        cashCollected:    r2(txAgg.cashCollected),
        completeTxns:     txAgg.completeCount,
        refundCount:      txAgg.refundCount,
        refundAmount:     r2(txAgg.refundAmount),
        voidCount:        txAgg.voidCount,
        voidAmount:       r2(txAgg.voidAmount),
      },
    });
  } catch (err) {
    console.error('[getEndOfDayReport]', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};
