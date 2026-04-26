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

import type { Prisma } from '@prisma/client';
import prisma from '../../../config/postgres.js';
import { getAdapter } from '../adapters/_registry.js';
import type { SettlementRules, StateCode } from '../adapters/_base.js';

/** A LotteryBox row joined with its LotteryGame. */
type LotteryBoxWithGame = Prisma.LotteryBoxGetPayload<{ include: { game: true } }>;

export interface WeekRange {
  start: Date;
  end: Date;
  due: Date;
}

export interface ComputeSettlementInput {
  orgId: string;
  storeId: string;
  weekStart: Date | string | number;
  weekEnd: Date | string | number;
  stateCode?: StateCode | null;
  commissionRate?: number;
}

export interface CommissionRates {
  instantSales: number;
  instantCashing: number;
  machineSales: number;
  machineCashing: number;
}

export interface SettlementResult {
  // Online (draw-game) breakdown
  onlineGross: number;
  onlineCashings: number;
  onlineCommission: number;
  machineSalesComm: number;
  machineCashingComm: number;

  // Instant (scratch) breakdown
  instantSales: number;
  instantPayouts: number;
  instantSalesComm: number;
  instantCashingComm: number;
  instantSalesSource: 'snapshot' | 'pos_fallback' | 'empty';

  // Returns + totals
  returnsDeduction: number;
  totalCommission: number;
  grossBeforeCommission: number;
  totalDue: number;

  // Rate sources (for UI transparency)
  rates: CommissionRates;

  // Book lists
  settledBookIds: string[];
  returnedBookIds: string[];
  unsettledBookIds: string[];
  rulesApplied: Partial<SettlementRules>;
}

/**
 * Given any date + a day-of-week integer (0=Sun … 6=Sat), find the most
 * recent occurrence of that day on or before the input date. Used to
 * compute the weekStart for a given business date.
 */
