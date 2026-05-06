/**
 * Lottery — Boxes (physical packs) + Ticket Adjustment.
 * Split from `lotteryController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (6):
 *   - getLotteryBoxes    GET    /lottery/boxes  (paginated, status filter)
 *   - receiveBoxOrder    POST   /lottery/boxes/receive (delivery — multi-box)
 *   - activateBox        POST   /lottery/boxes/:id/activate (inventory → active
 *                                + write `shift_boundary` snapshot for S62 EoD)
 *   - updateBox          PUT    /lottery/boxes/:id (status changes, ticket
 *                                position edits, settle)
 *   - deleteBox          DELETE /lottery/boxes/:id (only when status=inventory)
 *   - adjustBoxTickets   POST   /lottery/boxes/:id/adjust-tickets
 *                                (manual +/- correction with audit trail)
 *
 * Box lifecycle:
 *   inventory → active (on counter, sales counted) → depleted (last ticket
 *   sold or marked sold-out) → settled (commission paid). Sequence is
 *   enforced — admin can't skip from inventory → settled directly.
 */

import type { Request, Response } from 'express';
import type { Prisma, LotteryGame } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { errMsg } from '../../utils/typeHelpers.js';
import { getOrgId, getStore, parseDate, num } from './helpers.js';

// ══════════════════════════════════════════════════════════════════════════
// BOXES
// ══════════════════════════════════════════════════════════════════════════

