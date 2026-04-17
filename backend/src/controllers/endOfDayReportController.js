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
      shift.stationId ? prisma.station.findUnique({ where: { id: shift.stationId }, select: { name: true, stationNumber: true } }) : null,
    ]);
    return {
      orgId,
      storeId: shift.storeId,
      cashierId: shift.cashierId,
      stationId: shift.stationId,
      cashierName: cashier?.name || 'Unknown',
      stationName: station?.name || (station?.stationNumber ? `POS-${station.stationNumber}` : null),
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
    stationId ? prisma.station.findUnique({ where: { id: stationId }, select: { name: true, stationNumber: true } }) : null,
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
      id: true, status: true, subtotal: true, taxTotal: true, grandTotal: true,
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

  for (const tx of txns) {
    const gt = Number(tx.grandTotal) || 0;
    const st = Number(tx.subtotal)   || 0;
    const tt = Number(tx.taxTotal)   || 0;
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
    } else {
      completeCount += 1;
      grossSales   += gt;
      netSales     += st;
      taxCollected += tt;
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

  const where = {
    orgId:     scope.orgId,
    createdAt: { gte: scope.from, lte: scope.to },
  };
  if (scope.storeId) where.storeId = scope.storeId;

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

    const [txAgg, cashEvents, openingRow] = await Promise.all([
      aggregateTransactions(scope),
      aggregateCashEvents(scope),
      // Opening cash amount — only meaningful for single-shift scope
      scope.shift ? Promise.resolve({ openingAmount: Number(scope.shift.openingAmount || 0) })
                  : Promise.resolve(null),
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
    const avgTxAmount = txAgg.completeCount > 0 ? txAgg.grossSales / txAgg.completeCount : 0;
    const transactionSection = [
      { key: 'avgTransaction', label: 'Average Transaction', count: txAgg.completeCount, amount: r2(avgTxAmount) },
      { key: 'netSales',       label: 'Net Sales',           count: txAgg.completeCount, amount: r2(txAgg.netSales) },
      { key: 'grossSales',     label: 'Gross Sales',         count: txAgg.completeCount, amount: r2(txAgg.grossSales) },
      { key: 'tax',            label: 'Tax Collected',       count: txAgg.completeCount, amount: r2(txAgg.taxCollected) },
      { key: 'cashCollected',  label: 'Cash Collected',      count: txAgg.tenderMap.cash?.count || 0, amount: r2(txAgg.cashCollected) },
    ];

    // ── Totals for reconciliation (only if shift-scope) ──────────────────────
    let reconciliation = null;
    if (scope.shift) {
      const opening           = Number(scope.shift.openingAmount) || 0;
      const cashDropsTotal    = payoutMap.pickups.amount;
      const cashPayoutsTotal  = payoutMap.paid_out.amount + payoutMap.loans.amount + payoutMap.paid_in.amount + payoutMap.received_on_acct.amount;
      const expectedInDrawer  = opening + txAgg.cashCollected - cashDropsTotal - cashPayoutsTotal;
      reconciliation = {
        openingAmount:    r2(opening),
        cashCollected:    r2(txAgg.cashCollected),
        cashDropsTotal:   r2(cashDropsTotal),
        cashPayoutsTotal: r2(cashPayoutsTotal),
        expectedInDrawer: r2(expectedInDrawer),
        closingAmount:    scope.shift.closingAmount != null ? Number(scope.shift.closingAmount) : null,
        variance:         scope.shift.variance      != null ? Number(scope.shift.variance)      : null,
      };
    }

    // ── Build header ─────────────────────────────────────────────────────────
    const storeName = scope.storeId ? (await prisma.store.findUnique({
      where: { id: scope.storeId }, select: { name: true, address: true, phone: true, timezone: true },
    })) : null;

    res.json({
      header: {
        reportType:   scope.shift ? 'shift' : 'date-range',
        storeId:      scope.storeId,
        storeName:    storeName?.name || null,
        storeAddress: storeName?.address || null,
        storePhone:   storeName?.phone || null,
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
