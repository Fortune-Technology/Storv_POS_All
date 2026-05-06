/**
 * Lottery — Daily online totals + Daily inventory + Counter snapshot + Historical close.
 * Split from `lotteryController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (6):
 *   - getLotteryOnlineTotal     GET  /lottery/online-total?date=YYYY-MM-DD
 *                                (machine sales/cashings + instant cashings —
 *                                 the one-row-per-day terminal-side total
 *                                 that complements ticket-math sales)
 *   - upsertLotteryOnlineTotal  PUT  /lottery/online-total
 *   - getDailyLotteryInventory  GET  /lottery/daily-inventory?date=YYYY-MM-DD
 *                                (per-box ticket positions for one day —
 *                                 powers the EoD wizard's pre-fill)
 *   - getYesterdayCloses        GET  /lottery/yesterday-closes
 *                                (snapshot of yesterday's last position per
 *                                 active box — the EoD wizard's "Yesterday
 *                                 end" column)
 *   - getCounterSnapshot        GET  /lottery/counter-snapshot
 *                                (current state of every active book on the
 *                                 counter, in slot order)
 *   - upsertHistoricalClose     POST /lottery/historical-close
 *                                (admin override — write a close_day_snapshot
 *                                 retroactively for a prior day; used to seed
 *                                 stores that are catching up after manual
 *                                 record-keeping)
 *
 * `_bestEffortDailySales` falls back through the three sources in order:
 *   1. close_day_snapshot delta (truth)
 *   2. live ticket position (today only — current, not closing)
 *   3. POS-recorded transactions (audit fallback only)
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { errMsg } from '../../utils/typeHelpers.js';
import {
  bestEffortDailySales,
  rangeSales,
  localDayStartUTC,
  localDayEndUTC,
  formatLocalDate,
} from '../../services/lottery/reporting/index.js';
import {
  getOrgId,
  getStore,
  parseDate,
  num,
  type LotteryTxnRow,
  type LotteryGameRow,
  type LotteryOnlineTotalRow,
  type LotteryBoxLite,
  type LotteryBoxValueRow,
  type LotteryScanEventRow,
  type ScanEventParsed,
} from './helpers.js';

// Local aliases preserved from the original.
const _bestEffortDailySales = bestEffortDailySales;
const _realSalesRange = rangeSales;

// DAILY ONLINE TOTALS + DAILY SCAN / CLOSE THE DAY (Phase 1b)
// ══════════════════════════════════════════════════════════════════════════

// `parseDate` lives in ./helpers.ts — imported above.

/**
 * GET /api/lottery/online-total?date=YYYY-MM-DD
 * Returns the 3-number online total row for the given date (or nulls if none).
 */