export const getLotteryBoxes = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { status, gameId } = req.query;
    const boxes = await prisma.lotteryBox.findMany({
      where: {
        orgId,
        storeId,
        ...(status && { status: status as string }),
        ...(gameId && { gameId: gameId as string }),
      },
      include: { game: { select: { id: true, name: true, gameNumber: true, ticketPrice: true } } },
      // Unassigned slots (null) go first within the active group so newly
      // activated books surface at the top until the cashier assigns a slot.
      orderBy: [{ status: 'asc' }, { slotNumber: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
    });
    res.json({ success: true, data: boxes });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

interface ResolveStoreGameInput {
  orgId: string;
  storeId: string;
  gameId?: string | null;
  catalogTicketId?: string | null;
  state?: string | null;
  gameNumber?: string | number | null;
}

/**
 * Resolve (or create) a store-level LotteryGame given either a direct
 * gameId, an admin-catalog catalogTicketId, or a scanned (state + gameNumber)
 * pair. Centralises the "does this store have this game yet?" logic so the
 * same fallback chain is used by every receive path.
 *
 * Lookup order:
 *   1. Direct gameId (already store-scoped).
 *   2. Real gameNumber match inside this store.
 *   3. catalogTicketId → look up LotteryTicketCatalog, then match by
 *      real gameNumber in store, or create a store LotteryGame from the
 *      catalog entry (storing the REAL gameNumber, not a synthetic ref).
 *   4. (state, gameNumber) from a scan → same as #3 but via state lookup
 *      in the catalog.
 *
 * Returns the resolved LotteryGame row (with state, gameNumber, name,
 * ticketPrice, ticketsPerBox populated).
 */
export async function resolveOrCreateStoreGame({
  orgId,
  storeId,
  gameId,
  catalogTicketId,
  state,
  gameNumber,
}: ResolveStoreGameInput): Promise<LotteryGame> {
  // 1. Direct gameId
  if (gameId) {
    const g = await prisma.lotteryGame.findFirst({
      where: { id: gameId, orgId, storeId, deleted: false },
    });
    if (g) return g;
  }

  // 2. Real gameNumber match at this store (scan-driven receive will hit this
  //    after the store has the game in its own list from a prior receive)
  if (gameNumber) {
    const g = await prisma.lotteryGame.findFirst({
      where: {
        orgId,
        storeId,
        gameNumber: String(gameNumber),
        deleted: false,
        ...(state ? { state } : {}),
      },
    });
    if (g) return g;
  }

  // 3. Catalog lookup (via explicit id)
  let cat = null;
  if (catalogTicketId) {
    cat = await prisma.lotteryTicketCatalog.findUnique({ where: { id: catalogTicketId } });
    if (!cat) throw new Error(`Catalog ticket ${catalogTicketId} not found`);
  }

  // 4. Catalog lookup (via state + gameNumber from a scan)
  if (!cat && state && gameNumber) {
    cat = await prisma.lotteryTicketCatalog.findFirst({
      where: { state: String(state).toUpperCase(), gameNumber: String(gameNumber) },
    });
  }

  if (!cat) {
    // Last-chance: a game might already exist in store with the ref format
    // (legacy data from pre-fix receiveFromCatalog). Try that too.
    if (catalogTicketId) {
      const legacy = await prisma.lotteryGame.findFirst({
        where: { orgId, storeId, gameNumber: `catalog:${catalogTicketId}`, deleted: false },
      });
      if (legacy) return legacy;
    }
    throw new Error('Game not found in catalog or store');
  }

  // Create the store-level game from the catalog entry, using the REAL
  // gameNumber (fixes the legacy "catalog:xxx" synthetic-ref bug).
  // Double-check there isn't already one (race condition, manual creation, etc.)
  const existing = await prisma.lotteryGame.findFirst({
    where: {
      orgId,
      storeId,
      gameNumber: cat.gameNumber,
      state: cat.state,
      deleted: false,
    },
  });
  if (existing) return existing;

  return prisma.lotteryGame.create({
    data: {
      orgId,
      storeId,
      name: cat.name,
      gameNumber: cat.gameNumber,
      ticketPrice: Number(cat.ticketPrice),
      ticketsPerBox: cat.ticketsPerBook,
      state: cat.state,
      isGlobal: false,
      active: true,
    },
  });
}

export const receiveBoxOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    // Support multiple request shapes:
    //   1. { boxes: [{ gameId, boxNumber, ... }, ...] }        — bulk by gameId
    //   2. { boxes: [{ catalogTicketId, boxNumber, ... }, ...] } — bulk by catalog
    //   3. { boxes: [{ state, gameNumber, boxNumber, ... }] } — scan-driven bulk
    //   4. { gameId, quantity, startTicket, boxNumber }       — legacy portal form
    let items = req.body.boxes;
    if (!items) {
      const { gameId, quantity = 1, startTicket, boxNumber } = req.body;
      if (!gameId) {
        res.status(400).json({ success: false, error: 'gameId is required' });
        return;
      }
      items = Array.from({ length: Number(quantity) }, () => ({
        gameId,
        startTicket,
        boxNumber: boxNumber || null,
      }));
    }
    if (!Array.isArray(items) || !items.length) {
      res.status(400).json({ success: false, error: 'No boxes to receive' });
      return;
    }

    // Apr 2026 — accept `date` parameter so manager can record a receive
    // that physically happened on a past date (e.g., manager was out for a
    // few days and is now logging the receive retroactively). Without this,
    // every receive uses Prisma's @default(now()) which puts createdAt at
    // the current moment — which then misclassifies which day's "Received"
    // total the books fall into. Mirrors activateBox / markBoxSoldout /
    // returnBoxToLotto's date handling.
    //
    // The date sets `createdAt` for every box in this order. Defaults to
    // now() when omitted (legacy callers + scan-time receives). Future
    // dates are rejected — receive can only be retroactive, not forward.
    const dateStr = req.body.date as string | undefined;
    let receivedAt: Date | null = null;
    if (dateStr) {
      const parsed = parseDate(dateStr);
      if (!parsed) {
        res.status(400).json({ success: false, error: 'Invalid date (expected YYYY-MM-DD)' });
        return;
      }
      // Resolve the store's tz so receivedAt lands on the right local-day.
      // Without this, `setUTCHours(23,59,59)` only worked by accident in
      // negative-offset zones (US) — for positive-offset zones (NZ, AU,
      // Asia, EU) the receive showed up in the WRONG local day's bucket.
      const storeRow = await prisma.store.findUnique({
        where: { id: storeId as string },
        select: { timezone: true },
      });
      const tz = storeRow?.timezone || 'UTC';
      const { localDayEndUTC, formatLocalDate } = await import('../../utils/dateTz.js');
      const now = new Date();
      // Reject future dates (compared in store-local time, not UTC).
      const todayLocal = formatLocalDate(now, tz);
      if (dateStr > todayLocal) {
        res.status(400).json({ success: false, error: 'Receive date cannot be in the future.' });
        return;
      }
      // Set receivedAt to the END of the selected LOCAL day so it sorts
      // AFTER any earlier same-day events AND lands inside the selected
      // day's local-day window for the daily-inventory query.
      const computed: Date = localDayEndUTC(dateStr, tz);
      // If today and end-of-day is in the future, clamp to now so the
      // timestamp isn't synthetic-future.
      receivedAt = computed.getTime() > now.getTime() ? now : computed;
    }

    // Apr 2026 — duplicate-book validation. A physical lottery book has a
    // unique (gameNumber, bookNumber) — receiving the same book twice
    // would create two LotteryBox rows that share inventory math + scan
    // matching, producing wrong sales numbers and confusing the cashier.
    // Reject the receive if the same (gameId, boxNumber) already exists at
    // this store in any active-lifecycle status (inventory/active/depleted/
    // returned) — settled books can theoretically have the box-number
    // recycled by the lottery commission years later, so those are excluded.
    type CreatedBox = Awaited<ReturnType<typeof prisma.lotteryBox.create>>;
    const created: CreatedBox[] = [];
    const duplicates: Array<{ gameNumber: string | null; boxNumber: string; existingStatus: string }> = [];

    for (const b of items as Record<string, unknown>[]) {
      let game = await resolveOrCreateStoreGame({
        orgId,
        storeId,
        gameId: b.gameId as string | null | undefined,
        catalogTicketId: b.catalogTicketId as string | null | undefined,
        state: b.state as string | null | undefined,
        gameNumber: b.gameNumber as string | number | null | undefined,
      });
      const total = Number(b.totalTickets || game.ticketsPerBox);

      // Persist pack-size correction back to the store-level LotteryGame
      // so future receives default correctly (every book of the same game
      // has the same pack size — natural home for the value).
      if (
        b.totalTickets != null &&
        Number.isFinite(total) &&
        total > 0 &&
        total !== game.ticketsPerBox
      ) {
        game = await prisma.lotteryGame.update({
          where: { id: game.id },
          data: { ticketsPerBox: total },
        });
      }

      const boxNum = (b.boxNumber as string | null) || null;

      // Duplicate check — only fires when boxNumber is set (legacy receives
      // without a book number can have multiple null-number rows; the lottery
      // commission requires book numbers in practice so this should be rare).
      if (boxNum) {
        const existing = await prisma.lotteryBox.findFirst({
          where: {
            orgId,
            storeId,
            gameId: game.id,
            boxNumber: boxNum,
            status: { in: ['inventory', 'active', 'depleted', 'returned'] },
          },
          select: { status: true },
        });
        if (existing) {
          duplicates.push({
            gameNumber: game.gameNumber || null,
            boxNumber: boxNum,
            existingStatus: existing.status,
          });
          continue;   // skip this item; we'll error after the loop
        }
      }

      const newBox = await prisma.lotteryBox.create({
        data: {
          orgId,
          storeId,
          gameId: game.id,
          boxNumber: boxNum,
          totalTickets: total,
          ticketPrice: Number(game.ticketPrice),
          totalValue: Number(game.ticketPrice) * total,
          startTicket: (b.startTicket as string | null) || null,
          status: 'inventory',
          // Apr 2026 — explicit createdAt for retroactive receives. When
          // `receivedAt` is null, Prisma falls back to @default(now()).
          ...(receivedAt && { createdAt: receivedAt }),
        },
      });
      created.push(newBox);
    }

    if (duplicates.length > 0) {
      // Friendly error mapping each duplicate to its existing-book status.
      // The UI can surface this so the cashier knows EXACTLY which books
      // are already in inventory and what their current state is.
      const statusLabel = (s: string) => ({
        inventory: 'Safe',
        active: 'Counter',
        depleted: 'Sold Out',
        returned: 'Returned to Lotto',
      }[s] || s);
      const message = duplicates.length === 1
        ? `Book ${duplicates[0].gameNumber}-${duplicates[0].boxNumber} is already in your store as ${statusLabel(duplicates[0].existingStatus)}. Cannot receive the same book twice.`
        : `${duplicates.length} books are already in your store: ` +
          duplicates.slice(0, 3).map((d) => `${d.gameNumber}-${d.boxNumber} (${statusLabel(d.existingStatus)})`).join(', ') +
          (duplicates.length > 3 ? `, and ${duplicates.length - 3} more.` : '.');
      res.status(409).json({
        success: false,
        error: message,
        duplicates,
        partial: created.length > 0 ? created : undefined,
      });
      return;
    }

    res.json({ success: true, data: created, count: created.length });
  } catch (err) {
    console.error('[lottery.receiveBoxOrder]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const activateBox = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const { slotNumber, date, currentTicket } = req.body || {};

    const box = await prisma.lotteryBox.findFirst({ where: { id, orgId, storeId } });
    if (!box) {
      res.status(404).json({ success: false, error: 'Box not found' });
      return;
    }
    if (['depleted', 'returned', 'settled'].includes(box.status)) {
      res.status(400).json({ success: false, error: `Cannot activate a ${box.status} book` });
      return;
    }

    // Box # / slot is OPTIONAL on activation (Session 45 / L2). The cashier
    // assigns the physical slot later when they place the book on the
    // machine. Old behavior auto-assigned the next free slot — that hid
    // the "I haven't placed it yet" state. Now: explicit slot only.
    let slot: number | null = null;
    if (slotNumber != null && slotNumber !== '') {
      slot = Number(slotNumber);
      if (!Number.isFinite(slot)) {
        res.status(400).json({ success: false, error: 'slotNumber must be a number' });
        return;
      }
      // Ensure the chosen slot isn't already occupied by another active book.
      const clash = await prisma.lotteryBox.findFirst({
        where: { orgId, storeId, status: 'active', slotNumber: slot, NOT: { id } },
      });
      if (clash) {
        res.status(409).json({
          success: false,
          error: `Slot ${slot} is already occupied by book ${clash.boxNumber || clash.id}`,
        });
        return;
      }
    }

    const activatedAt = date ? new Date(date) : new Date();
    const updated = await prisma.lotteryBox.update({
      where: { id },
      data: {
        status: 'active',
        activatedAt,
        slotNumber: slot,   // null when not assigned yet (shows on top of Counter)
        ...(currentTicket != null && {
          currentTicket: String(currentTicket),
          lastShiftStartTicket: String(currentTicket),
        }),
      },
      include: { game: true },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateBox = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const box = await prisma.lotteryBox.findFirst({ where: { id, orgId, storeId } });
    if (!box) {
      res.status(404).json({ success: false, error: 'Box not found' });
      return;
    }
    const {
      slotNumber,
      status,
      currentTicket,
      // Additional fields: used to fix pack-size / pricing mistakes on books
      // that were received with the wrong metadata. totalValue is auto-
      // recomputed when totalTickets or ticketPrice change so reports stay
      // consistent. startTicket is accepted for EoD corrections.
      totalTickets,
      ticketPrice,
      startTicket,
      boxNumber,
    } = req.body;

    // Apr 2026 — slot-uniqueness check (parity with activateBox). Without
    // this, two active books could end up assigned to the same machine
    // slot when admin renumbers via the back-office Counter row's slot
    // input — confusing for cashiers + breaks slot-based scan routing.
    let slotForUpdate: number | null | undefined;
    if (slotNumber !== undefined) {
      if (slotNumber === null || slotNumber === '') {
        slotForUpdate = null;   // explicit clear
      } else {
        const slot = Number(slotNumber);
        if (!Number.isFinite(slot)) {
          res.status(400).json({ success: false, error: 'slotNumber must be a number' });
          return;
        }
        // Only enforce uniqueness against ACTIVE books — soldout/returned/
        // inventory books can keep their old slot number for audit trail
        // (slotNumber is set null by markBoxSoldout/returnBoxToLotto/
        // moveBoxToSafe so this is mostly defensive).
        const clash = await prisma.lotteryBox.findFirst({
          where: { orgId, storeId, status: 'active', slotNumber: slot, NOT: { id } },
          select: { id: true, boxNumber: true, game: { select: { name: true } } },
        });
        if (clash) {
          res.status(409).json({
            success: false,
            error: `Slot ${slot} is already occupied by ${clash.game?.name || 'book'} ${clash.boxNumber || clash.id}. Move that book first or pick a different slot.`,
          });
          return;
        }
        slotForUpdate = slot;
      }
    }

    // Apr 2026 — boxNumber uniqueness check on rename. Without this, admin
    // could rename one book's boxNumber to another active book's number,
    // leaving the system with two rows that share (gameId, boxNumber) —
    // which scan-matching depends on. Same status filter as receiveBoxOrder
    // (active-lifecycle states only; settled books can recycle numbers).
    if (boxNumber != null && String(boxNumber).trim() !== '' && String(boxNumber) !== String(box.boxNumber || '')) {
      const dup = await prisma.lotteryBox.findFirst({
        where: {
          orgId,
          storeId,
          gameId: box.gameId,
          boxNumber: String(boxNumber),
          status: { in: ['inventory', 'active', 'depleted', 'returned'] },
          NOT: { id },
        },
        select: { id: true, status: true, boxNumber: true },
      });
      if (dup) {
        const statusLabel = (s: string) => ({
          inventory: 'Safe',
          active: 'Counter',
          depleted: 'Sold Out',
          returned: 'Returned to Lotto',
        }[s] || s);
        res.status(409).json({
          success: false,
          error: `Book number ${boxNumber} is already used by another book in ${statusLabel(dup.status)} for this game. Pick a different number or update the other book first.`,
        });
        return;
      }
    }

    // May 2026 — validate currentTicket bounds + auto-deplete on sentinel.
    //
    // Per user direction: only -1 is valid as a negative for desc books
    // (the soldout sentinel). For asc books the sentinel is `totalTickets`,
    // and negatives are always invalid. Anything more negative than -1 (or
    // above the cap for asc) corrupts next-day carry-over math because
    // snapshotSales computes |prev_close - today_close| × price — if today_close
    // is -2 instead of -1, the next day's "yesterday close" becomes -2 and
    // the wrong amount gets attributed.
    //
    // When the cashier enters the SO sentinel via the ticket input (e.g. types
    // "-1" instead of clicking the SO button), we auto-deplete the book in
    // the same write — flips status='depleted', stamps depletedAt, and the
    // close_day_snapshot is written below if needed. This makes the typed
    // sentinel and the SO button-click produce identical end states.
    let autoDepleted = false;
    if (currentTicket != null) {
      const ticketStr = String(currentTicket).trim();
      const ticketNum = parseInt(ticketStr, 10);
      const totalTicketsForCheck =
        totalTickets != null ? Number(totalTickets) : Number(box.totalTickets || 0);

      // Resolve sellDirection for bounds-check
      const sellSettings = await prisma.lotterySettings
        .findUnique({ where: { storeId: storeId as string }, select: { sellDirection: true } })
        .catch(() => null);
      const sellDir = sellSettings?.sellDirection || 'desc';

      // Bounds: desc → [-1, totalTickets-1]; asc → [0, totalTickets]
      // (-1 desc and totalTickets asc are the soldout sentinels)
      const minPos = sellDir === 'asc' ? 0 : -1;
      const maxPos = sellDir === 'asc' ? totalTicketsForCheck : totalTicketsForCheck - 1;
      if (!Number.isFinite(ticketNum) || ticketNum < minPos || ticketNum > maxPos) {
        res.status(400).json({
          success: false,
          error: `Ticket position ${ticketStr} is out of range for this book. Valid range: ${minPos}..${maxPos} (sellDirection=${sellDir}, pack=${totalTicketsForCheck}).`,
        });
        return;
      }

      // Sentinel detection — ticket equals the "fully sold" position?
      const sentinel = sellDir === 'asc' ? totalTicketsForCheck : -1;
      if (ticketNum === sentinel && box.status === 'active') {
        autoDepleted = true;
      }
    }

    const patch: Prisma.LotteryBoxUpdateInput = {
      ...(slotForUpdate !== undefined && { slotNumber: slotForUpdate }),
      ...(status != null && { status }),
      ...(currentTicket != null && { currentTicket: String(currentTicket) }),
      ...(startTicket != null && { startTicket: String(startTicket) }),
      ...(boxNumber != null && { boxNumber: String(boxNumber) }),
      ...(status === 'depleted' && !box.depletedAt && { depletedAt: new Date() }),
      // May 2026 — sentinel-driven auto-deplete (see block above)
      ...(autoDepleted && {
        status: 'depleted',
        depletedAt: new Date(),
        autoSoldoutReason: 'sentinel_typed',
      }),
    };

    // Recompute totalValue whenever totalTickets or ticketPrice change so
    // Counter/Safe value totals stay accurate.
    if (totalTickets != null || ticketPrice != null) {
      const newTotal = totalTickets != null ? Number(totalTickets) : Number(box.totalTickets || 0);
      const newPrice = ticketPrice != null ? Number(ticketPrice) : Number(box.ticketPrice || 0);
      if (totalTickets != null) patch.totalTickets = newTotal;
      if (ticketPrice != null) patch.ticketPrice = newPrice;
      patch.totalValue = newTotal * newPrice;
    }

    const updated = await prisma.lotteryBox.update({
      where: { id },
      data: patch,
    });

    // May 2026 — when auto-depleted, also write the close_day_snapshot so
    // ticket-math sales on this day reflect the soldout. Mirrors what
    // markBoxSoldout does. Fire-and-forget; failure logged but doesn't
    // poison the response — the box state IS updated.
    if (autoDepleted) {
      const now = new Date();
      prisma.lotteryScanEvent
        .create({
          data: {
            orgId: orgId as string,
            storeId: storeId as string,
            boxId: id,
            scannedBy: req.user?.id || null,
            raw: `auto_soldout_via_typed_sentinel:${id}`,
            parsed: {
              gameNumber: null,
              gameName: null,
              currentTicket: String(currentTicket),
              source: 'updateBox-sentinel',
              soldout: true,
            } as Prisma.InputJsonValue,
            action: 'close_day_snapshot',
            context: 'eod',
            createdAt: now,
          },
        })
        .catch((e: Error) =>
          console.warn('[updateBox] auto-soldout snapshot insert failed', id, e.message),
        );
    }

    res.json({ success: true, data: updated, autoDepleted });
  } catch (err) {
    console.error('[lottery.updateBox]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deleteBox = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const box = await prisma.lotteryBox.findFirst({ where: { id, orgId, storeId } });
    if (!box) {
      res.status(404).json({ success: false, error: 'Box not found' });
      return;
    }
    // Apr 2026 — allow deletion from inventory, depleted (soldout), and
    // returned statuses. Per user direction: "the sold book can be deleted
    // if done by mistake or can bring back on counter". Active books are
    // still locked (currently in use on the counter); settled books are
    // locked (already accounted for in the lottery commission settlement).
    if (!['inventory', 'depleted', 'returned'].includes(box.status)) {
      res.status(400).json({
        success: false,
        error:
          `Cannot delete a book with status '${box.status}'. Only inventory (Safe), depleted (Sold Out), and returned books can be removed. ` +
          (box.status === 'active'
            ? 'Move this book to the Safe or mark it sold out first, then delete.'
            : 'Settled books are part of the closed weekly settlement and cannot be removed.'),
      });
      return;
    }

    // Don't allow deletion of books with real POS transaction history —
    // those are part of the audit trail. The cashier can Restore the book
    // instead, which keeps the history intact while undoing the SO/return.
    const txCount = await prisma.lotteryTransaction.count({
      where: { boxId: id },
    });
    if (txCount > 0) {
      res.status(400).json({
        success: false,
        error:
          `Cannot delete this book — it has ${txCount} POS transaction${txCount === 1 ? '' : 's'} on record. ` +
          'Use "Restore to Counter" instead to undo the soldout/return without losing history.',
      });
      return;
    }

    // Clean up associated scan events (otherwise the snapshot trail
    // references a non-existent box, which causes spurious entries in
    // bestEffortDailySales' boxBreakdown).
    await prisma.lotteryScanEvent.deleteMany({ where: { boxId: id } }).catch(() => {});

    await prisma.lotteryBox.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// TICKET ADJUSTMENT (+/-)
// Used to correct box counts — e.g. damaged tickets, returned, miscounts.
// Creates an adjustment transaction record for audit trail.
// ══════════════════════════════════════════════════════════════════════════

export const adjustBoxTickets = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const { delta, reason, notes } = req.body;

    if (delta === undefined || delta === null || Number(delta) === 0) {
      res.status(400).json({ success: false, error: 'delta is required and must be non-zero' });
      return;
    }
    if (!reason) {
      res.status(400).json({ success: false, error: 'reason is required' });
      return;
    }

    const box = await prisma.lotteryBox.findFirst({
      where: { id, orgId, storeId },
      include: { game: { select: { id: true, name: true, gameNumber: true, ticketPrice: true } } },
    });
    if (!box) {
      res.status(404).json({ success: false, error: 'Box not found' });
      return;
    }

    const deltaInt = parseInt(delta);
    const newTicketsSold = Math.max(0, (box.ticketsSold || 0) + deltaInt);

    // Don't allow going above total tickets
    if (box.totalTickets && newTicketsSold > box.totalTickets) {
      res.status(400).json({
        success: false,
        error: `Cannot exceed total tickets (${box.totalTickets}). Box already has ${box.ticketsSold} sold.`,
      });
      return;
    }

    // Update box. Note: legacy JS treated currentTicket/startTicket numerically
    // even though the schema stores them as nullable strings; preserve that
    // permissive behaviour via cast to keep runtime semantics identical.
    const curNum =
      box.currentTicket != null
        ? Math.max(
            Number(box.startTicket || 0),
            (Number(box.currentTicket as unknown as number) || 0) + deltaInt,
          )
        : null;
    const updatedBox = await prisma.lotteryBox.update({
      where: { id },
      data: {
        ticketsSold: newTicketsSold,
        currentTicket: curNum != null ? (String(curNum) as unknown as Prisma.LotteryBoxUpdateInput['currentTicket']) : undefined,
      },
    });

    // Create adjustment transaction record
    const ticketPrice = Number(box.game?.ticketPrice || 0);
    const amount = deltaInt * ticketPrice;

    await prisma.lotteryTransaction
      .create({
        data: {
          orgId: orgId as string,
          storeId: storeId as string,
          boxId: box.id,
          gameId: box.gameId,
          type: 'adjustment',
          amount: Math.abs(amount),
          ticketCount: Math.abs(deltaInt),
          notes: `${deltaInt > 0 ? '+' : ''}${deltaInt} tickets — ${reason}${notes ? ': ' + notes : ''}`,
          userId: req.user?.id || null,
        },
      })
      .catch(() => {});

    res.json({ success: true, data: updatedBox });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

