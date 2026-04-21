// Daily Sale compute service — merges auto-derived data from live tables
// (Transactions, LotteryTransaction, LotteryOnlineTotal, Shift, CashPayout,
// VendorPayment) with the user-adjustable fields persisted in
// DailySaleReport into a single reconciliation payload.
//
// Math:
//   Total In  = cashCollected + creditCardAuto + debitCardAuto
//             + lotteryInstantSales + lotteryOnlineSales
//             + otherIncome + moneyIn
//             + houseAccountsCharges
//   Total Out = bankDeposit + lotteryDeposit
//             + creditCardTotal (bank card deposits) + debitCardTotal
//             + purchaseCashPO + expenseCashPO
//             + lotteryInstantPayouts + lotteryOnlineCashings + instantCashing
//   Short/Over = Total In − Total Out   (positive = over, negative = short)
//
// Note: department adjustments modify the computed dept row total but do
// NOT affect Total In (which comes from tenders) — they're a P&L signal.

import prisma from '../config/postgres.js';

function dayBoundsUTC(dateStr) {
  const d = new Date(dateStr + 'T00:00:00.000Z');
  const start = new Date(d);
  const end   = new Date(d);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/**
 * Aggregate today's POS transactions into per-dept totals and per-tender totals.
 * Follows Session 27's sign convention: refund status = subtract.
 */
async function aggregatePosActivity({ orgId, storeId, start, end }) {
  const txns = await prisma.transaction.findMany({
    where: {
      orgId, storeId,
      status: { in: ['complete', 'refund'] },
      createdAt: { gte: start, lte: end },
    },
    select: {
      id: true, status: true,
      lineItems: true, tenderLines: true,
      subtotal: true, taxTotal: true, grandTotal: true,
      depositTotal: true,
    },
  });

  const depts    = new Map();  // deptKey → { name, amount, itemsCount }
  const tenders  = { cash: 0, credit: 0, debit: 0, ebt: 0, gift: 0, check: 0, house: 0, other: 0 };
  let subtotalSum = 0, taxSum = 0, grandSum = 0, depositSum = 0, refundCount = 0;

  for (const tx of txns) {
    const isRefund = tx.status === 'refund';
    const sign = isRefund ? -1 : 1;
    if (isRefund) refundCount += 1;

    subtotalSum += sign * Math.abs(Number(tx.subtotal || 0));
    taxSum      += sign * Math.abs(Number(tx.taxTotal || 0));
    grandSum    += sign * Math.abs(Number(tx.grandTotal || 0));
    depositSum  += sign * Math.abs(Number(tx.depositTotal || 0));

    // Per-department (skip lottery/fuel/bottle-return/bag — those flow elsewhere)
    const items = Array.isArray(tx.lineItems) ? tx.lineItems : [];
    for (const li of items) {
      if (li.isLottery || li.isFuel || li.isBottleReturn || li.isBagFee) continue;
      const key  = li.departmentId || li.departmentName || li.taxClass || 'other';
      const name = li.departmentName || li.taxClass || 'Other';
      if (!depts.has(key)) depts.set(key, { key: String(key), name, amount: 0, itemsCount: 0 });
      const d = depts.get(key);
      const lineTotal = Number(li.lineTotal || 0);
      d.amount += sign * Math.abs(lineTotal);
      d.itemsCount += 1;
    }

    // Per-tender split
    const tls = Array.isArray(tx.tenderLines) ? tx.tenderLines : [];
    for (const tl of tls) {
      const method = String(tl.method || 'other').toLowerCase().replace(/[^a-z]/g, '');
      const amt = Number(tl.amount || 0);
      const signed = isRefund ? -Math.abs(amt) : amt;
      if (method.includes('cash'))         tenders.cash   += signed;
      else if (method.includes('credit'))  tenders.credit += signed;
      else if (method.includes('debit'))   tenders.debit  += signed;
      else if (method.includes('ebt'))     tenders.ebt    += signed;
      else if (method.includes('gift'))    tenders.gift   += signed;
      else if (method.includes('check'))   tenders.check  += signed;
      else if (method.includes('house'))   tenders.house  += signed;
      else                                 tenders.other  += signed;
    }
  }

  // Round everything
  for (const d of depts.values()) d.amount = round2(d.amount);
  for (const k of Object.keys(tenders)) tenders[k] = round2(tenders[k]);

  return {
    depts: Array.from(depts.values()).sort((a, b) => b.amount - a.amount),
    tenders,
    totals: {
      subtotal:    round2(subtotalSum),
      tax:         round2(taxSum),
      grandTotal:  round2(grandSum),
      deposits:    round2(depositSum),
      txCount:     txns.length,
      refundCount,
    },
  };
}

/**
 * Pull lottery activity for the day. Returns the 3 online totals +
 * aggregated instant sales/payouts from LotteryTransaction.
 */
async function aggregateLottery({ orgId, storeId, start, end, dateStr }) {
  const [online, instantTxs] = await Promise.all([
    prisma.lotteryOnlineTotal.findUnique({
      where: { orgId_storeId_date: { orgId, storeId, date: new Date(dateStr + 'T00:00:00Z') } },
    }).catch(() => null),
    prisma.lotteryTransaction.findMany({
      where: {
        orgId, storeId,
        createdAt: { gte: start, lte: end },
      },
      select: { type: true, amount: true },
    }),
  ]);

  let instantSales = 0, instantPayouts = 0;
  for (const t of instantTxs) {
    const amt = Number(t.amount || 0);
    if (t.type === 'sale')         instantSales   += amt;
    else if (t.type === 'payout')  instantPayouts += amt;
  }

  return {
    instantSales:   round2(instantSales),
    instantPayouts: round2(instantPayouts),
    instantCashing: round2(online?.instantCashing || 0),
    machineSales:   round2(online?.machineSales   || 0),
    machineCashing: round2(online?.machineCashing || 0),
    lottoSalesTotal: round2(Number(online?.machineSales || 0)),
    scratchoffSalesTotal: round2(instantSales),
    lottoPO: round2(Number(online?.machineCashing || 0)),
    scratchoffPO: round2(instantPayouts + Number(online?.instantCashing || 0)),
  };
}

/**
 * Cash paidouts from both sources:
 *   - VendorPayment (manual back-office entries, has paymentType)
 *   - CashPayout (shift-scoped, no type — treated as expense by default)
 */
async function aggregatePaidouts({ orgId, storeId, start, end }) {
  const [vendorPayments, cashPayouts] = await Promise.all([
    prisma.vendorPayment.findMany({
      where: {
        orgId,
        storeId,
        paymentDate: { gte: start, lte: end },
      },
      select: { paymentType: true, amount: true, vendorName: true },
    }),
    prisma.cashPayout.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        shift: { storeId, orgId },
      },
      select: { amount: true, note: true, payoutType: true },
    }),
  ]);

  let purchase = 0, expense = 0;
  for (const vp of vendorPayments) {
    const amt = Number(vp.amount || 0);
    if (vp.paymentType === 'merchandise' || vp.paymentType === 'purchase') purchase += amt;
    else expense += amt;
  }
  for (const cp of cashPayouts) {
    expense += Number(cp.amount || 0); // shift-drawer paidouts default to expense
  }

  return {
    purchaseCashPO: round2(purchase),
    expenseCashPO:  round2(expense),
    items: [
      ...vendorPayments.map(v => ({ kind: 'vendor', type: v.paymentType, amount: round2(v.amount), recipient: v.vendorName })),
      ...cashPayouts.map(c   => ({ kind: 'shift',  type: c.payoutType || 'expense', amount: round2(c.amount), recipient: c.note || null, reason: c.note })),
    ],
  };
}

