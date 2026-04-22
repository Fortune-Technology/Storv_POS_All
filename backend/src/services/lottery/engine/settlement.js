// Weekly Settlement Engine — Phase 2.
//
// Turns raw lottery activity (LotteryBox, LotteryTransaction, LotteryOnlineTotal)
// into the weekly reconciliation the store owes the lottery commission.
//
// The math mirrors Elistars' Weekly Settlement card:
//
//   Online Due = onlineGross − onlineCashings − onlineCommission
//   Instant Due = instantSales − instantSalesComm − instantCashingComm − returnsDeduction
//   Total Due = Online Due + Instant Due + bonus + serviceCharge + adjustments
//
// A book is eligible for settlement when any of these trigger, per the
// state adapter's rules:
//   - % sold >= pctThreshold (e.g. MA: 80%)
//   - days active >= maxDaysActive (e.g. MA: 180 days)
//   - status transitioned to 'depleted' or 'returned' during the week
//
// The engine is pure compute — it never persists. Callers wrap it with
// prisma upsert when they want to save the settlement row.

import prisma from '../../../config/postgres.js';
import { getAdapter } from '../adapters/_registry.js';

/**
 * Given any date + a day-of-week integer (0=Sun … 6=Sat), find the most
 * recent occurrence of that day on or before the input date. Used to
 * compute the weekStart for a given business date.
 */
