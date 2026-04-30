/**
 * Lottery ticket-math sales — the authoritative source.
 *
 * The cashier-app's `LotteryTransaction` rows are unreliable: cashiers
 * sometimes skip ringing up tickets, partially ring them, or hand out
 * tickets based on machine cashings without ever creating a transaction.
 * The TRUE source of "what was sold" is the change in each active book's
 * `currentTicket` between consecutive `close_day_snapshot` events — the
 * physical ticket count, which the state lottery commission uses too.
 *
 * This module owns the three-tier resolution:
 *   1. SNAPSHOT  — close_day_snapshot delta (authoritative)
 *   2. LIVE      — yesterday's snapshot vs `box.currentTicket` (today only)
 *   3. POS       — sum of `LotteryTransaction.amount` (last-resort fallback)
 *
 * Originally inlined in `lotteryController.ts` as `_realSalesFromSnapshots`,
 * `_bestEffortDailySales`, `_liveSalesFromCurrentTickets`, `_realSalesRange`.
 * Extracted to this service so the new shift-reconciliation service can
 * reuse the same logic without duplication.
 */

import prisma from '../../../config/postgres.js';
import type {
  BoxSale,
  DailySalesResult,
  DailySalesArgs,
  BestEffortArgs,
  RangeSalesArgs,
  RangeSalesResult,
  SnapshotSalesResult,
  GameSale,
  SalesSource,
} from './types.js';

type ScanEventParsed = Record<string, unknown>;

interface BoxSnapshotRow {
  id: string;
  ticketPrice: number | string;
  startTicket: string | null;
  totalTickets: number | null;
  currentTicket?: string | null;
  // Apr 2026 — needed for the snapshot fallback chain. When a book has no
  // prior close_day_snapshot but DOES have a recorded prior shift end
  // (lastShiftEndTicket from saveLotteryShiftReport), that's a far better
  // "yesterday" approximation than freshOpeningPosition (which assumes the
  // book is brand-new). Prevents catastrophic over-attribution when a SO
  // button is clicked on a book that's been selling for days without EoD.
  lastShiftEndTicket?: string | null;
  gameId?: string | null;
}

/**
 * Tier 1 — Authoritative snapshot delta for a single day.
 *
 * For every active book on `dayStart..dayEnd`, computes
 *   |yesterdayClose − todayClose| × ticketPrice
 * Returns 0 when the day has no `close_day_snapshot` events.
 */