/**
 * Pull cash counted from the most recent closed shift that fell on this day.
 * If multiple shifts closed, sum them.
 */
async function aggregateShiftCash({ orgId, storeId, start, end }) {
  const shifts = await prisma.shift.findMany({
    where: {
      orgId, storeId,
      closedAt: { gte: start, lte: end },
      status:   'closed',
    },
    select: {
      id: true,
      closingAmount: true, expectedAmount: true, variance: true,
      openingAmount: true,
      cashSales: true, cashDropsTotal: true, payoutsTotal: true,
    },
  });

  const summed = shifts.reduce((acc, s) => ({
    closed:   acc.closed + 1,
    counted:  acc.counted + Number(s.closingAmount || 0),
    expected: acc.expected + Number(s.expectedAmount || 0),
    variance: acc.variance + Number(s.variance || 0),
    opening:  acc.opening + Number(s.openingAmount || 0),
    cashSales: acc.cashSales + Number(s.cashSales || 0),
    cashDrops: acc.cashDrops + Number(s.cashDropsTotal || 0),
    payouts:   acc.payouts + Number(s.payoutsTotal || 0),
  }), { closed: 0, counted: 0, expected: 0, variance: 0, opening: 0, cashSales: 0, cashDrops: 0, payouts: 0 });

  return {
    closedCount: summed.closed,
    cashCountedFromShifts: round2(summed.counted),
    cashExpectedFromShifts: round2(summed.expected),
    varianceFromShifts:     round2(summed.variance),
  };
}

/**
 * Produce the full Daily Sale snapshot for one day. Callers render this
 * directly into the 3-column portal UI. Never persists.
 */
