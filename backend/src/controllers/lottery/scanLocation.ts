/**
 * Lottery — Scan handlers + Box location moves (counter ↔ safe ↔ depleted).
 * Split from `lotteryController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (8):
 *   Scanning (2):
 *     - parseLotteryScan   POST /lottery/scan/parse
 *                           (parse-only — useful for client-side preview;
 *                            doesn't mutate state)
 *     - scanLotteryBarcode POST /lottery/scan/process
 *                           (parse + dispatch via state adapter; may auto-
 *                            activate, update_current, reject, etc.)
 *
 *   Location moves (4):
 *     - moveBoxToSafe       POST /lottery/boxes/:id/move-to-safe
 *     - markBoxSoldout      POST /lottery/boxes/:id/soldout
 *     - restoreBoxToCounter POST /lottery/boxes/:id/restore-to-counter
 *     - returnBoxToLotto    POST /lottery/boxes/:id/return-to-lotto
 *                           (final — write `box_returned` event so the next
 *                            day's reconciliation knows the book is gone)
 *
 *   Pending-move queue (2):
 *     - cancelPendingMove   POST /lottery/pending-moves/:id/cancel
 *     - runPendingMovesNow  POST /lottery/pending-moves/run
 *                           (manual trigger of the sweep that auto-applies
 *                            EoD-scheduled moves; also runs on its own
 *                            scheduler tick)
 *
 * Scan engine: every scan goes through `_processScan` from the lottery
 * service which dispatches to the per-state adapter (MA, RJR, etc.) and
 * decides what to do (activate / update_current / reject / receive). The
 * adapter is responsible for parsing the state-specific barcode format.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { errMsg } from '../../utils/typeHelpers.js';
import {
  parseScan as _parseScan,
  processScan as _processScan,
  runPendingMoveSweep as _runPendingMoveSweep,
} from '../../services/lottery/index.js';
import {
  getOrgId,
  getStore,
  parseDate,
  type ScanEventParsed,
} from './helpers.js';

// SCAN / LOCATION HANDLERS (Phase 1a)
// ══════════════════════════════════════════════════════════════════════════

interface LogScanEventInput {
  orgId: string;
  storeId: string;
  boxId?: string | null;
  userId?: string | null;
  raw: string;
  parsed: ScanEventParsed | null;
  action: string;
  context: string;
  notes?: string | null;
}

/**
 * Log a scan event. Never throws — audit logging must not break the user flow.
 */
async function logScanEvent({
  orgId,
  storeId,
  boxId,
  userId,
  raw,
  parsed,
  action,
  context,
  notes,
}: LogScanEventInput): Promise<void> {
  try {
    await prisma.lotteryScanEvent.create({
      data: {
        orgId,
        storeId,
        boxId: boxId ?? null,
        scannedBy: userId ?? null,
        raw: String(raw ?? ''),
        parsed: (parsed ?? undefined) as Prisma.InputJsonValue | undefined,
        action,
        context,
        notes: notes ?? null,
      },
    });
  } catch (err) {
    console.warn('[lottery] failed to write scan event:', errMsg(err));
  }
}

/**
 * POST /api/lottery/scan/parse
 * Body: { raw: string }
 *
 * Pure parse — runs the barcode through the state adapters and returns the
 * decoded { gameNumber, bookNumber, ticketNumber?, state }. Does NOT touch
 * the DB or try to resolve against an existing LotteryBox. Used by the
 * Receive Books scan flow where we want to collect parsed metadata for
 * books that intentionally do NOT exist in inventory yet.
 */