export function weekStartFor(date: Date | string | number, weekStartDay: number = 0): Date {
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
export function weekRangeFor(date: Date | string | number, weekStartDay: number = 0): WeekRange {
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
export function recentWeeks(
  asOfDate: Date | string | number,
  count: number,
  weekStartDay: number = 0,
): WeekRange[] {
  const weeks: WeekRange[] = [];
  const cursor = weekStartFor(asOfDate, weekStartDay);
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
export function isBookEligible(
  box: LotteryBoxWithGame | null | undefined,
  weekEnd: Date,
  rules: Partial<SettlementRules> = {},
): boolean {
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

type OnlineRow = { instantCashing: Prisma.Decimal | number | null; machineSales: Prisma.Decimal | number | null; machineCashing: Prisma.Decimal | number | null };
type ScanEventRow = { boxId: string; parsed: Prisma.JsonValue; createdAt: Date };
type SaleTxRow = { amount: Prisma.Decimal | number | null };

/**
 * Compute a settlement snapshot for a store + week. Returns the fields
 * ready to be persisted as a LotteryWeeklySettlement row.
 *
 * Does NOT persist. Caller handles the prisma upsert.
 */
export async function computeSettlement(
  { orgId, storeId, weekStart, weekEnd, stateCode, commissionRate = 0 }: ComputeSettlementInput,
): Promise<SettlementResult> {
  const rules: Partial<SettlementRules> = getAdapter(stateCode)?.settlementRules || {};

  const dayStart = new Date(weekStart); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd   = new Date(weekEnd);   dayEnd.setUTCHours(23, 59, 59, 999);

  // ── Commission rates — 3e per-source rates from State, with fallback
  // to per-store LotterySettings.commissionRate. If the State row has any
  // per-stream rate set, we use the full 4-rate breakdown; otherwise every
  // stream gets the legacy flat rate.
  const state = stateCode
    ? await prisma.state.findUnique({ where: { code: String(stateCode).toUpperCase() } }).catch(() => null)
    : null;
  const legacyRate = Number(commissionRate || (state as { defaultLotteryCommission?: unknown } | null)?.defaultLotteryCommission || 0);
  const rateOf = (streamField: keyof CommissionRates | string): number => {
    const v = (state as Record<string, unknown> | null)?.[streamField];
    return v != null ? Number(v) : legacyRate;
  };
  const rates: CommissionRates = {
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
  }) as OnlineRow[];
  const onlineGross    = onlineRows.reduce((s: number, r: OnlineRow) => s + Number(r.machineSales || 0),   0);
  const machineCashing = onlineRows.reduce((s: number, r: OnlineRow) => s + Number(r.machineCashing || 0), 0);
  const instantCashingDrawer = onlineRows.reduce((s: number, r: OnlineRow) => s + Number(r.instantCashing || 0), 0);
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
  }) as LotteryBoxWithGame[];

  const settled: LotteryBoxWithGame[] = [];
  const returned: LotteryBoxWithGame[] = [];
  const unsettled: LotteryBoxWithGame[] = [];
  for (const b of candidateBoxes) {
    if (b.status === 'returned') returned.push(b);
    else if (isBookEligible(b, dayEnd, rules)) settled.push(b);
    else if (b.status === 'active') unsettled.push(b);
  }

  // ── Instant Sales (per-WEEK ticket math, not cumulative) ──────────
  //
  // The old impl summed `box.ticketsSold * box.ticketPrice` for every
  // settled/returned book. That double-counts every active book in every
  // week (because ticketsSold is cumulative since activation, not weekly)
  // and back-attributes a depleted book's lifetime sales to whichever
  // week it happened to deplete. Industry-correct settlement is:
  //
  //   instantSales = Σ (yesterdayCloseTicket − todayCloseTicket) × price
  //   summed across every close_day_snapshot day in the week, for every
  //   active OR settled-this-week OR returned-this-week book.
  //
  // This matches what the dashboard/report/commission endpoints now do
  // (see _realSalesRange in lotteryController.js) so all four surfaces
  // use the same source of truth: the close_day_snapshot trail.
  const eligibleBoxIds = [...settled, ...returned, ...unsettled].map((b: LotteryBoxWithGame) => b.id);
  let instantSales = 0;
  let instantSalesSource: SettlementResult['instantSalesSource'] = 'empty';
  if (eligibleBoxIds.length) {
    const weekClosingEvents = await prisma.lotteryScanEvent.findMany({
      where: {
        orgId, storeId,
        action: 'close_day_snapshot',
        boxId: { in: eligibleBoxIds },
        createdAt: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { createdAt: 'asc' },
      select: { boxId: true, parsed: true, createdAt: true },
    }) as ScanEventRow[];
    const priorEvents = await prisma.lotteryScanEvent.findMany({
      where: {
        orgId, storeId,
        action: 'close_day_snapshot',
        boxId: { in: eligibleBoxIds },
        createdAt: { lt: dayStart },
      },
      orderBy: { createdAt: 'desc' },
      select: { boxId: true, parsed: true, createdAt: true },
    }) as ScanEventRow[];
    // For each eligible box: walk this week's snapshot trail, computing
    // |prev − today| × price. The "prev" pointer starts at the latest
    // close BEFORE the week (or, for first-week-of-life books, the box's
    // startTicket, or, if even that is null, the fresh-from-pack opening).
    const settings = await prisma.lotterySettings.findUnique({
      where: { storeId },
      select: { sellDirection: true },
    }).catch(() => null);
    const sellDir = settings?.sellDirection || 'desc';
    function freshOpening(box: LotteryBoxWithGame): number | null {
      if (box.startTicket != null) return Number(box.startTicket);
      const total = Number(box.totalTickets || 0);
      if (!total) return null;
      return sellDir === 'asc' ? 0 : total - 1;
    }
    const priorByBox = new Map<string, number | null>();
    for (const ev of priorEvents) {
      if (!priorByBox.has(ev.boxId)) {
        const t = (ev.parsed as { currentTicket?: unknown } | null)?.currentTicket;
        priorByBox.set(ev.boxId, t != null ? Number(t) : null);
      }
    }
    const weekBoxMap = new Map<string, LotteryBoxWithGame>(
      [...settled, ...returned, ...unsettled].map((b: LotteryBoxWithGame) => [b.id, b] as const),
    );
    const weekByBox = new Map<string, ScanEventRow[]>();
    for (const ev of weekClosingEvents) {
      const list = weekByBox.get(ev.boxId);
      if (list) list.push(ev);
      else weekByBox.set(ev.boxId, [ev]);
    }
    for (const [boxId, events] of weekByBox.entries()) {
      const box = weekBoxMap.get(boxId);
      if (!box) continue;
      const price = Number(box.ticketPrice || 0);
      let cursor: number | null | undefined = priorByBox.get(boxId);
      if (cursor == null) cursor = freshOpening(box);
      if (cursor == null) continue;
      for (const ev of events) {
        const cur = (ev.parsed as { currentTicket?: unknown } | null)?.currentTicket;
        if (cur == null) continue;
        const today = Number(cur);
        if (!Number.isFinite(today)) continue;
        instantSales += Math.abs(cursor - today) * price;
        cursor = today;
      }
    }
    if (instantSales > 0) instantSalesSource = 'snapshot';
  }

  // POS-fallback for instantSales when the snapshot trail is empty for
  // this week. Mirrors the same fallback in the controller's
  // _bestEffortDailySales — use LotteryTransaction.amount as a last-resort
  // signal so settlement reports show non-zero numbers when the cashier
  // rang sales up but never ran the EoD wizard.
  if (instantSales === 0) {
    const saleTxs = await prisma.lotteryTransaction.findMany({
      where: {
        orgId, storeId,
        type: 'sale',
        createdAt: { gte: dayStart, lte: dayEnd },
      },
      select: { amount: true },
    }) as SaleTxRow[];
    if (saleTxs.length) {
      instantSales = saleTxs.reduce((s: number, t: SaleTxRow) => s + Number(t.amount || 0), 0);
      instantSalesSource = 'pos_fallback';
    }
  }

  // ── Returns deduction (unsold tickets on returned books) ──────────
  // returnedAt-this-week books are measured at their final scan position.
  // Use the box's currentTicket (the cashier-app's saveLotteryShiftReport
  // updates this) to derive how many tickets are still on the book.
  let returnsDeduction = 0;
  for (const b of returned) {
    const total = Number(b.totalTickets || 0);
    // Prefer currentTicket-derived "tickets remaining" — for a descending
    // book, remaining = currentTicket + 1 (e.g. currentTicket=10 means
    // tickets 0..10 are still on the book = 11 tickets). For ascending,
    // remaining = total - currentTicket. Fall back to the legacy aggregate
    // when no currentTicket is set.
    let remaining: number;
    const ct = b.currentTicket != null ? Number(b.currentTicket) : null;
    if (ct != null && Number.isFinite(ct)) {
      remaining = (b.startTicket != null && Number(b.startTicket) === 0)
        ? Math.max(0, total - ct)              // ascending
        : Math.max(0, ct + 1);                 // descending (default)
      remaining = Math.min(remaining, total);
    } else {
      remaining = Math.max(0, total - Number(b.ticketsSold || 0));
    }
    returnsDeduction += remaining * Number(b.ticketPrice || 0);
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
  }) as SaleTxRow[];
  const scratchPayouts = payoutRows.reduce((s: number, r: SaleTxRow) => s + Number(r.amount || 0), 0);
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
    instantSalesSource,           // 'snapshot' | 'pos_fallback' | 'empty'

    // Returns + totals
    returnsDeduction:    round2(returnsDeduction),
    totalCommission:     round2(totalCommission),
    grossBeforeCommission: round2(grossBeforeCommission),
    totalDue,

    // Rate sources (for UI transparency)
    rates,

    // Book lists
    settledBookIds:    settled.map((b: LotteryBoxWithGame) => b.id),
    returnedBookIds:   returned.map((b: LotteryBoxWithGame) => b.id),
    unsettledBookIds:  unsettled.map((b: LotteryBoxWithGame) => b.id),
    rulesApplied:      rules,
  };
}

function round2(n: unknown): number {
  return Math.round(Number(n || 0) * 100) / 100;
}