export async function computeDailySale({ orgId, storeId, dateStr }) {
  const { start, end } = dayBoundsUTC(dateStr);

  const [pos, lotto, paidouts, shift, saved] = await Promise.all([
    aggregatePosActivity({ orgId, storeId, start, end }),
    aggregateLottery({ orgId, storeId, start, end, dateStr }),
    aggregatePaidouts({ orgId, storeId, start, end }),
    aggregateShiftCash({ orgId, storeId, start, end }),
    prisma.dailySaleReport.findUnique({
      where: { orgId_storeId_date: { orgId, storeId, date: new Date(dateStr + 'T00:00:00Z') } },
    }).catch(() => null),
  ]);

  // Merge saved dept adjustments onto the auto rows (by key).
  const savedAdj = Array.isArray(saved?.deptAdjustments) ? saved.deptAdjustments : [];
  const adjByKey = new Map(savedAdj.map(r => [String(r.key), r]));
  const deptRows = pos.depts.map(d => {
    const adj = adjByKey.get(d.key);
    const adjustment = Number(adj?.adjustment || 0);
    return {
      key: d.key,
      name: d.name,
      autoAmount: d.amount,
      adjustment,
      finalAmount: round2(d.amount + adjustment),
      note: adj?.note || null,
      itemsCount: d.itemsCount,
    };
  });
  // Any saved adjustment keys that don't have an auto row → show as manual rows
  for (const adj of savedAdj) {
    if (!pos.depts.some(d => String(d.key) === String(adj.key))) {
      deptRows.push({
        key: String(adj.key),
        name: adj.name || adj.key,
        autoAmount: 0,
        adjustment: Number(adj.adjustment || 0),
        finalAmount: round2(Number(adj.adjustment || 0)),
        note: adj.note || null,
        itemsCount: 0,
      });
    }
  }

  const totalSalesFromDepts = round2(deptRows.reduce((s, r) => s + r.finalAmount, 0));

  // Cash counted: prefer user-saved override → shift close sum → null
  const cashCounted = saved?.cashCounted != null
    ? Number(saved.cashCounted)
    : shift.cashCountedFromShifts;

  // Store money values — saved override OR auto-derived from tenders
  const creditCardTotal = saved?.creditCardTotal != null && Number(saved.creditCardTotal) !== 0
    ? Number(saved.creditCardTotal) : pos.tenders.credit;
  const debitCardTotal = saved?.debitCardTotal != null && Number(saved.debitCardTotal) !== 0
    ? Number(saved.debitCardTotal) : pos.tenders.debit;

  // Cash paidouts — saved override OR auto-derived from payments
  const purchaseCashPO = saved?.purchaseCashPO != null && Number(saved.purchaseCashPO) !== 0
    ? Number(saved.purchaseCashPO) : paidouts.purchaseCashPO;
  const expenseCashPO = saved?.expenseCashPO != null && Number(saved.expenseCashPO) !== 0
    ? Number(saved.expenseCashPO) : paidouts.expenseCashPO;

  // Totals
  const otherIncome = round2(saved?.otherIncome || 0);
  const moneyIn     = round2(saved?.moneyIn     || 0);
  const bankDeposit    = round2(saved?.bankDeposit    || 0);
  const lotteryDeposit = round2(saved?.lotteryDeposit || 0);

  // House accts (positive = store gave customer credit, adds to Total In when paid)
  const houseAccounts = Array.isArray(saved?.houseAccounts) ? saved.houseAccounts : [];
  const houseTotal = round2(houseAccounts.reduce((s, h) => s + Number(h.amount || 0), 0));

  const totalIn = round2(
    pos.tenders.cash
    + pos.tenders.credit + pos.tenders.debit + pos.tenders.ebt + pos.tenders.gift + pos.tenders.check + pos.tenders.house + pos.tenders.other
    + lotto.instantSales + lotto.machineSales
    + otherIncome + moneyIn + houseTotal
  );
  const totalOut = round2(
    bankDeposit + lotteryDeposit
    + creditCardTotal + debitCardTotal
    + purchaseCashPO + expenseCashPO
    + lotto.instantPayouts + lotto.machineCashing + lotto.instantCashing
  );
  const shortOver = round2(totalIn - totalOut);
  const insideSale = round2(totalSalesFromDepts); // Non-lottery store sales
  const salesTax   = saved?.salesTaxOverride != null ? Number(saved.salesTaxOverride) : pos.totals.tax;

  return {
    date: dateStr,
    storeId,

    // ── Lottery block ──
    lottery: {
      lottoSales:       lotto.lottoSalesTotal,
      scratchoffSales:  lotto.scratchoffSalesTotal,
      lottoPO:          lotto.lottoPO,
      scratchoffPO:     lotto.scratchoffPO,
      instantCashing:   lotto.instantCashing,
      machineSales:     lotto.machineSales,
      machineCashing:   lotto.machineCashing,
      cashBalance:      round2(
        lotto.lottoSalesTotal + lotto.scratchoffSalesTotal
        - lotto.lottoPO - lotto.scratchoffPO
      ),
    },

    // ── Dept sales ──
    departments: deptRows,
    totalSales:  totalSalesFromDepts,

    // ── Tax / totalizer ──
    totalizerBegin: saved?.totalizerBegin ?? null,
    totalizerEnd:   saved?.totalizerEnd   ?? null,
    voids:          saved?.voids          ?? 0,
    customerCount:  saved?.customerCount  ?? pos.totals.txCount,
    reportNumbers:  saved?.reportNumbers  || null,
    salesTax,

    // ── Other inflows ──
    otherIncome,
    moneyIn,

    // ── Tenders / store money ──
    tenders: pos.tenders,
    creditCardTotal: round2(creditCardTotal),
    debitCardTotal:  round2(debitCardTotal),
    bankDeposit,
    lotteryDeposit,

    // ── Cash reconciliation ──
    cashCounted:     round2(cashCounted),
    cashAdjustment:  round2(saved?.cashAdjustment || 0),
    cashFromShifts:  shift,

    // ── Paidouts ──
    purchaseCashPO: round2(purchaseCashPO),
    expenseCashPO:  round2(expenseCashPO),
    paidoutsSource: paidouts.items,

    // ── House Accounts ──
    houseAccounts,
    houseTotal,

    // ── Totals ──
    totalIn, totalOut, shortOver, insideSale,

    // ── Meta ──
    notes: saved?.notes || null,
    status: saved?.status || 'draft',
    closedAt: saved?.closedAt || null,
    closedById: saved?.closedById || null,
    savedAt: saved?.updatedAt || null,
  };
}