export const parseLotteryScan = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStore(req);
    const { raw } = req.body || {};
    if (!raw || typeof raw !== 'string') {
      res.status(400).json({ success: false, error: 'raw barcode string is required' });
      return;
    }
    const settings = storeId
      ? await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null)
      : null;
    const parsed = _parseScan(raw, settings?.state || null);
    if (!parsed) {
      res.status(400).json({
        success: false,
        error: 'Barcode format not recognised for any supported state',
      });
      return;
    }
    res.json({ success: true, state: parsed.adapter.code, parsed: parsed.parsed });
  } catch (err) {
    console.error('[lottery.parseScan]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const scanLotteryBarcode = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const userId = req.user?.id || null;
    const { raw, context = 'admin' } = req.body || {};

    if (!raw || typeof raw !== 'string') {
      res.status(400).json({ success: false, error: 'raw barcode string is required' });
      return;
    }

    const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
    const stateCode = settings?.state || null;

    const parsed = _parseScan(raw, stateCode);
    if (!parsed) {
      await logScanEvent({
        orgId,
        storeId,
        userId,
        raw,
        parsed: null,
        action: 'rejected',
        context,
        notes: 'unknown_format',
      });
      res.status(400).json({
        success: false,
        error: 'Barcode format not recognised for any supported state',
      });
      return;
    }

    const result = await _processScan({
      orgId,
      storeId,
      parsed: parsed.parsed,
      allowMultipleActivePerGame: !!settings?.allowMultipleActivePerGame,
      userId,
    });

    await logScanEvent({
      orgId,
      storeId,
      userId,
      raw,
      parsed: { adapter: parsed.adapter.code, ...parsed.parsed },
      action: result.action,
      context,
      notes: ('reason' in result && result.reason) || null,
      boxId: ('box' in result && result.box?.id) || null,
    });

    if (result.action === 'activate' && result.autoSoldout) {
      await logScanEvent({
        orgId,
        storeId,
        userId,
        raw,
        parsed: { adapter: parsed.adapter.code, ...parsed.parsed },
        action: 'auto_soldout',
        context,
        notes: `soldout by new scan of ${result.box?.boxNumber}`,
        boxId: result.autoSoldout.id,
      });
    }

    // Surface sequence-gap warnings so the UI can nag the user
    if (result.action === 'activate' && Array.isArray(result.warnings) && result.warnings.length > 0) {
      for (const w of result.warnings) {
        await logScanEvent({
          orgId,
          storeId,
          userId,
          raw,
          parsed: { adapter: parsed.adapter.code, ...parsed.parsed, warning: w.code },
          action: 'warning',
          context,
          notes: w.message,
          boxId: result.box?.id || null,
        });
      }
    }

    res.json({
      success: true,
      action: result.action,
      reason: 'reason' in result ? result.reason || null : null,
      message: 'message' in result ? result.message || null : null,
      box: 'box' in result ? result.box || null : null,
      autoSoldout: result.action === 'activate' ? result.autoSoldout || null : null,
      warnings: result.action === 'activate' ? result.warnings || [] : [],
      state: parsed.adapter.code,
      parsed: parsed.parsed,
    });
  } catch (err) {
    console.error('[lottery.scan]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * POST /api/lottery/boxes/:id/move-to-safe
 * Body: { date?: ISO date string }
 *
 * - If date is today or omitted → execute immediately.
 * - If date is in the future    → schedule via pendingLocation fields.
 */
export const moveBoxToSafe = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const boxId = req.params.id;
    const { date } = req.body || {};

    const box = await prisma.lotteryBox.findFirst({ where: { id: boxId, orgId, storeId } });
    if (!box) {
      res.status(404).json({ success: false, error: 'Box not found' });
      return;
    }
    if (box.status !== 'active') {
      res.status(400).json({
        success: false,
        error: `Only active (counter) books can move to safe. Current: ${box.status}`,
      });
      return;
    }

    const target = date ? new Date(date) : new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const asOfMidnight = new Date(target);
    asOfMidnight.setHours(0, 0, 0, 0);
    const isScheduled = asOfMidnight > today;

    const updated = await prisma.lotteryBox.update({
      where: { id: boxId },
      data: isScheduled
        ? {
            pendingLocation: 'inventory',
            pendingLocationEffectiveDate: asOfMidnight,
            pendingLocationRequestedAt: new Date(),
            updatedAt: new Date(),
          }
        : {
            status: 'inventory',
            slotNumber: null,
            pendingLocation: null,
            pendingLocationEffectiveDate: null,
            pendingLocationRequestedAt: null,
            updatedAt: new Date(),
          },
      include: { game: true },
    });
    res.json({ success: true, data: updated, scheduled: isScheduled });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * POST /api/lottery/boxes/:id/soldout
 * Body: { reason?: 'manual'|'eod_so_button' }
 */
/**
 * POST /api/lottery/boxes/:id/soldout
 * Body: { reason?: string, date?: 'YYYY-MM-DD' }
 *
 * Marks a book as sold out — i.e. ALL remaining tickets sold. The math
 * implications (Session 46 fix) the cashier expects:
 *
 *   1. The book's currentTicket moves to the "fully sold" position:
 *        descending: -1   (one past ticket #0; "even ticket 0 is gone")
 *        ascending:  totalTickets
 *      so that subsequent ticket-math runs (snapshotSales) compute
 *      `|prev − new| × price` = full pack value as that day's sale.
 *
 *   2. ticketsSold = totalTickets, salesAmount = totalValue (LotteryBox
 *      aggregates kept in sync with reality).
 *
 *   3. A close_day_snapshot event is INSERTED for the SELECTED date with
 *      the new currentTicket. snapshotSales' "latest event of the day
 *      wins" rule means this overrides any earlier same-day snapshot
 *      (e.g. one written at 10pm by the EoD wizard before the cashier
 *      realised the book was empty at 11pm).
 *
 *   4. depletedAt = end-of-selected-date (23:59:59 UTC). Same-day
 *      filter math (depletedAt > start of D) treats this book as
 *      "depleted on day D" for that day's daily-inventory return-tracking.
 *
 * `date` is optional. Defaults to today when omitted (legacy callers).
 * The frontend Counter UI passes the selected calendar date so admins
 * can correctly mark a book that ran out yesterday or earlier.
 */
export const markBoxSoldout = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const boxId = req.params.id;
    const { reason = 'manual', date: dateStr } = (req.body || {}) as {
      reason?: string;
      date?: string;
    };

    const box = await prisma.lotteryBox.findFirst({ where: { id: boxId, orgId, storeId } });
    if (!box) {
      res.status(404).json({ success: false, error: 'Box not found' });
      return;
    }
    if (!['active', 'inventory'].includes(box.status)) {
      res
        .status(400)
        .json({ success: false, error: `Cannot soldout from status ${box.status}` });
      return;
    }

    // Resolve the soldout date — use store-local end-of-day so the
    // close_day_snapshot event lands inside the store's local-day window
    // regardless of timezone. Previously hard-coded `setUTCHours(23,59,59,0)`
    // which worked for negative-offset zones (US) by accident but broke for
    // positive-offset zones (e.g. NZ, Berlin) where UTC-end-of-day fell into
    // the WRONG local day's bucket.
    //
    // May 2026 (Fix A) — the soldout's `depletedAt` doubles as the cutoff
    // for `restoreBoxToCounter`'s correction snapshot (written at cutoff+1ms
    // so "latest event of the day wins" in snapshotSales). When dateStr is
    // supplied, soldoutAt = `localDayEndUTC` = `nextStart - 1ms` (the very
    // last instant of the day). cutoff+1ms then lands at `nextStart`,
    // pushing the restore correction into TOMORROW's window — Tuesday's
    // snapshotSales picks up the correction as "today's value", computing
    // a phantom |restored - prior_soldout_pos| × price as fake sales.
    // Fix: subtract 1ms from soldoutAt so cutoff+1ms still falls in today's
    // window. That keeps the restore correction in the SAME day as the
    // soldout, where it belongs (and where it correctly overrides the
    // soldout via "latest of the day wins").
    const store = await prisma.store.findUnique({
      where: { id: storeId as string },
      select: { timezone: true },
    });
    const tz = store?.timezone || 'UTC';
    const { localDayEndUTC } = await import('../../utils/dateTz.js');
    let soldoutAt: Date;
    if (dateStr) {
      const validated = parseDate(dateStr);
      if (!validated) {
        res.status(400).json({ success: false, error: 'Invalid date (expected YYYY-MM-DD)' });
        return;
      }
      // Past-date or current-date soldout → end of that day in the store's tz,
      // minus 1ms so a future restore-correction (cutoff+1ms) still fits in
      // today's window.
      soldoutAt = new Date(localDayEndUTC(dateStr, tz).getTime() - 1);
    } else {
      // No date passed → "now" (live soldout while cashier is at the register).
      soldoutAt = new Date();
    }

    // sellDirection drives the "fully sold" position. -1 for desc, total
    // for asc. (Per Session 46 user direction: a 150-pack `desc` book
    // starts at 149 and ends at -1 once even ticket #0 is gone, so
    // |start − end| = 150 captures the full pack as sold.)
    const settings = await prisma.lotterySettings
      .findUnique({ where: { storeId }, select: { sellDirection: true } })
      .catch(() => null);
    const sellDir = settings?.sellDirection || 'desc';
    const total = Number(box.totalTickets || 0);
    const fullySoldPos = sellDir === 'asc' ? String(total) : '-1';
    const ticketPriceNum = Number(box.ticketPrice || 0);
    const totalValueNum = total * ticketPriceNum;

    const updated = await prisma.lotteryBox.update({
      where: { id: boxId },
      data: {
        status: 'depleted',
        depletedAt: soldoutAt,
        autoSoldoutReason: reason,
        currentTicket: fullySoldPos,
        ticketsSold: total,
        salesAmount: totalValueNum,
        updatedAt: new Date(),
      },
      include: { game: true },
    });

    // Write a close_day_snapshot for the soldout day so ticket-math sales
    // reports include the remaining-tickets-as-sold-today amount.
    // Idempotent on accidental double-call: snapshotSales picks the
    // latest event of the day, so a duplicate is harmless.
    await prisma.lotteryScanEvent
      .create({
        data: {
          orgId: orgId as string,
          storeId: storeId as string,
          boxId,
          scannedBy: req.user?.id || null,
          raw: `soldout:${boxId}:${dateStr || soldoutAt.toISOString().slice(0, 10)}`,
          parsed: {
            gameNumber: updated.game?.gameNumber ?? null,
            gameName: updated.game?.name ?? null,
            currentTicket: fullySoldPos,
            ticketsSold: total,
            soldout: true,
            source: 'manual-soldout',
          } as Prisma.InputJsonValue,
          action: 'close_day_snapshot',
          context: 'eod',
          createdAt: soldoutAt,
        },
      })
      .catch((e: Error) => console.warn('[markBoxSoldout] snapshot insert failed', boxId, e.message));

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * POST /api/lottery/boxes/:id/restore-to-counter
 * Body: { reason?: string }
 *
 * Undo a soldout that was hit in error.
 *
 * Restores the book to status='active' and walks back to the position it
 * was in BEFORE the soldout. The "before" position is read from the most-
 * recent close_day_snapshot for this box prior to the soldout snapshot.
 * If no prior snapshot exists, falls back to box.startTicket, then to
 * the sellDirection-based fresh-pack opening.
 *
 * Also writes a NEW close_day_snapshot (1 ms later than the original
 * soldout one) for the soldout's day with the restored position, so
 * snapshotSales' "latest event of the day wins" rule overrides the
 * inflated soldout snapshot — that day's ticket-math sale goes back to
 * the correct value (typically 0 for "soldout was wrong, no sales today")
 * instead of "all remaining tickets were sold".
 *
 * Audit trail intentionally NOT deleted — both the soldout and the
 * restoration events stay in lottery_scan_events for forensics.
 */
export const restoreBoxToCounter = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const boxId = req.params.id;
    const { reason = 'manual_restore' } = (req.body || {}) as { reason?: string };

    const box = await prisma.lotteryBox.findFirst({ where: { id: boxId, orgId, storeId } });
    if (!box) {
      res.status(404).json({ success: false, error: 'Box not found' });
      return;
    }
    // Apr 2026 — accept BOTH 'depleted' (sold out) AND 'returned' (sent back
    // to lottery) statuses. Same restore mechanism applies: find the prior
    // snapshot, restore currentTicket, write a correction snapshot at
    // {depletedAt|returnedAt} + 1ms so snapshotSales picks the corrected
    // value over the original SO/return event.
    if (!['depleted', 'returned'].includes(box.status)) {
      res
        .status(400)
        .json({ success: false, error: `Cannot restore to counter from status ${box.status} — only depleted (soldout) or returned books can be restored` });
      return;
    }

    // The cutoff for "prior snapshot" is whichever timestamp marks the
    // book's exit from active state — depletedAt for soldouts, returnedAt
    // for returned books. The original SO/return event's snapshot was
    // written at this same timestamp.
    const cutoff = box.depletedAt || box.returnedAt || new Date();
    const priorSnap = await prisma.lotteryScanEvent.findFirst({
      where: {
        orgId, storeId,
        action: 'close_day_snapshot',
        boxId,
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'desc' },
      select: { parsed: true, createdAt: true },
    });

    // Resolve the restored currentTicket:
    //   1. priorSnap.parsed.currentTicket  (most accurate — pre-soldout position)
    //   2. box.startTicket                 (book opened at this position)
    //   3. fresh-pack opening              (149 desc / 0 asc)
    let restoredTicket: string | null = null;
    if (priorSnap) {
      const parsed = priorSnap.parsed as Record<string, unknown> | null;
      const cur = parsed?.currentTicket;
      if (cur != null) restoredTicket = String(cur);
    }
    if (restoredTicket == null) restoredTicket = box.startTicket;
    if (restoredTicket == null) {
      const settings = await prisma.lotterySettings
        .findUnique({ where: { storeId }, select: { sellDirection: true } })
        .catch(() => null);
      const sellDir = settings?.sellDirection || 'desc';
      const total = Number(box.totalTickets || 0);
      if (total > 0) {
        restoredTicket = sellDir === 'asc' ? '0' : String(total - 1);
      } else {
        restoredTicket = '0';   // last resort
      }
    }

    // Recompute ticketsSold from the restored position. ticketsSold =
    // |startTicket - currentTicket| or, if startTicket is null, |fresh - current|.
    const total = Number(box.totalTickets || 0);
    const restoredTicketNum = Number(restoredTicket);
    const startNum = box.startTicket != null
      ? Number(box.startTicket)
      : (total > 0 ? total - 1 : 0);   // assume desc default; adjusted above
    const ticketsSold = Number.isFinite(restoredTicketNum) && Number.isFinite(startNum)
      ? Math.max(0, Math.abs(startNum - restoredTicketNum))
      : 0;
    const ticketPriceNum = Number(box.ticketPrice || 0);
    const salesAmount = Math.round(ticketsSold * ticketPriceNum * 100) / 100;

    const updated = await prisma.lotteryBox.update({
      where: { id: boxId },
      data: {
        status: 'active',
        depletedAt: null,
        returnedAt: null,                       // ← Apr 2026: also clear returnedAt for returned-book restores
        autoSoldoutReason: null,
        currentTicket: restoredTicket,
        // May 2026 — also reset lastShiftEndTicket so the EoD wizard's
        // "yesterday" column doesn't carry a stale soldout sentinel (-1
        // for desc, totalTickets for asc) on the day after a restore.
        // Without this, the wizard reads box.lastShiftEndTicket=-1 even
        // though currentTicket was restored to e.g. 149, then today
        // auto-fills to 149 and the math computes |(-1) − 149| × price
        // as a phantom whole-pack sale on the day of the restore.
        lastShiftEndTicket: restoredTicket,
        ticketsSold,
        salesAmount,
        updatedAt: new Date(),
      },
      include: { game: true },
    });

    // Write a correction close_day_snapshot for the depleted/returned day.
    // createdAt is `cutoff + 1 ms` (cutoff = depletedAt OR returnedAt) so
    // it sorts AFTER the original SO/return event — snapshotSales picks
    // this one as the "latest event of the day" and reverts that day's
    // inflated sale back to reality.
    const correctionAt = new Date(cutoff.getTime() + 1);
    await prisma.lotteryScanEvent
      .create({
        data: {
          orgId: orgId as string,
          storeId: storeId as string,
          boxId,
          scannedBy: req.user?.id || null,
          raw: `restore-to-counter:${boxId}:${correctionAt.toISOString().slice(0, 10)}`,
          parsed: {
            gameNumber: updated.game?.gameNumber ?? null,
            gameName: updated.game?.name ?? null,
            currentTicket: restoredTicket,
            ticketsSold,
            soldout: false,
            source: 'manual-restore',
            reason,
          } as Prisma.InputJsonValue,
          action: 'close_day_snapshot',
          context: 'eod',
          createdAt: correctionAt,
        },
      })
      .catch((e: Error) => console.warn('[restoreBoxToCounter] correction snapshot insert failed', boxId, e.message));

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * POST /api/lottery/boxes/:id/return-to-lotto
 * Body: { reason?: string }
 *
 * Marks the book as returned to the lottery commission. Unsold tickets
 * (totalTickets − ticketsSold) × ticketPrice will be deducted from the
 * weekly settlement (Phase 2). Works from both Safe and Counter.
 */
export const returnBoxToLotto = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const boxId = req.params.id;
    const {
      reason = null,
      // Optional — when present the book is treated as a PARTIAL return.
      // The daily-inventory math already classifies this row as partial
      // vs full based on whether ticketsSold > 0 at the time returnedAt
      // is set, so updating ticketsSold before flipping to 'returned' is
      // all that's needed. Omit (or pass 0) for a full return.
      ticketsSold,
      // Informational metadata — accepted so the UI can log "partial"
      // explicitly even when ticketsSold is 0 (e.g. manual adjustment).
      returnType,
      // Apr 2026 — accept selected calendar date so the return is dated
      // correctly when admin returns a book retroactively (e.g., "this
      // book was physically returned yesterday"). Defaults to today.
      // Mirrors markBoxSoldout's date handling.
      date: dateStr,
    } = req.body || {};

    const box = await prisma.lotteryBox.findFirst({ where: { id: boxId, orgId, storeId } });
    if (!box) {
      res.status(404).json({ success: false, error: 'Box not found' });
      return;
    }
    if (!['inventory', 'active'].includes(box.status)) {
      res
        .status(400)
        .json({ success: false, error: `Cannot return from status ${box.status}` });
      return;
    }

    // Resolve return date (mirrors markBoxSoldout). returnedAt is set to
    // the selected day's 23:59:59 LOCAL so the close_day_snapshot we
    // write below sorts as the LATEST event for that day → snapshotSales
    // picks our return-position over any prior same-day snapshot.
    // May 2026 — store-local-day boundaries (was UTC, broke for non-US tz).
    // Also subtract 1ms (Fix A pattern) so any later restore-correction
    // event (cutoff+1ms) stays within the same day's window.
    let returnedAt: Date;
    if (dateStr) {
      const dateParsed = parseDate(dateStr);
      if (!dateParsed) {
        res.status(400).json({ success: false, error: 'Invalid date (expected YYYY-MM-DD)' });
        return;
      }
      const storeRow = await prisma.store.findUnique({
        where: { id: storeId as string },
        select: { timezone: true },
      });
      const tz = storeRow?.timezone || 'UTC';
      const { localDayEndUTC } = await import('../../utils/dateTz.js');
      returnedAt = new Date(localDayEndUTC(dateStr, tz).getTime() - 1);
    } else {
      returnedAt = new Date();
    }

    const data: Prisma.LotteryBoxUpdateInput = {
      status: 'returned',
      returnedAt,
      slotNumber: null,
      autoSoldoutReason: reason || (returnType ? `Return (${returnType})` : null),
      updatedAt: new Date(),
    };

    // Resolve sellDirection — drives the post-return currentTicket position
    // computation. Default 'desc' matches the rest of the codebase.
    const settings = await prisma.lotterySettings
      .findUnique({ where: { storeId }, select: { sellDirection: true } })
      .catch(() => null);
    const sellDir = settings?.sellDirection || 'desc';

    const total = Number(box.totalTickets || 0);
    let normalizedTicketsSold: number | null = null;

    // Accept ticketsSold for partial returns. Clamp to [0, totalTickets].
    if (ticketsSold != null) {
      const n = Number(ticketsSold);
      if (!Number.isFinite(n) || n < 0) {
        res
          .status(400)
          .json({ success: false, error: 'ticketsSold must be a non-negative number' });
        return;
      }
      normalizedTicketsSold = total > 0 ? Math.min(n, total) : Math.floor(n);
      data.ticketsSold = normalizedTicketsSold;

      // Apr 2026 — also bump currentTicket to reflect the post-return
      // position so the close_day_snapshot we write below is meaningful.
      // For desc-direction: book starts at startTicket=99 (100-pack), 20
      // sold means top 20 tickets gone, currentTicket = 79 (next-to-sell
      // would be ticket 79 if the book were active). For asc: 20 sold
      // means tickets 0-19 gone, currentTicket = 20.
      const start = box.startTicket != null
        ? Number(box.startTicket)
        : (sellDir === 'asc' ? 0 : Math.max(0, total - 1));
      let newCurrent: number;
      if (sellDir === 'asc') {
        newCurrent = start + normalizedTicketsSold;
      } else {
        newCurrent = start - normalizedTicketsSold;
      }
      data.currentTicket = String(newCurrent);
    }

    const updated = await prisma.lotteryBox.update({
      where: { id: boxId },
      data,
      include: { game: true },
    });

    // Apr 2026 — Write close_day_snapshot for the return day (parity with
    // markBoxSoldout). Without this, partial returns contribute ZERO to
    // the day's sales math:
    //   - snapshotSales tier skips (no event)
    //   - liveSalesFromCurrentTickets skips (status='returned' not 'active')
    //   - POS tier only catches what was rung up — tickets sold without
    //     POS rings get attributed to nowhere
    //
    // With this snapshot, snapshotSales sees today=newCurrent and computes
    // the correct delta (= ticketsSold) × price for that day.
    if (normalizedTicketsSold != null && data.currentTicket != null) {
      await prisma.lotteryScanEvent
        .create({
          data: {
            orgId: orgId as string,
            storeId: storeId as string,
            boxId,
            scannedBy: req.user?.id || null,
            raw: `return:${boxId}:${dateStr || returnedAt.toISOString().slice(0, 10)}`,
            parsed: {
              gameNumber: updated.game?.gameNumber ?? null,
              gameName: updated.game?.name ?? null,
              currentTicket: data.currentTicket as string,
              ticketsSold: normalizedTicketsSold,
              soldout: false,
              source: 'manual-return',
              returnType: returnType || (normalizedTicketsSold > 0 ? 'partial' : 'full'),
              reason: reason || null,
            } as Prisma.InputJsonValue,
            action: 'close_day_snapshot',
            context: 'eod',
            createdAt: returnedAt,
          },
        })
        .catch((e: Error) => console.warn('[returnBoxToLotto] snapshot insert failed', boxId, e.message));
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[lottery.returnBoxToLotto]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * DELETE /api/lottery/boxes/:id/pending-move
 * Cancels a scheduled Move to Safe (or any other pending location change).
 */
export const cancelPendingMove = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const boxId = req.params.id;

    const box = await prisma.lotteryBox.findFirst({ where: { id: boxId, orgId, storeId } });
    if (!box) {
      res.status(404).json({ success: false, error: 'Box not found' });
      return;
    }
    if (!box.pendingLocation) {
      res.status(400).json({ success: false, error: 'No pending move to cancel' });
      return;
    }

    const updated = await prisma.lotteryBox.update({
      where: { id: boxId },
      data: {
        pendingLocation: null,
        pendingLocationEffectiveDate: null,
        pendingLocationRequestedAt: null,
        updatedAt: new Date(),
      },
      include: { game: true },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * POST /api/lottery/run-pending-moves
 * On-demand trigger for the pending-move sweep. Useful for "Close the Day".
 */
export const runPendingMovesNow = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStore(req);
    const result = await _runPendingMoveSweep({ storeId: storeId || null });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

