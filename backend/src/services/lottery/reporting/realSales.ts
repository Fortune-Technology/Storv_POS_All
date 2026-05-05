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

// Timezone-aware day-boundary helpers were inlined here when first introduced
// (B9 — Session 59). Extracted to `utils/dateTz.ts` (Session 60) so other
// reporting surfaces (sales/daily, sales/departments, EoD) can share them
// without depending on the lottery module. Re-exported below for backward
// compat with callers that import from `services/lottery/reporting/index.js`.
import {
  formatLocalDate,
  localDayStartUTC,
  localDayEndUTC,
  addOneDay,
} from '../../../utils/dateTz.js';
export { formatLocalDate, localDayStartUTC, localDayEndUTC };

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
  // May 2026 — needed for first-day-of-activation detection. When a book
  // is activated WITHIN today's window, the EoD wizard's save path also
  // sets lastShiftEndTicket = today's currentTicket; using that as "prior"
  // would yield 0 sales for tickets sold today. priorPosition() detects
  // this case and uses startTicket (the activation position) instead.
  activatedAt?: Date | null;
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

  // Need ticketPrice + startTicket + lastShiftEndTicket + activatedAt per box.
  // The fallback chain (when no prior close_day_snapshot exists) is documented
  // in priorPosition() below. activatedAt drives the first-day-of-activation
  // detection that uses startTicket instead of lastShiftEndTicket as prior.
  const boxes = (await prisma.lotteryBox.findMany({
    where: { id: { in: [...todayMap.keys()] } },
    select: {
      id: true,
      ticketPrice: true,
      startTicket: true,
      totalTickets: true,
      lastShiftEndTicket: true,
      activatedAt: true,
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
   *   1. startTicket (FIRST-DAY-OF-ACTIVATION OVERRIDE) — when the book was
   *      activated within today's window, lastShiftEndTicket is NOT a
   *      reliable "yesterday" because today's EoD wizard run already set
   *      it to today's currentTicket. Using lastShiftEndTicket would yield
   *      0 sales even when tickets were sold today (May 2026 fix —
   *      Highland Liquors May 4: boxes 132560 + 027714 had startTicket=99
   *      and 149, sold 5 + 2 tickets → $50 + $2 disappeared because
   *      lastShiftEndTicket got set to 94 + 147 when the wizard saved).
   *   2. lastShiftEndTicket — the most recent recorded shift-end position
   *      (saveLotteryShiftReport sets this). Best approximation of where
   *      the book ACTUALLY was at the start of today, even if no daily
   *      snapshot was written. Only consulted when the book existed
   *      BEFORE today.
   *   3. startTicket — the book's opening position (legacy fallback when
   *      the book has no lastShiftEndTicket either — typical for very
   *      old data before the lastShiftEndTicket column existed).
   *   4. Direction-derived position — for books with no startTicket either
   *      (legacy data); falls back to totalTickets-1 (desc) or 0 (asc).
   *
   * The previous implementation skipped step 2 entirely, which caused the
   * SO button to over-attribute the FULL pack as today's sales whenever a
   * book had been selling for days without EoD scans. Example: 100-pack
   * at $10, pre-SO position 50 (lastShiftEndTicket=50), SO clicked today
   * (snapshot writes -1). With prev=99 (startTicket): sold=100 → $1000.
   * With prev=50 (lastShiftEndTicket): sold=51 → $510. So step 2 still
   * wins for books that existed before today.
   */
  function priorPosition(box: BoxSnapshotRow): string | null {
    // Step 1: first-day-of-activation override
    if (
      box.activatedAt &&
      box.activatedAt >= dayStart &&
      box.activatedAt <= dayEnd &&
      box.startTicket != null &&
      box.startTicket !== ''
    ) {
      return box.startTicket;
    }
    // Step 2-4: original chain
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
      activatedAt: true,
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
    //
    // May 2026 — first-day-of-activation override: when the book was
    // activated within today's window AND has no prior snapshot, prefer
    // startTicket over lastShiftEndTicket. The wizard's same-day save
    // sets lastShiftEndTicket = today's currentTicket, which would yield
    // 0 sales here. Mirror of the fix in snapshotSales.priorPosition().
    let prev: number | null | undefined = priorByBox.get(b.id);
    const activatedToday =
      b.activatedAt != null &&
      b.activatedAt >= dayStart;
    if (prev == null && activatedToday && b.startTicket != null && b.startTicket !== '') {
      prev = Number(b.startTicket);
    }
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

  // Tier 1 — SNAPSHOT (preferred, authoritative)
  // For each book with a close_day_snapshot today: |prev − today| × price
  const snap = await snapshotSales({ orgId, storeId, dayStart, dayEnd });
  if (snap.totalSales > 0) {
    return { ...snap, byGame: new Map(), source: 'snapshot' };
  }

  // Tier 2 — LIVE delta (TODAY only, when no snapshot tier result)
  // For each active book: |prev_snapshot − box.currentTicket| × price
  if (isToday) {
    const live = await liveSalesFromCurrentTickets({ orgId, storeId, dayStart });
    if (live.totalSales > 0) {
      return { ...live, byGame: new Map(), source: 'live' };
    }
  }

  // Apr 2026 — Tier 3 (POS LotteryTransaction sum) DROPPED per user direction.
  // The user's accounting model is that "Today Sold" / "Instant Sales" should
  // ONLY reflect ticket-math (yesterday's close → today's close × price).
  // POS-rang lottery transactions are a separate audit signal (cashier rang
  // these up at the register; they appear as `posSold` in the daily-inventory
  // response and in the cash-drawer reconciliation), but they do NOT backfill
  // "Today Sold" when no scan / no snapshot exists for the day.
  //
  // Without this, a store that rang up $35 of lottery via POS but didn't scan
  // any books would show $35 as "Today Sold" — confusingly mixing register
  // activity with the "ticket-math truth" headline number.
  //
  // If neither tier 1 nor tier 2 yields a result, return 0 ("empty"). The
  // POS-rang amount stays visible in `posSold` on the daily-inventory
  // response for any UI that wants to show it separately.
  return { totalSales: 0, byBox: new Map(), byGame: new Map(), source: 'empty' };
}

/**
 * Aggregate ticket-math sales across an arbitrary date range. Walks day-
 * by-day calling {@link bestEffortDailySales}. Used by dashboard, reports,
 * commission report, weekly settlement so they all share one source of
 * truth instead of summing `LotteryTransaction` rows directly.
 *
 * **Timezone (B9 fix)**: when `timezone` is supplied, day boundaries are
 * computed in that IANA timezone. close_day_snapshot events written at
 * local 22:00 will fall correctly into the local-day's bucket instead of
 * leaking into the next UTC day. When `timezone` is omitted (or `'UTC'`),
 * behaves identically to the pre-B9 implementation — UTC day boundaries.
 */
export async function rangeSales(args: RangeSalesArgs & { timezone?: string }): Promise<RangeSalesResult> {
  const { orgId, storeId, from, to } = args;
  const tz = args.timezone || 'UTC';

  // Compute the inclusive local-date span [fromLocal..toLocal] in `tz`.
  const fromLocal = formatLocalDate(from, tz);
  const toLocal = formatLocalDate(to, tz);
  const todayLocal = formatLocalDate(new Date(), tz);

  const allBoxes = (await prisma.lotteryBox.findMany({
    where: { orgId, storeId },
    select: { id: true, gameId: true },
  })) as Array<{ id: string; gameId: string }>;
  const boxToGame = new Map<string, string>(allBoxes.map((b) => [b.id, b.gameId]));

  const byDay: RangeSalesResult['byDay'] = [];
  const byGame = new Map<string, GameSale>();
  let totalSales = 0;
  const sourcesUsed = new Set<SalesSource>();

  let safety = 0;
  let cursorLocal = fromLocal;
  while (cursorLocal <= toLocal && safety++ < 400) {
    const dayStart = localDayStartUTC(cursorLocal, tz);
    const dayEnd = localDayEndUTC(cursorLocal, tz);
    const isToday = cursorLocal === todayLocal;

    const day = await bestEffortDailySales({ orgId, storeId, dayStart, dayEnd, isToday });
    sourcesUsed.add(day.source);

    byDay.push({
      date: cursorLocal,
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
    cursorLocal = addOneDay(cursorLocal);
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
 * Per-shift ticket-math sales (B4 — Session 62).
 *
 * Looks up bracketing snapshot events around the shift window:
 *   • starting position: latest `close_day_snapshot` OR `shift_boundary`
 *     event AT or BEFORE shift.openedAt
 *   • ending position: latest `close_day_snapshot` OR `shift_boundary`
 *     event AT or BEFORE shift.closedAt (or now, for open shifts)
 *
 * Sales = Σ |startTicket − endTicket| × ticketPrice for each active box.
 *
 * Falls back to `lastShiftEndTicket` then `startTicket` when the box has
 * no prior snapshot — matches `snapshotSales`' priorPosition() chain.
 *
 * For overlapping shifts (e.g. handover with both cashiers on for 30 min),
 * tickets sold during the overlap appear in BOTH shifts' deltas — minor
 * double-count that's accepted as a known limitation. The cleaner fix
 * (per-cashier ticket attribution during overlap) requires per-tx station
 * data which the system doesn't have for lottery (single physical book on
 * the counter).
 */
export async function shiftSales(args: {
  orgId: string;
  storeId: string;
  /** Shift's opened-at instant (UTC). */
  openedAt: Date;
  /** Shift's closed-at instant; defaults to now when null (in-progress shift). */
  closedAt?: Date | null;
}): Promise<{ totalSales: number; source: SalesSource }> {
  const { orgId, storeId } = args;
  const openedAt = new Date(args.openedAt);
  const closedAt = args.closedAt ? new Date(args.closedAt) : new Date();

  const boxes = (await prisma.lotteryBox.findMany({
    where: { orgId, storeId, status: { in: ['active', 'depleted', 'returned'] } },
    select: {
      id: true,
      ticketPrice: true,
      startTicket: true,
      totalTickets: true,
      lastShiftEndTicket: true,
      activatedAt: true,
    },
  })) as BoxSnapshotRow[];
  if (!boxes.length) return { totalSales: 0, source: 'empty' };

  const settings = await prisma.lotterySettings
    .findUnique({ where: { storeId }, select: { sellDirection: true } })
    .catch(() => null);
  const sellDirection = settings?.sellDirection || 'desc';

  const validActions = ['close_day_snapshot', 'shift_boundary'];
  let totalSales = 0;
  let foundAny = false;

  for (const box of boxes) {
    // Ending position: latest snapshot AT or BEFORE shift close.
    const endEvent = await prisma.lotteryScanEvent.findFirst({
      where: {
        orgId, storeId, boxId: box.id,
        action: { in: validActions },
        createdAt: { lte: closedAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { parsed: true, createdAt: true },
    });
    // No snapshot AT/BEFORE close → can't compute. Skip this box.
    if (!endEvent) continue;
    // The end snapshot must fall AT or AFTER the shift opened, otherwise
    // it's a stale snapshot from before this shift even started — no sales
    // should be attributed.
    if (endEvent.createdAt < openedAt) continue;

    const endParsed = endEvent.parsed as ScanEventParsed | null;
    const endTicketStr = (endParsed?.currentTicket as string | null | undefined) ?? null;
    if (endTicketStr == null || endTicketStr === '') continue;
    const endTicket = parseInt(endTicketStr, 10);
    if (!Number.isFinite(endTicket)) continue;

    // Starting position: latest snapshot AT or BEFORE shift open. We use
    // `lte` (not `lt`) so the openShift handler's auto-written shift_boundary
    // event AT exactly shift.openedAt counts as this shift's starting
    // position. For multi-cashier handover, this is critical: Bob's open at
    // 2:30 PM has a fresh shift_boundary capturing the box state AFTER
    // Alice's morning sales (124), not stale from the previous day's close.
    // Without `lte`, Bob's start would fall through to the prior-day snapshot
    // (128) and incorrectly include Alice's morning sales in Bob's total.
    const startEvent = await prisma.lotteryScanEvent.findFirst({
      where: {
        orgId, storeId, boxId: box.id,
        action: { in: validActions },
        createdAt: { lte: openedAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { parsed: true },
    });
    let startTicketStr: string | null = null;
    if (startEvent) {
      const sp = startEvent.parsed as ScanEventParsed | null;
      startTicketStr = (sp?.currentTicket as string | null | undefined) ?? null;
    }
    if (!startTicketStr) {
      // Same priority chain as snapshotSales.priorPosition()
      // May 2026 — first-day-of-activation override: when the book was
      // activated AFTER the shift opened, the starting position for THIS
      // shift is the activation position (startTicket), not the stale
      // lastShiftEndTicket. Without this, a book activated and sold from
      // mid-shift contributes 0 to the shift's sales.
      const activatedDuringShift =
        box.activatedAt != null && box.activatedAt > openedAt;
      if (activatedDuringShift && box.startTicket != null && box.startTicket !== '') {
        startTicketStr = box.startTicket;
      } else if (box.lastShiftEndTicket != null && box.lastShiftEndTicket !== '') {
        startTicketStr = box.lastShiftEndTicket;
      } else if (box.startTicket != null) {
        startTicketStr = box.startTicket;
      } else {
        const total = Number(box.totalTickets || 0);
        if (!total) continue;
        startTicketStr = sellDirection === 'asc' ? '0' : String(total - 1);
      }
    }
    const startTicket = parseInt(startTicketStr, 10);
    if (!Number.isFinite(startTicket)) continue;

    const sold = Math.abs(startTicket - endTicket);
    if (sold === 0) continue;
    foundAny = true;
    const price = Number(box.ticketPrice || 0);
    totalSales += sold * price;
  }

  return {
    totalSales: Math.round(totalSales * 100) / 100,
    source: foundAny ? 'snapshot' : 'empty',
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