/**
 * Persist only the user-adjustable fields. Auto-derived totals are NOT saved.
 */
export async function saveDailySaleAdjustments({ orgId, storeId, dateStr, userId, body }) {
  const date = new Date(dateStr + 'T00:00:00Z');
  const {
    deptAdjustments, totalizerBegin, totalizerEnd, voids, customerCount, reportNumbers,
    salesTaxOverride, otherIncome, moneyIn,
    cashCounted, cashAdjustment,
    bankDeposit, lotteryDeposit, creditCardTotal, debitCardTotal,
    purchaseCashPO, expenseCashPO, houseAccounts, notes,
  } = body || {};

  const data = {
    ...(Array.isArray(deptAdjustments) && { deptAdjustments }),
    ...(totalizerBegin    != null && { totalizerBegin:    Number(totalizerBegin) }),
    ...(totalizerEnd      != null && { totalizerEnd:      Number(totalizerEnd) }),
    ...(voids             != null && { voids:             Number(voids) }),
    ...(customerCount     != null && { customerCount:     parseInt(customerCount) || null }),
    ...(reportNumbers     != null && { reportNumbers }),
    ...(salesTaxOverride  != null && { salesTaxOverride:  Number(salesTaxOverride) }),
    ...(otherIncome       != null && { otherIncome:       Number(otherIncome) }),
    ...(moneyIn           != null && { moneyIn:           Number(moneyIn) }),
    ...(cashCounted       != null && { cashCounted:       Number(cashCounted) }),
    ...(cashAdjustment    != null && { cashAdjustment:    Number(cashAdjustment) }),
    ...(bankDeposit       != null && { bankDeposit:       Number(bankDeposit) }),
    ...(lotteryDeposit    != null && { lotteryDeposit:    Number(lotteryDeposit) }),
    ...(creditCardTotal   != null && { creditCardTotal:   Number(creditCardTotal) }),
    ...(debitCardTotal    != null && { debitCardTotal:    Number(debitCardTotal) }),
    ...(purchaseCashPO    != null && { purchaseCashPO:    Number(purchaseCashPO) }),
    ...(expenseCashPO     != null && { expenseCashPO:     Number(expenseCashPO) }),
    ...(Array.isArray(houseAccounts) && { houseAccounts }),
    ...(notes != null && { notes }),
  };

  await prisma.dailySaleReport.upsert({
    where:  { orgId_storeId_date: { orgId, storeId, date } },
    update: data,
    create: { orgId, storeId, date, ...data },
  });

  return computeDailySale({ orgId, storeId, dateStr });
}

/**
 * Flip the row to 'closed' status. Caller should re-fetch the snapshot.
 */
export async function closeDailySale({ orgId, storeId, dateStr, userId }) {
  const date = new Date(dateStr + 'T00:00:00Z');
  await prisma.dailySaleReport.upsert({
    where:  { orgId_storeId_date: { orgId, storeId, date } },
    update: { status: 'closed', closedAt: new Date(), closedById: userId || null },
    create: { orgId, storeId, date, status: 'closed', closedAt: new Date(), closedById: userId || null },
  });
  return computeDailySale({ orgId, storeId, dateStr });
}

// Pure test-friendly exports
export const __test = { round2, dayBoundsUTC };