export async function snapshotSales(args: DailySalesArgs): Promise<SnapshotSalesResult> {
  const { orgId, storeId, dayStart, dayEnd } = args;

  // Closes for THIS day (latest per box)
  const todayEvents = await prisma.lotteryScanEvent.findMany({
    where: {
      orgId,
      storeId,
      action: 'close_day_snapshot',
      createdAt: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { createdAt: 'desc' },
    select: { boxId: true, parsed: true },
  });
  const todayMap = new Map<string, string | null>();
  for (const ev of todayEvents) {
    if (ev.boxId && !todayMap.has(ev.boxId)) {
      const parsed = ev.parsed as ScanEventParsed | null;
      todayMap.set(ev.boxId, (parsed?.currentTicket as string | null | undefined) ?? null);
    }
  }
  if (todayMap.size === 0) return { totalSales: 0, byBox: new Map() };

  // Closes BEFORE this day (latest per box) — yesterday's close
  const prevEvents = await prisma.lotteryScanEvent.findMany({
    where: {
      orgId,
      storeId,
      action: 'close_day_snapshot',
      createdAt: { lt: dayStart },
      boxId: { in: [...todayMap.keys()] },
    },
    orderBy: { createdAt: 'desc' },
    select: { boxId: true, parsed: true },
  });
  const prevMap = new Map<string, string | null>();
  for (const ev of prevEvents) {
    if (ev.boxId && !prevMap.has(ev.boxId)) {
      const parsed = ev.parsed as ScanEventParsed | null;
      prevMap.set(ev.boxId, (parsed?.currentTicket as string | null | undefined) ?? null);
    }
  }

  // Need ticketPrice + startTicket + lastShiftEndTicket per box. The fallback
  // chain (when no prior close_day_snapshot exists) is documented in
  // priorPosition() below.
  const boxes = (await prisma.lotteryBox.findMany({
    where: { id: { in: [...todayMap.keys()] } },
    select: {
      id: true,
      ticketPrice: true,
      startTicket: true,
      totalTickets: true,
      lastShiftEndTicket: true,
    },
  })) as BoxSnapshotRow[];
  const boxMap = new Map<string, BoxSnapshotRow>(boxes.map((b) => [b.id, b]));

  // sellDirection drives the "fresh book opening" position when prev is null.
  const settings = await prisma.lotterySettings
    .findUnique({ where: { storeId }, select: { sellDirection: true } })
    .catch(() => null);
  const sellDirection = settings?.sellDirection || 'desc';

  /**
   * Resolve the "prior position" for a book when no close_day_snapshot
   * exists before today. Priority chain:
   *
   *   1. lastShiftEndTicket — the most recent recorded shift-end position
   *      (saveLotteryShiftReport sets this). Best approximation of where
   *      the book ACTUALLY was at the start of today, even if no daily
   *      snapshot was written.
   *   2. startTicket — the book's opening position (used when the book is
   *      truly fresh / activated today and never closed).
   *   3. Direction-derived position — for books with no startTicket either
   *      (legacy data); falls back to totalTickets-1 (desc) or 0 (asc).
   *
   * The previous implementation skipped step 1, which caused the SO button
   * to over-attribute the FULL pack as today's sales whenever a book had
   * been selling for days without EoD scans. Example: 100-pack at $10,
   * pre-SO position 50 (lastShiftEndTicket=50), SO clicked today (snapshot
   * writes -1). With the old chain: prev=99 (startTicket), today=-1,
   * sold=100 → $1000. With the new chain: prev=50, today=-1, sold=51 →
   * $510. Still over-attributes by a bit (SO writes -1 even when not all
   * remaining tickets sold today), but no longer catastrophically.
   */
  function priorPosition(box: BoxSnapshotRow): string | null {
    if (box.lastShiftEndTicket != null && box.lastShiftEndTicket !== '')
      return box.lastShiftEndTicket;
    if (box.startTicket != null) return box.startTicket;
    const total = Number(box.totalTickets || 0);
    if (!total) return null;
    return sellDirection === 'asc' ? '0' : String(total - 1);
  }

  let totalSales = 0;
  const byBox = new Map<string, BoxSale>();
  for (const [boxId, todayTicketStr] of todayMap.entries()) {
    if (todayTicketStr == null || todayTicketStr === '') continue;
    const todayTicket = parseInt(todayTicketStr, 10);
    if (!Number.isFinite(todayTicket)) continue;
    const box = boxMap.get(boxId);
    if (!box) continue;

    const prevTicketStr = prevMap.get(boxId) ?? priorPosition(box);
    const prevTicket = prevTicketStr != null ? parseInt(prevTicketStr, 10) : NaN;
    if (!Number.isFinite(prevTicket)) continue;

    const sold = Math.abs(prevTicket - todayTicket);
    const price = Number(box.ticketPrice || 0);
    const amount = sold * price;
    totalSales += amount;
    byBox.set(boxId, { sold, price, amount });
  }
  return { totalSales: Math.round(totalSales * 100) / 100, byBox };
}

/**
 * Tier 2 — Live in-progress delta for TODAY only.
 *
 * Compares each active box's `currentTicket` (live, updated by the cashier-
 * app's POS scan flow) against its latest `close_day_snapshot` from BEFORE
 * `dayStart`. Catches sales as they happen — before the EoD wizard runs.
 */
export async function liveSalesFromCurrentTickets(args: {
  orgId: string;
  storeId: string;
  dayStart: Date;
}): Promise<SnapshotSalesResult> {
  const { orgId, storeId, dayStart } = args;

  const activeBoxes = (await prisma.lotteryBox.findMany({
    where: { orgId, storeId, status: 'active' },
    select: {
      id: true,
      ticketPrice: true,
      totalTickets: true,
      currentTicket: true,
      startTicket: true,
      lastShiftEndTicket: true,
      gameId: true,
    },
  })) as BoxSnapshotRow[];
  if (!activeBoxes.length) return { totalSales: 0, byBox: new Map() };

  const priorEvents = await prisma.lotteryScanEvent.findMany({
    where: {
      orgId,
      storeId,
      action: 'close_day_snapshot',
      createdAt: { lt: dayStart },
      boxId: { in: activeBoxes.map((b) => b.id) },
    },
    orderBy: { createdAt: 'desc' },
    select: { boxId: true, parsed: true },
  });
  const priorByBox = new Map<string, number | null>();
  for (const ev of priorEvents) {
    if (ev.boxId && !priorByBox.has(ev.boxId)) {
      const parsed = ev.parsed as ScanEventParsed | null;
      const t = parsed?.currentTicket as string | number | null | undefined;
      priorByBox.set(ev.boxId, t != null ? Number(t) : null);
    }
  }

  const settings = await prisma.lotterySettings
    .findUnique({ where: { storeId }, select: { sellDirection: true } })
    .catch(() => null);
  const sellDir = settings?.sellDirection || 'desc';

  let totalSales = 0;
  const byBox = new Map<string, BoxSale>();
  for (const b of activeBoxes) {
    const cur = b.currentTicket != null ? Number(b.currentTicket) : null;
    if (cur == null || !Number.isFinite(cur)) continue;

    // Same priority chain as snapshotSales.priorPosition — see that
    // function's docblock for rationale. lastShiftEndTicket beats
    // startTicket when both exist; startTicket beats direction-derived
    // fallback. Without this, a SO click on a long-active book would
    // attribute its full pack as "sold today".
    let prev: number | null | undefined = priorByBox.get(b.id);
    if (prev == null && b.lastShiftEndTicket != null && b.lastShiftEndTicket !== '') {
      prev = Number(b.lastShiftEndTicket);
    }
    if (prev == null && b.startTicket != null) prev = Number(b.startTicket);
    if (prev == null) {
      const total = Number(b.totalTickets || 0);
      if (!total) continue;
      prev = sellDir === 'asc' ? 0 : total - 1;
    }
    if (!Number.isFinite(prev)) continue;

    const sold = Math.abs((prev as number) - cur);
    if (sold === 0) continue;
    const price = Number(b.ticketPrice || 0);
    const amount = sold * price;
    totalSales += amount;
    byBox.set(b.id, { sold, price, amount });
  }
  return { totalSales: Math.round(totalSales * 100) / 100, byBox };
}

/**
 * Best-effort sales for a single day — walks the 3 fallback tiers. This is
 * the function callers should reach for when they want "the best-available
 * sales number for date X".
 */
export async function bestEffortDailySales(args: BestEffortArgs): Promise<DailySalesResult> {
  const { orgId, storeId, dayStart, dayEnd, isToday = false } = args;

  // Tier 1 — snapshot
  const snap = await snapshotSales({ orgId, storeId, dayStart, dayEnd });
  if (snap.totalSales > 0) {
    return { ...snap, byGame: new Map(), source: 'snapshot' };
  }

  // Tier 2 — TODAY only
  if (isToday) {
    const live = await liveSalesFromCurrentTickets({ orgId, storeId, dayStart });
    if (live.totalSales > 0) {
      return { ...live, byGame: new Map(), source: 'live' };
    }
  }

  // Tier 3 — POS fallback
  const posTxs = await prisma.lotteryTransaction.findMany({
    where: {
      orgId,
      storeId,
      type: 'sale',
      createdAt: { gte: dayStart, lte: dayEnd },
    },
    select: { amount: true, gameId: true, boxId: true },
  });
  if (!posTxs.length) {
    return { totalSales: 0, byBox: new Map(), byGame: new Map(), source: 'empty' };
  }

  const byGame = new Map<string, GameSale>();
  const byBox = new Map<string, BoxSale>();
  let totalSales = 0;
  for (const t of posTxs) {
    const amt = Number(t.amount || 0);
    totalSales += amt;
    if (t.gameId) {
      const cur = byGame.get(t.gameId) || { sales: 0, count: 0 };
      cur.sales += amt;
      cur.count += 1;
      byGame.set(t.gameId, cur);
    }
    if (t.boxId) {
      const cur = byBox.get(t.boxId) || { sold: 0, price: 0, amount: 0 };
      cur.amount += amt;
      cur.sold += 1;
      byBox.set(t.boxId, cur);
    }
  }
  return {
    totalSales: Math.round(totalSales * 100) / 100,
    byBox,
    byGame,
    source: 'pos_fallback',
  };
}

/**
 * Aggregate ticket-math sales across an arbitrary date range. Walks day-
 * by-day calling {@link bestEffortDailySales}. Used by dashboard, reports,
 * commission report, weekly settlement so they all share one source of
 * truth instead of summing `LotteryTransaction` rows directly.
 */
export async function rangeSales(args: RangeSalesArgs): Promise<RangeSalesResult> {
  const { orgId, storeId, from, to } = args;

  const start = new Date(from);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(23, 59, 59, 999);

  const allBoxes = (await prisma.lotteryBox.findMany({
    where: { orgId, storeId },
    select: { id: true, gameId: true },
  })) as Array<{ id: string; gameId: string }>;
  const boxToGame = new Map<string, string>(allBoxes.map((b) => [b.id, b.gameId]));

  const byDay: RangeSalesResult['byDay'] = [];
  const byGame = new Map<string, GameSale>();
  let totalSales = 0;
  const sourcesUsed = new Set<SalesSource>();

  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  let safety = 0;
  const cursor = new Date(start);
  while (cursor <= end && safety++ < 366) {
    const dayStart = new Date(cursor);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(cursor);
    dayEnd.setUTCHours(23, 59, 59, 999);
    const isToday = dayStart.getTime() === now.getTime();

    const day = await bestEffortDailySales({ orgId, storeId, dayStart, dayEnd, isToday });
    sourcesUsed.add(day.source);

    byDay.push({
      date: dayStart.toISOString().slice(0, 10),
      sales: day.totalSales,
      source: day.source,
    });
    totalSales += day.totalSales;

    if (day.byGame && day.byGame.size > 0) {
      for (const [gameId, info] of day.byGame.entries()) {
        const cur = byGame.get(gameId) || { sales: 0, count: 0 };
        cur.sales += info.sales;
        cur.count += info.count;
        byGame.set(gameId, cur);
      }
    } else {
      for (const [boxId, info] of day.byBox.entries()) {
        const gameId = boxToGame.get(boxId) || '_unknown';
        const cur = byGame.get(gameId) || { sales: 0, count: 0 };
        cur.sales += info.amount;
        cur.count += info.sold;
        byGame.set(gameId, cur);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  let source: RangeSalesResult['source'] = 'empty';
  if (sourcesUsed.has('snapshot') && sourcesUsed.size > 1) source = 'mixed';
  else if (sourcesUsed.has('snapshot')) source = 'snapshot';
  else if (sourcesUsed.has('live')) source = 'live';
  else if (sourcesUsed.has('pos_fallback')) source = 'pos_fallback';

  return {
    totalSales: Math.round(totalSales * 100) / 100,
    byDay,
    byGame,
    source,
  };
}

/**
 * Best-effort sales for an arbitrary WINDOW (e.g. a shift's open→close
 * range, not a calendar day). Used by the shift-reconciliation service.
 *
 * Differs from {@link bestEffortDailySales} in that snapshots BEFORE the
 * window are looked up via the window's start as the "before" anchor —
 * i.e. we credit only sales that happened during the shift, not yesterday.
 *
 * The implementation simply walks the window day-by-day and sums the
 * results — which is correct as long as `close_day_snapshot` events fire
 * at most once per box per day (guaranteed by the schema's natural usage).
 */
export async function windowSales(args: {
  orgId: string;
  storeId: string;
  /** Inclusive UTC start of the window. */
  windowStart: Date;
  /** Inclusive UTC end of the window. Defaults to now. */
  windowEnd?: Date;
}): Promise<{
  totalSales: number;
  source: SalesSource;
  windowStart: Date;
  windowEnd: Date;
}> {
  const { orgId, storeId } = args;
  const windowStart = new Date(args.windowStart);
  const windowEnd = new Date(args.windowEnd || new Date());

  // Day-by-day walk so we still respect the snapshot/live/pos fallback per day.
  // Cap iterations at 31 days — a single shift never spans a month, so longer
  // windows are likely a bug (mis-parsed openedAt). Defensive bound only.
  let totalSales = 0;
  const sourcesUsed = new Set<SalesSource>();
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  let safety = 0;
  const cursor = new Date(windowStart);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= windowEnd && safety++ < 31) {
    const dayStart = new Date(cursor);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(cursor);
    dayEnd.setUTCHours(23, 59, 59, 999);
    const isToday = dayStart.getTime() === now.getTime();

    const day = await bestEffortDailySales({ orgId, storeId, dayStart, dayEnd, isToday });
    sourcesUsed.add(day.source);
    totalSales += day.totalSales;

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  let source: SalesSource = 'empty';
  if (sourcesUsed.has('snapshot')) source = 'snapshot';
  else if (sourcesUsed.has('live')) source = 'live';
  else if (sourcesUsed.has('pos_fallback')) source = 'pos_fallback';

  return {
    totalSales: Math.round(totalSales * 100) / 100,
    source,
    windowStart,
    windowEnd,
  };
}