export const getLotteryOnlineTotal = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const date = parseDate(req.query.date);
    if (!date) {
      res.status(400).json({ success: false, error: 'Invalid date' });
      return;
    }

    const row = await prisma.lotteryOnlineTotal
      .findUnique({
        where: { orgId_storeId_date: { orgId, storeId, date } },
      })
      .catch(() => null);

    res.json({
      success: true,
      data: row || null,
      date: req.query.date || date.toISOString().slice(0, 10),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * PUT /api/lottery/online-total
 * Body: { date: 'YYYY-MM-DD',
 *         instantCashing?, machineSales?, machineCashing?,
 *         grossSales?, cancels?, couponCash?, discounts?,
 *         notes? }
 * Upserts the per-day row. Only fields provided are overwritten.
 *
 * grossSales / cancels / couponCash / discounts were added Apr 2026 to fix
 * the wipe-on-refresh bug — these UI fields previously had no persistence.
 */
export const upsertLotteryOnlineTotal = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const userId = req.user?.id || null;
    const {
      date: dateStr,
      instantCashing,
      machineSales,
      machineCashing,
      grossSales,
      cancels,
      couponCash,
      discounts,
      notes,
    } = req.body || {};
    const date = parseDate(dateStr);
    if (!date) {
      res.status(400).json({ success: false, error: 'date is required (YYYY-MM-DD)' });
      return;
    }

    const updateData: Prisma.LotteryOnlineTotalUpdateInput = {
      ...(instantCashing != null && { instantCashing: Number(instantCashing) }),
      ...(machineSales != null && { machineSales: Number(machineSales) }),
      ...(machineCashing != null && { machineCashing: Number(machineCashing) }),
      ...(grossSales != null && { grossSales: Number(grossSales) }),
      ...(cancels != null && { cancels: Number(cancels) }),
      ...(couponCash != null && { couponCash: Number(couponCash) }),
      ...(discounts != null && { discounts: Number(discounts) }),
      ...(notes != null && { notes }),
      enteredById: userId,
    };
    const row = await prisma.lotteryOnlineTotal.upsert({
      where: { orgId_storeId_date: { orgId, storeId, date } },
      update: updateData,
      create: {
        orgId,
        storeId,
        date,
        instantCashing: instantCashing != null ? Number(instantCashing) : 0,
        machineSales: machineSales != null ? Number(machineSales) : 0,
        machineCashing: machineCashing != null ? Number(machineCashing) : 0,
        grossSales: grossSales != null ? Number(grossSales) : 0,
        cancels: cancels != null ? Number(cancels) : 0,
        couponCash: couponCash != null ? Number(couponCash) : 0,
        discounts: discounts != null ? Number(discounts) : 0,
        notes: notes || null,
        enteredById: userId,
      },
    });
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Ticket-math helpers — `_bestEffortDailySales` and `_realSalesRange` are
// declared once near the top of this module (aliasing the public exports
// from `services/lottery/reporting/index.js`). The original duplicate
// declaration was removed when this file was extracted from the parent
// controller.
// ─────────────────────────────────────────────────────────────────────────


/**
 * GET /api/lottery/daily-inventory?date=YYYY-MM-DD
 *
 * Computes the live Scratchoff Inventory panel:
 *   begin      — total value of active + safe boxes at start of day
 *   received   — total value of boxes received today (createdAt == date)
 *   activated  — total value of boxes activated today (activatedAt == date)
 *   sold       — tickets sold today × price  (summed from LotteryTransaction type='sale')
 *   returnPart — boxes with status=returned today AND ticketsSold > 0
 *   returnFull — boxes with status=returned today AND ticketsSold == 0
 *   end        — begin + received − sold − returns
 *   activeBooks, safeBooks, soldoutBooks — simple counts
 */
export const getDailyLotteryInventory = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    // Apr 2026 — store-local day boundaries. Without this, books received
    // at 9pm EST (= 01:00 UTC next day) showed up under TOMORROW's "Received"
    // total because the queries used UTC midnight. Same bug class as the
    // lottery sales math fix from Session 59 (B9). Default "today" is also
    // anchored to STORE-LOCAL — UTC `toISOString` advances 5-8 hours early
    // in negative-offset timezones.
    const { getStoreTimezone, formatLocalDate, localDayStartUTC, localDayEndUTC } =
      await import('../../utils/dateTz.js');
    const tz = await getStoreTimezone(storeId, prisma);
    const dateStr = (req.query?.date as string | undefined) || formatLocalDate(new Date(), tz);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      res.status(400).json({ success: false, error: 'Invalid date' });
      return;
    }
    const dayStart = localDayStartUTC(dateStr, tz);
    const dayEnd = localDayEndUTC(dateStr, tz);

    // Current state (as of now, not historical)
    const [activeCnt, safeCnt, soldoutCnt, activeBoxesRaw, safeBoxesRaw] = await Promise.all([
      prisma.lotteryBox.count({ where: { orgId, storeId, status: 'active' } }),
      prisma.lotteryBox.count({ where: { orgId, storeId, status: 'inventory' } }),
      prisma.lotteryBox.count({ where: { orgId, storeId, status: 'depleted' } }),
      prisma.lotteryBox.findMany({
        where: { orgId, storeId, status: 'active' },
        select: { totalValue: true, ticketsSold: true, ticketPrice: true },
      }),
      prisma.lotteryBox.findMany({
        where: { orgId, storeId, status: 'inventory' },
        select: { totalValue: true },
      }),
    ]);
    const activeBoxes = activeBoxesRaw as LotteryBoxValueRow[];
    const safeBoxes = safeBoxesRaw as LotteryBoxValueRow[];

    // Value on hand = total face value of active + safe boxes minus already-sold tickets
    const safeValue = safeBoxes.reduce((s, b) => s + Number(b.totalValue || 0), 0);
    const activeRemaining = activeBoxes.reduce((s, b) => {
      const total = Number(b.totalValue || 0);
      const sold = Number(b.ticketsSold || 0) * Number(b.ticketPrice || 0);
      return s + Math.max(0, total - sold);
    }, 0);
    const end = safeValue + activeRemaining;

    // Today's movements
    const [receivedTodayRaw, activatedTodayRaw, returnsTodayRaw, saleTxsRaw] = await Promise.all([
      prisma.lotteryBox.findMany({
        where: { orgId, storeId, createdAt: { gte: dayStart, lte: dayEnd } },
        select: { totalValue: true },
      }),
      prisma.lotteryBox.findMany({
        where: { orgId, storeId, activatedAt: { gte: dayStart, lte: dayEnd } },
        select: { id: true },
      }),
      prisma.lotteryBox.findMany({
        where: { orgId, storeId, returnedAt: { gte: dayStart, lte: dayEnd } },
        select: { ticketsSold: true, totalTickets: true, ticketPrice: true, totalValue: true },
      }),
      prisma.lotteryTransaction.findMany({
        where: {
          orgId,
          storeId,
          type: 'sale',
          createdAt: { gte: dayStart, lte: dayEnd },
        },
        select: { amount: true },
      }),
    ]);
    const receivedToday = receivedTodayRaw as LotteryBoxValueRow[];
    const activatedToday = activatedTodayRaw as Array<{ id: string }>;
    const returnsToday = returnsTodayRaw as LotteryBoxValueRow[];
    const saleTxs = saleTxsRaw as LotteryTxnRow[];

    const received = receivedToday.reduce((s, b) => s + Number(b.totalValue || 0), 0);
    const activated = activatedToday.length;
    // POS-recorded sales — what the cashier actually rang up (audit signal).
    const posSold =
      Math.round(saleTxs.reduce((s, t) => s + Number(t.amount || 0), 0) * 100) / 100;

    // Best-effort sales — tries snapshots first, then live ticket-math
    // (today only), then POS LotteryTransaction sum. The `salesSource`
    // field tells the UI which tier produced the value.
    // Compare requested date to TODAY in the store's tz (not UTC) so the
    // live tier fires on the right day for non-UTC stores.
    // (formatLocalDate already imported at top of this handler.)
    const todayLocal = formatLocalDate(new Date(), tz);
    const isToday = dateStr === todayLocal;
    const real = await _bestEffortDailySales({ orgId, storeId, dayStart, dayEnd, isToday });
    const sold = real.totalSales;
    const salesSource = real.source; // 'snapshot' | 'live' | 'pos_fallback' | 'empty'

    // Variance only makes sense when ticket-math truth is available.
    // When falling back to POS sums, sold===posSold by construction
    // → unreported is 0 by definition (and meaningless).
    const unreported =
      salesSource === 'snapshot' || salesSource === 'live'
        ? Math.max(0, Math.round((sold - posSold) * 100) / 100)
        : 0;

    const returnPart = returnsToday
      .filter((b) => Number(b.ticketsSold || 0) > 0)
      .reduce(
        (s, b) =>
          s +
          Math.max(
            0,
            (Number(b.totalTickets || 0) - Number(b.ticketsSold || 0)) *
              Number(b.ticketPrice || 0),
          ),
        0,
      );
    const returnFull = returnsToday
      .filter((b) => Number(b.ticketsSold || 0) === 0)
      .reduce((s, b) => s + Number(b.totalValue || 0), 0);

    // Begin = End + Sold + Returns − Received
    const begin = end + sold + returnPart + returnFull - received;

    // Per-box sales breakdown — enables back-office audit "which book sold
    // what today" without needing a separate query. Front-end uses this to
    // reconcile the aggregate total against per-row deltas (Apr 2026 — they
    // diverged because cashier-app and back-office historically used
    // different formulas; per-box exposure makes the divergence diagnosable).
    const boxBreakdown: Array<{
      boxId: string;
      gameNumber?: string | null;
      gameName?: string | null;
      boxNumber?: string | null;
      slotNumber?: number | null;
      sold: number;
      price: number;
      amount: number;
    }> = [];
    if (real.byBox && real.byBox.size > 0) {
      const boxIds = Array.from(real.byBox.keys());
      interface BreakdownBoxRow {
        id: string;
        boxNumber: string | null;
        slotNumber: number | null;
        game: { gameNumber: string | null; name: string } | null;
      }
      const boxRows = (await prisma.lotteryBox.findMany({
        where: { id: { in: boxIds } },
        select: { id: true, boxNumber: true, slotNumber: true, game: { select: { gameNumber: true, name: true } } },
      })) as BreakdownBoxRow[];
      const boxRowMap = Object.fromEntries(boxRows.map((b: BreakdownBoxRow) => [b.id, b]));
      for (const [boxId, sale] of real.byBox.entries()) {
        const box = boxRowMap[boxId];
        boxBreakdown.push({
          boxId,
          gameNumber: box?.game?.gameNumber ?? null,
          gameName:   box?.game?.name ?? null,
          boxNumber:  box?.boxNumber ?? null,
          slotNumber: box?.slotNumber ?? null,
          sold:   sale.sold,
          price:  Number(sale.price) || 0,
          amount: Math.round(Number(sale.amount) * 100) / 100,
        });
      }
      // Sort by amount desc — biggest contributors first (audit-friendly).
      boxBreakdown.sort((a, b) => b.amount - a.amount);
    }

    res.json({
      success: true,
      data: {
        begin: Math.round(begin * 100) / 100,
        received: Math.round(received * 100) / 100,
        activated,
        sold: Math.round(sold * 100) / 100, // best-effort sales
        posSold: Math.round(posSold * 100) / 100, // what cashier rang up
        unreported: Math.round(unreported * 100) / 100, // diff (audit signal)
        salesSource, // 'snapshot' | 'live' | 'pos_fallback' | 'empty'
        returnPart: Math.round(returnPart * 100) / 100,
        returnFull: Math.round(returnFull * 100) / 100,
        end: Math.round(end * 100) / 100,
        boxBreakdown, // per-book contribution to today's sales (audit aid)
        counts: {
          active: activeCnt,
          safe: safeCnt,
          soldout: soldoutCnt,
        },
      },
    });
  } catch (err) {
    console.error('[lottery.daily-inventory]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * `closeLotteryDay` — REMOVED May 2026.
 *
 * Was: POST /api/lottery/close-day. Snapshotted every active book's current
 * ticket position to a `close_day_snapshot` event + ran the pending-move
 * sweep. Removed because:
 *
 *   1. Per-book snapshots were redundant — the cashier-app EoD wizard
 *      (`saveLotteryShiftReport`) already writes one canonical snapshot per
 *      book per shift close. Calling close-day on top of that produced
 *      duplicate snapshots that the back-office had to dedupe (the
 *      "Apr 30 had 4× per book" pattern).
 *
 *   2. The pending-move sweep already runs autonomously every 15 min via
 *      `startPendingMoveScheduler` (see services/lottery/engine/pendingMover.ts,
 *      wired from server.ts). No manual trigger needed.
 *
 * If you find a code path still importing this, delete the import — the
 * /close-day route is gone too.
 */

/**
 * GET /api/lottery/yesterday-closes?date=YYYY-MM-DD
 *
 * For the given `date`, returns the LAST close_day_snapshot for each
 * LotteryBox that happened BEFORE the date's local midnight.
 */
export const getYesterdayCloses = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const dateStr = req.query?.date as string | undefined;
    if (!dateStr) {
      res.status(400).json({ success: false, error: 'date param required (YYYY-MM-DD)' });
      return;
    }
    const date = parseDate(dateStr);
    if (!date) {
      res.status(400).json({ success: false, error: 'Invalid date' });
      return;
    }

    // Apr 2026 — store-local-day boundary. "Snapshots before today" must
    // mean before today's LOCAL midnight, not UTC midnight, otherwise a
    // close_day_snapshot written at 22:00 EST = 02:00 UTC tomorrow would
    // mistakenly count as "yesterday's close" for tomorrow's view.
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { timezone: true },
    });
    const tz = store?.timezone || 'UTC';
    const { localDayStartUTC } = await import('../../utils/dateTz.js');
    const dayStart = localDayStartUTC(dateStr, tz);

    // All close_day_snapshot events prior to this date's start. Newest first
    // so the first one we encounter per box is its most recent close.
    const events = await prisma.lotteryScanEvent.findMany({
      where: {
        orgId,
        storeId,
        action: 'close_day_snapshot',
        createdAt: { lt: dayStart },
      },
      orderBy: { createdAt: 'desc' },
      select: { boxId: true, parsed: true, createdAt: true },
    });

    interface YesterdayClose {
      ticket: string | number | null;
      ticketsSold: number | null;
      closedAt: Date;
    }

    const closes: Record<string, YesterdayClose> = {};
    for (const ev of events) {
      if (!ev.boxId || closes[ev.boxId]) continue; // already have newer close for this box
      const parsed =
        ev.parsed && typeof ev.parsed === 'object' ? (ev.parsed as ScanEventParsed) : {};
      const ticket = (parsed.currentTicket as string | number | null | undefined) ?? null;
      closes[ev.boxId] = {
        ticket,
        ticketsSold: (parsed.ticketsSold as number | null | undefined) ?? null,
        closedAt: ev.createdAt,
      };
    }
    res.json({ success: true, closes });
  } catch (err) {
    console.error('[lottery.yesterdayCloses]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * GET /api/lottery/counter-snapshot?date=YYYY-MM-DD
 *
 * Returns the set of books that were on the counter on the GIVEN date,
 * each decorated with its opening (previous-day's close) and closing
 * (that-day's close) ticket numbers.
 */
export const getCounterSnapshot = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const dateStr = req.query?.date as string | undefined;
    if (!dateStr) {
      res.status(400).json({ success: false, error: 'date param required (YYYY-MM-DD)' });
      return;
    }
    const date = parseDate(dateStr);
    if (!date) {
      res.status(400).json({ success: false, error: 'Invalid date' });
      return;
    }

    // Apr 2026 — store-local-day boundaries (parity with getDailyLotteryInventory).
    // Without this, books activated/depleted/returned at evening hours in
    // non-UTC stores would appear on the WRONG calendar day.
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { timezone: true },
    });
    const tz = store?.timezone || 'UTC';
    const { localDayStartUTC, localDayEndUTC, formatLocalDate } = await import('../../utils/dateTz.js');
    const dayStart = localDayStartUTC(dateStr, tz);
    const dayEnd = localDayEndUTC(dateStr, tz);
    const todayLocal = formatLocalDate(new Date(), tz);
    const isToday = dateStr === todayLocal;

    // Books that were on the counter during day D
    type CounterBox = {
      id: string;
      currentTicket: string | null;
      startTicket: string | null;
      [k: string]: unknown;
    };
    const boxes = (await prisma.lotteryBox.findMany({
      where: {
        orgId,
        storeId,
        activatedAt: { lte: dayEnd, not: null },
        OR: [
          { status: 'active' },
          { depletedAt: { gt: dayStart } },
          { returnedAt: { gt: dayStart } },
        ],
      },
      include: { game: true },
      // Postgres default ASC puts NULLs LAST. The user wants unassigned
      // (slotNumber = null) at the TOP — those are books just activated
      // but not yet placed on the machine. So we sort by:
      //   1. has-slot ASC (false = null first)        — unassigned on top
      //   2. slotNumber ASC                            — then by slot
      //   3. activatedAt DESC                          — newest within tie
      orderBy: [{ slotNumber: { sort: 'asc', nulls: 'first' } }, { activatedAt: 'desc' }],
    })) as CounterBox[];

    // Snapshots from close_day_snapshot events:
    //   prev: latest per-box event BEFORE D     → yesterdayClose
    //   curr: latest per-box event WITHIN D     → todayClose
    const [prevEvents, currEvents] = await Promise.all([
      prisma.lotteryScanEvent.findMany({
        where: { orgId, storeId, action: 'close_day_snapshot', createdAt: { lt: dayStart } },
        orderBy: { createdAt: 'desc' },
        select: { boxId: true, parsed: true },
      }),
      prisma.lotteryScanEvent.findMany({
        where: {
          orgId,
          storeId,
          action: 'close_day_snapshot',
          createdAt: { gte: dayStart, lte: dayEnd },
        },
        orderBy: { createdAt: 'desc' },
        select: { boxId: true, parsed: true },
      }),
    ]);

    const prevMap: Record<string, string | number | null> = {};
    for (const ev of prevEvents) {
      if (ev.boxId && !(ev.boxId in prevMap)) {
        const parsed = ev.parsed as ScanEventParsed | null;
        prevMap[ev.boxId] = (parsed?.currentTicket as string | number | null | undefined) ?? null;
      }
    }
    const currMap: Record<string, string | number | null> = {};
    for (const ev of currEvents) {
      if (ev.boxId && !(ev.boxId in currMap)) {
        const parsed = ev.parsed as ScanEventParsed | null;
        currMap[ev.boxId] = (parsed?.currentTicket as string | number | null | undefined) ?? null;
      }
    }

    const enriched = boxes.map((b) => {
      const yesterdayClose = prevMap[b.id] ?? null;
      const todayClose = currMap[b.id] ?? null;
      // For today, currentTicket is live (box.currentTicket). For past
      // dates, it's the closing snapshot for that day (null if the day
      // was never closed).
      const currentTicket = isToday ? (b.currentTicket ?? null) : todayClose;
      // "Yesterday" / opening — must use the SAME fallback chain as the
      // backend snapshotSales priorPosition() so the per-row sold amount the
      // frontend computes (yesterday − today) × price equals the per-box
      // contribution that snapshotSales/inventory.sold reports. Without
      // `lastShiftEndTicket` in the chain, a book with prior shift activity
      // but no close_day_snapshot would render the WRONG yesterday → wrong
      // per-row amount → row sums diverge from the headline daily total.
      // Chain: yesterdayClose → lastShiftEndTicket → startTicket → null.
      const lastShiftEndTicket =
        (b as { lastShiftEndTicket?: string | null }).lastShiftEndTicket ?? null;
      const openingTicket =
        yesterdayClose ??
        lastShiftEndTicket ??
        b.startTicket ??
        null;
      return {
        ...b,
        yesterdayClose,
        todayClose,
        currentTicket,
        openingTicket,
      };
    });

    res.json({ success: true, date: req.query.date, isToday, boxes: enriched });
  } catch (err) {
    console.error('[lottery.counterSnapshot]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * PUT /api/lottery/historical-close
 * Body: { boxId, date: 'YYYY-MM-DD', ticket }
 *
 * Lets a manager correct a HISTORICAL day's close ticket for a single
 * book — used by the Daily page in manual mode when navigating to a past
 * date and editing the "today" cell. Creates or updates the
 * close_day_snapshot LotteryScanEvent for that box on that date.
 *
 * If `ticket` is null/empty/undefined, deletes any existing snapshot
 * for that day instead (effectively un-recording the close).
 */
export const upsertHistoricalClose = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const userId = req.user?.id || null;
    const { boxId, date: dateStr, ticket } = req.body || {};
    if (!boxId || !dateStr) {
      res.status(400).json({ success: false, error: 'boxId and date are required' });
      return;
    }
    const date = parseDate(dateStr);
    if (!date) {
      res.status(400).json({ success: false, error: 'Invalid date' });
      return;
    }

    // Verify the box belongs to this org/store
    const box = await prisma.lotteryBox.findFirst({
      where: { id: boxId, orgId, storeId },
      include: { game: true },
    });
    if (!box) {
      res.status(404).json({ success: false, error: 'Box not found' });
      return;
    }

    // Use store-local-day boundaries so a save for "April 30" lands in the
    // SAME bucket the back-office reads from (getCounterSnapshot uses
    // localDayStartUTC/localDayEndUTC). Previously hard-coded UTC boundaries
    // which mismatched the read window for non-UTC stores → save appeared
    // to succeed but the page didn't reflect the new value.
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { timezone: true },
    });
    const tz = store?.timezone || 'UTC';
    const { localDayStartUTC, localDayEndUTC } = await import('../../utils/dateTz.js');
    const dayStart = localDayStartUTC(dateStr, tz);
    const dayEnd = localDayEndUTC(dateStr, tz);

    // Find any existing close_day_snapshot for this box on this date
    const existing = await prisma.lotteryScanEvent.findFirst({
      where: {
        orgId,
        storeId,
        boxId,
        action: 'close_day_snapshot',
        createdAt: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { createdAt: 'desc' },
    });

    const t = ticket == null || ticket === '' ? null : String(ticket);

    // May 2026 — bounds-check past-date close ticket. Per user direction,
    // only -1 is valid as a negative for desc books. Anything more negative
    // corrupts past-day snapshotSales math the same way live edits would.
    if (t != null) {
      const ticketNum = parseInt(t, 10);
      const totalT = Number(box.totalTickets || 0);
      const sellSettings = await prisma.lotterySettings
        .findUnique({ where: { storeId }, select: { sellDirection: true } })
        .catch(() => null);
      const sellDir = sellSettings?.sellDirection || 'desc';
      const minPos = sellDir === 'asc' ? 0 : -1;
      const maxPos = sellDir === 'asc' ? totalT : Math.max(0, totalT - 1);
      if (!Number.isFinite(ticketNum) || ticketNum < minPos || ticketNum > maxPos) {
        res.status(400).json({
          success: false,
          error: `Ticket ${t} out of range ${minPos}..${maxPos} for sellDirection=${sellDir}, pack=${totalT}.`,
        });
        return;
      }
    }

    // Empty ticket → delete the snapshot
    if (t == null) {
      if (existing) {
        await prisma.lotteryScanEvent.delete({ where: { id: existing.id } });
      }
      res.json({ success: true, deleted: !!existing });
      return;
    }

    // Otherwise upsert. Prisma doesn't have a natural composite key here,
    // so do it as findFirst + update/create.
    const parsed = {
      gameNumber: box.game?.gameNumber ?? null,
      gameName: box.game?.name ?? null,
      slotNumber: box.slotNumber ?? null,
      currentTicket: t,
      ticketsSold: null,
      manualEdit: true,
    };

    if (existing) {
      await prisma.lotteryScanEvent.update({
        where: { id: existing.id },
        data: {
          parsed: parsed as unknown as Prisma.InputJsonValue,
          scannedBy: userId,
          raw: `historical_close:${dateStr}`,
        },
      });
    } else {
      // Pin createdAt to the END of the day so it's recognised as the day's
      // close (queries use createdAt-window matching).
      await prisma.lotteryScanEvent.create({
        data: {
          orgId,
          storeId,
          boxId,
          scannedBy: userId,
          raw: `historical_close:${dateStr}`,
          parsed: parsed as unknown as Prisma.InputJsonValue,
          action: 'close_day_snapshot',
          context: 'eod',
          createdAt: dayEnd,
        },
      });
    }

    res.json({ success: true, ticket: t });
  } catch (err) {
    console.error('[lottery.historicalClose]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ══════════════════════════════════════════════════════════════════════════