export function weekStartFor(date, weekStartDay = 0) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const dow = d.getUTCDay();
  const diff = (dow - weekStartDay + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

/**
 * Full week range: { start, end (inclusive, 6 days after start), due }.
 * Due date conventionally the day after weekEnd (Monday for a Sun-Sat week).
 */
export function weekRangeFor(date, weekStartDay = 0) {
  const start = weekStartFor(date, weekStartDay);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const due = new Date(end);
  due.setUTCDate(due.getUTCDate() + 1);
  return { start, end, due };
}

/**
 * Iterate N weeks ending on or before the given date (most recent first).
 */
export function recentWeeks(asOfDate, count, weekStartDay = 0) {
  const weeks = [];
  let cursor = weekStartFor(asOfDate, weekStartDay);
  for (let i = 0; i < count; i += 1) {
    const start = new Date(cursor);
    const end = new Date(cursor);
    end.setUTCDate(end.getUTCDate() + 6);
    const due = new Date(end);
    due.setUTCDate(due.getUTCDate() + 1);
    weeks.push({ start, end, due });
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  return weeks;
}

/**
 * Does this box qualify for settlement in the given week?
 * Rules cascade:
 *   1. If status ∈ {depleted, returned, settled} and the transition happened
 *      within the week → eligible, always.
 *   2. If status === 'active' and sold-percentage ≥ pctThreshold → eligible.
 *   3. If status === 'active' and (now - activatedAt) ≥ maxDaysActive → eligible.
 *
 * When rules are null (not yet configured per state), only rule 1 fires —
 * this is the safe default that avoids premature settlement.
 */
export function isBookEligible(box, weekEnd, rules = {}) {
  if (!box) return false;
  const { pctThreshold, maxDaysActive } = rules || {};
  const statusDate =
    (box.depletedAt && new Date(box.depletedAt)) ||
    (box.returnedAt && new Date(box.returnedAt)) ||
    null;

  if (['depleted', 'returned', 'settled'].includes(box.status)) {
    if (!statusDate) return true; // retro status without a date → let it settle
    return statusDate <= weekEnd;
  }

  if (box.status !== 'active') return false;

  const totalTickets = Number(box.totalTickets || 0);
  const ticketsSold  = Number(box.ticketsSold || 0);
  const pct = totalTickets > 0 ? (ticketsSold / totalTickets) * 100 : 0;

  if (pctThreshold != null && pct >= Number(pctThreshold)) return true;

  if (maxDaysActive != null && box.activatedAt) {
    const elapsedMs = weekEnd.getTime() - new Date(box.activatedAt).getTime();
    const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
    if (elapsedDays >= Number(maxDaysActive)) return true;
  }

  return false;
}

/**
 * Compute a settlement snapshot for a store + week. Returns the fields
 * ready to be persisted as a LotteryWeeklySettlement row.
 *
 * Does NOT persist. Caller handles the prisma upsert.
 */
export async function computeSettlement({ orgId, storeId, weekStart, weekEnd, stateCode, commissionRate = 0 }) {
  const rules = getAdapter(stateCode)?.settlementRules || {};

  const dayStart = new Date(weekStart); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd   = new Date(weekEnd);   dayEnd.setUTCHours(23, 59, 59, 999);

  // ── Commission rates — 3e per-source rates from State, with fallback
  // to per-store LotterySettings.commissionRate. If the State row has any
  // per-stream rate set, we use the full 4-rate breakdown; otherwise every
  // stream gets the legacy flat rate.
  const state = stateCode
    ? await prisma.state.findUnique({ where: { code: String(stateCode).toUpperCase() } }).catch(() => null)
    : null;
  const legacyRate = Number(commissionRate || state?.defaultLotteryCommission || 0);
  const rateOf = (streamField) => {
    const v = state?.[streamField];
    return v != null ? Number(v) : legacyRate;
  };
  const rates = {
    instantSales:   rateOf('instantSalesCommRate'),
    instantCashing: rateOf('instantCashingCommRate'),
    machineSales:   rateOf('machineSalesCommRate'),
    machineCashing: rateOf('machineCashingCommRate'),
  };

  // ── Online totals (sum of daily LotteryOnlineTotal rows) ──────────
  const onlineRows = await prisma.lotteryOnlineTotal.findMany({
    where: {
      orgId, storeId,
      date: { gte: dayStart, lte: dayEnd },
    },
    select: { instantCashing: true, machineSales: true, machineCashing: true },
  });
  const onlineGross    = onlineRows.reduce((s, r) => s + Number(r.machineSales || 0),   0);
  const machineCashing = onlineRows.reduce((s, r) => s + Number(r.machineCashing || 0), 0);
  const instantCashingDrawer = onlineRows.reduce((s, r) => s + Number(r.instantCashing || 0), 0);
  const onlineCashings = machineCashing + instantCashingDrawer;
  // Commission on online: (machineSales × machineSalesComm) + (machineCashing × machineCashingComm)
  const machineSalesCommAmt   = onlineGross    * rates.machineSales;
  const machineCashingCommAmt = machineCashing * rates.machineCashing;
  const onlineCommission = machineSalesCommAmt + machineCashingCommAmt;

  // ── Candidate books: those active-or-settled at any point in the week ─
  const candidateBoxes = await prisma.lotteryBox.findMany({
    where: {
      orgId, storeId,
      OR: [
        { status: 'active' },
        { depletedAt: { gte: dayStart, lte: dayEnd } },
        { returnedAt: { gte: dayStart, lte: dayEnd } },
        // Books already settled but within this week (idempotent re-compute)
        { status: 'settled', updatedAt: { gte: dayStart, lte: dayEnd } },
      ],
    },
    include: { game: true },
  });

  const settled = [];
  const returned = [];
  const unsettled = [];
  for (const b of candidateBoxes) {
    if (b.status === 'returned') returned.push(b);
    else if (isBookEligible(b, dayEnd, rules)) settled.push(b);
    else if (b.status === 'active') unsettled.push(b);
  }

  // ── Instant Sales (value of tickets sold from settled + returned books) ─
  let instantSales = 0;
  for (const b of [...settled, ...returned]) {
    instantSales += Number(b.ticketsSold || 0) * Number(b.ticketPrice || 0);
  }

  // ── Returns deduction (unsold tickets on returned books) ──────────
  let returnsDeduction = 0;
  for (const b of returned) {
    const unsold = Math.max(0, Number(b.totalTickets || 0) - Number(b.ticketsSold || 0));
    returnsDeduction += unsold * Number(b.ticketPrice || 0);
  }

  // ── Per-source commission ────────────────────────────────────────
  const instantSalesComm = instantSales * rates.instantSales;

  const payoutRows = await prisma.lotteryTransaction.findMany({
    where: {
      orgId, storeId,
      type: 'payout',
      createdAt: { gte: dayStart, lte: dayEnd },
    },
    select: { amount: true },
  });
  const scratchPayouts = payoutRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const instantCashingComm = (scratchPayouts + instantCashingDrawer) * rates.instantCashing;

  // ── Daily & Weekly totals ───────────────────────────────────────
  //
  // Daily formula (per user): Total Due = Instant sales − Instant cashings
  //                                      + Machine sales − Machine cashings
  // We compute "gross" (before commissions) and "net" (after) for clarity.
  const grossBeforeCommission = (instantSales - (scratchPayouts + instantCashingDrawer))
                              + (onlineGross - machineCashing);
  const totalCommission = instantSalesComm + instantCashingComm + machineSalesCommAmt + machineCashingCommAmt;
  // Subtract returns (unsold ticket value) from what's owed. Commissions
  // are earnings so they REDUCE the store's debt to the lottery.
  const totalDueBeforeAdjustments = grossBeforeCommission - returnsDeduction - totalCommission;
  const totalDue = Math.round(totalDueBeforeAdjustments * 100) / 100;

  return {
    // Online (draw-game) breakdown
    onlineGross:         round2(onlineGross),
    onlineCashings:      round2(onlineCashings),
    onlineCommission:    round2(onlineCommission),
    machineSalesComm:    round2(machineSalesCommAmt),
    machineCashingComm:  round2(machineCashingCommAmt),

    // Instant (scratch) breakdown
    instantSales:        round2(instantSales),
    instantPayouts:      round2(scratchPayouts + instantCashingDrawer),
    instantSalesComm:    round2(instantSalesComm),
    instantCashingComm:  round2(instantCashingComm),

    // Returns + totals
    returnsDeduction:    round2(returnsDeduction),
    totalCommission:     round2(totalCommission),
    grossBeforeCommission: round2(grossBeforeCommission),
    totalDue,

    // Rate sources (for UI transparency)
    rates,

    // Book lists
    settledBookIds:    settled.map((b) => b.id),
    returnedBookIds:   returned.map((b) => b.id),
    unsettledBookIds:  unsettled.map((b) => b.id),
    rulesApplied:      rules,
  };
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}
