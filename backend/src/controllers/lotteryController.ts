/**
 * lotteryController.ts
 *
 * Handles all lottery module operations:
 *   Games    → ticket types, prices, commission rates
 *   Boxes    → physical packs: inventory → active → depleted
 *   Transactions → per-shift sale / payout recording
 *   ShiftReport  → end-of-shift reconciliation
 *   Reports  → daily / weekly / monthly summary + commission
 */

import type { Request, Response } from 'express';
import type { Prisma, LotteryGame } from '@prisma/client';
import prisma from '../config/postgres.js';
import {
  parseScan as _parseScan,
  processScan as _processScan,
  runPendingMoveSweep as _runPendingMoveSweep,
  weekRangeFor as _weekRangeFor,
  computeSettlement as _computeSettlement,
  getAdapter as _getAdapter,
  syncState as _syncState,
  syncAllSupported as _syncAllSupported,
} from '../services/lottery/index.js';
import {
  bestEffortDailySales,
  rangeSales,
  localDayStartUTC,
  localDayEndUTC,
  formatLocalDate,
} from '../services/lottery/reporting/index.js';
import { reconcileShift } from '../services/reconciliation/shift/index.js';
import { errMsg } from '../utils/typeHelpers.js';

const getOrgId = (req: Request): string | undefined =>
  req.orgId || req.user?.orgId || undefined;
const getStore = (req: Request): string | undefined => {
  const h = req.headers['x-store-id'];
  if (typeof h === 'string') return h;
  if (Array.isArray(h) && typeof h[0] === 'string') return h[0];
  if (req.storeId) return req.storeId;
  const q = req.query?.storeId;
  if (typeof q === 'string') return q;
  if (Array.isArray(q) && typeof q[0] === 'string') return q[0];
  return undefined;
};

// ── helpers ────────────────────────────────────────────────────────────────
const num = (v: unknown): number | null => (v != null ? Number(v) : null);

// JSON-typed payload for LotteryScanEvent.parsed
type ScanEventParsed = Record<string, unknown>;

// ── Permissive row shapes for prisma findMany results ─────────────────────
//
// The default `prisma` import resolves to `any` (postgres.js wraps a
// nullable global), which would taint every callback parameter with
// implicit-any errors under strict mode. We cast each findMany result to
// these shapes so .filter/.map/.reduce callbacks see real types — same
// pattern as posTerminalController + aiAssistantController.
type LotteryTxnRow = {
  id?: string;
  type: string;
  amount: number | string;
  shiftId?: string | null;
  cashierId?: string | null;
  stationId?: string | null;
  gameId?: string | null;
  boxId?: string | null;
  ticketCount?: number | null;
  notes?: string | null;
  posTransactionId?: string | null;
  createdAt: Date;
};

type LotteryOnlineTotalRow = {
  date: Date;
  machineSales?: number | string | null;
  machineCashing?: number | string | null;
  instantCashing?: number | string | null;
};

type LotteryGameRow = { id: string; name: string };

type LotteryBoxLite = {
  id: string;
  ticketPrice: number | string;
  startTicket: string | null;
  totalTickets: number | null;
  currentTicket?: string | null;
  gameId?: string;
};

type LotteryBoxValueRow = {
  totalValue: number | string | null;
  ticketsSold?: number | null;
  ticketPrice?: number | string | null;
  totalTickets?: number | null;
};

type LotteryScanEventRow = {
  boxId: string | null;
  parsed: unknown;
  createdAt?: Date;
};

// Per-day / per-game / per-box buckets used in reports
interface DayBucket {
  date: string;
  sales: number;
  payouts: number;
  net: number;
  machineSales: number;
  machineCashing: number;
  instantCashing: number;
}

interface GameBucket {
  gameId: string;
  gameName: string | null;
  sales: number;
  payouts: number;
  net: number;
  count: number;
}

// (BoxSale / GameSale / DailySalesResult moved to
//  src/services/lottery/reporting/types.ts)

// ══════════════════════════════════════════════════════════════════════════
// GAMES
// ══════════════════════════════════════════════════════════════════════════

export const getLotteryGames = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    // Get store's state from LotterySettings (if set)
    const settings = storeId
      ? await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null)
      : null;
    const storeState = settings?.state;

    const games = await prisma.lotteryGame.findMany({
      where: {
        deleted: false,
        OR: [
          // Store-specific games
          { orgId, storeId },
          // Global games matching this store's state (managed by admin)
          ...(storeState ? [{ orgId, isGlobal: true, state: storeState }] : []),
        ],
      },
      include: {
        boxes: {
          where: { status: { in: ['inventory', 'active'] } },
          select: { id: true, status: true, ticketsSold: true, totalTickets: true },
        },
      },
      orderBy: { ticketPrice: 'asc' },
    });
    res.json({ success: true, data: games });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const createLotteryGame = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { name, gameNumber, ticketPrice, ticketsPerBox, state, isGlobal } = req.body;
    if (!name || !ticketPrice) {
      res.status(400).json({ success: false, error: 'name and ticketPrice are required' });
      return;
    }
    const game = await prisma.lotteryGame.create({
      data: {
        orgId: orgId as string,
        storeId: storeId as string,
        name,
        gameNumber,
        ticketPrice: Number(ticketPrice),
        ticketsPerBox: Number(ticketsPerBox || 300),
        state: state || null,
        isGlobal: isGlobal ? true : false,
      },
    });
    res.json({ success: true, data: game });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateLotteryGame = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const game = await prisma.lotteryGame.findFirst({ where: { id, orgId } });
    if (!game) {
      res.status(404).json({ success: false, error: 'Game not found' });
      return;
    }
    const { name, gameNumber, ticketPrice, ticketsPerBox, active, state, isGlobal } = req.body;
    const updated = await prisma.lotteryGame.update({
      where: { id },
      data: {
        ...(name != null && { name }),
        ...(gameNumber != null && { gameNumber }),
        ...(ticketPrice != null && { ticketPrice: Number(ticketPrice) }),
        ...(ticketsPerBox != null && { ticketsPerBox: Number(ticketsPerBox) }),
        ...(active != null && { active: Boolean(active) }),
        ...(state != null && { state }),
        ...(isGlobal != null && { isGlobal: Boolean(isGlobal) }),
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deleteLotteryGame = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    await prisma.lotteryGame.updateMany({
      where: { id, orgId, storeId },
      data: { deleted: true, active: false },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

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
async function resolveOrCreateStoreGame({
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

    const created = await Promise.all(
      items.map(async (b: Record<string, unknown>) => {
        let game = await resolveOrCreateStoreGame({
          orgId,
          storeId,
          gameId: b.gameId as string | null | undefined,
          catalogTicketId: b.catalogTicketId as string | null | undefined,
          state: b.state as string | null | undefined,
          gameNumber: b.gameNumber as string | number | null | undefined,
        });
        const total = Number(b.totalTickets || game.ticketsPerBox);

        // Persist the user's pack-size correction back to the store-level
        // LotteryGame so future receives of the same game default to the
        // correct size (no need to re-pick every time). Every book of the
        // same game has the same pack size — this is the natural home for
        // the value. We only update if the caller explicitly supplied
        // totalTickets and it disagrees with what the game currently holds.
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

        return prisma.lotteryBox.create({
          data: {
            orgId,
            storeId,
            gameId: game.id,
            boxNumber: (b.boxNumber as string | null) || null,
            totalTickets: total,
            ticketPrice: Number(game.ticketPrice),
            totalValue: Number(game.ticketPrice) * total,
            startTicket: (b.startTicket as string | null) || null,
            status: 'inventory',
          },
        });
      }),
    );
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

    const patch: Prisma.LotteryBoxUpdateInput = {
      ...(slotNumber != null && { slotNumber: Number(slotNumber) }),
      ...(status != null && { status }),
      ...(currentTicket != null && { currentTicket: String(currentTicket) }),
      ...(startTicket != null && { startTicket: String(startTicket) }),
      ...(boxNumber != null && { boxNumber: String(boxNumber) }),
      ...(status === 'depleted' && !box.depletedAt && { depletedAt: new Date() }),
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
    res.json({ success: true, data: updated });
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
    // Activated boxes CANNOT be deleted
    if (box.status !== 'inventory') {
      res.status(400).json({
        success: false,
        error:
          'Only inventory boxes can be deleted. Activated, depleted, or settled boxes cannot be removed.',
      });
      return;
    }
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

// ══════════════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ══════════════════════════════════════════════════════════════════════════

export const getLotteryTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { shiftId, type, limit = 50, offset = 0, from, to } = req.query;
    const where: Prisma.LotteryTransactionWhereInput = {
      orgId,
      storeId,
      ...(shiftId && { shiftId: shiftId as string }),
      ...(type && { type: type as string }),
      ...((from || to) && {
        createdAt: {
          ...(from && { gte: new Date(from as string) }),
          ...(to && { lte: new Date(to as string) }),
        },
      }),
    };
    const [txns, total] = await Promise.all([
      prisma.lotteryTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: Number(offset),
        take: Number(limit),
      }),
      prisma.lotteryTransaction.count({ where }),
    ]);
    res.json({ success: true, data: txns, total });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const createLotteryTransaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const {
      type,
      amount,
      shiftId,
      cashierId,
      stationId,
      gameId,
      boxId,
      ticketCount,
      notes,
      posTransactionId,
    } = req.body;
    if (!type || !amount) {
      res.status(400).json({ success: false, error: 'type and amount are required' });
      return;
    }
    if (!['sale', 'payout'].includes(type)) {
      res.status(400).json({ success: false, error: 'type must be sale or payout' });
      return;
    }

    const txn = await prisma.lotteryTransaction.create({
      data: {
        orgId: orgId as string,
        storeId: storeId as string,
        type,
        amount: Number(amount),
        shiftId: shiftId || null,
        cashierId: cashierId || null,
        stationId: stationId || null,
        gameId: gameId || null,
        boxId: boxId || null,
        ticketCount: ticketCount ? Number(ticketCount) : null,
        notes: notes || null,
        posTransactionId: posTransactionId || null,
      },
    });

    // Update box running totals if a boxId was provided
    if (boxId && type === 'sale') {
      await prisma.lotteryBox.updateMany({
        where: { id: boxId, orgId, storeId },
        data: {
          ticketsSold: { increment: ticketCount ? Number(ticketCount) : 1 },
          salesAmount: { increment: Number(amount) },
        },
      });
    }

    res.json({ success: true, data: txn });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

interface BulkLotteryTransactionInput {
  type: string;
  amount: number | string;
  shiftId?: string | null;
  cashierId?: string | null;
  gameId?: string | null;
  boxId?: string | null;
  ticketCount?: number | string | null;
  notes?: string | null;
}

// Bulk — record multiple sales/payouts in one request (used at shift end scan)
export const bulkCreateLotteryTransactions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { transactions } = req.body;
    if (!Array.isArray(transactions) || !transactions.length) {
      res.status(400).json({ success: false, error: 'transactions array required' });
      return;
    }
    const created = await prisma.lotteryTransaction.createMany({
      data: transactions.map((t: BulkLotteryTransactionInput) => ({
        orgId: orgId as string,
        storeId: storeId as string,
        type: t.type,
        amount: Number(t.amount),
        shiftId: t.shiftId || null,
        cashierId: t.cashierId || null,
        gameId: t.gameId || null,
        boxId: t.boxId || null,
        ticketCount: t.ticketCount ? Number(t.ticketCount) : null,
        notes: t.notes || null,
      })),
    });
    res.json({ success: true, count: created.count });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// SHIFT REPORT
// ══════════════════════════════════════════════════════════════════════════

export const getLotteryShiftReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { shiftId } = req.params;

    const report = await prisma.lotteryShiftReport.findFirst({
      where: { shiftId, orgId, storeId },
    });

    // Compute live totals from transactions
    const txns = (await prisma.lotteryTransaction.findMany({
      where: { shiftId, orgId, storeId },
    })) as LotteryTxnRow[];
    const totalSales = txns
      .filter((t) => t.type === 'sale')
      .reduce((s, t) => s + Number(t.amount), 0);
    const totalPayouts = txns
      .filter((t) => t.type === 'payout')
      .reduce((s, t) => s + Number(t.amount), 0);
    const netAmount = totalSales - totalPayouts;

    if (!report) {
      // Return a computed preview (not yet saved)
      res.json({
        success: true,
        data: { shiftId, orgId, storeId, totalSales, totalPayouts, netAmount, saved: false },
      });
      return;
    }

    const variance =
      report.machineAmount != null || report.digitalAmount != null
        ? (num(report.machineAmount) || 0) + (num(report.digitalAmount) || 0) - netAmount
        : null;

    res.json({
      success: true,
      data: { ...report, totalSales, totalPayouts, netAmount, variance, saved: true },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

interface BoxScanInput {
  boxId?: string | null;
  endTicket?: string | null | 'SO';
  soldout?: boolean;
  gameNumber?: string | null;
  gameName?: string | null;
  slotNumber?: number | null;
  ticketsSold?: number | null;
}

export const saveLotteryShiftReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const {
      shiftId,
      machineAmount,
      digitalAmount,
      scannedTickets,
      scannedAmount,
      boxScans,
      notes,
      closedById,
      // Apr 2026 — cumulative-day readings from the lottery terminal at shift close
      grossSalesReading,
      cancelsReading,
      machineCashingReading,
      couponCashReading,
      discountsReading,
      instantCashingReading,
    } = req.body;
    if (!shiftId) {
      res.status(400).json({ success: false, error: 'shiftId required' });
      return;
    }

    // Compute from transactions
    const txns = (await prisma.lotteryTransaction.findMany({
      where: { shiftId, orgId, storeId },
    })) as LotteryTxnRow[];
    const totalSales = txns
      .filter((t) => t.type === 'sale')
      .reduce((s, t) => s + Number(t.amount), 0);
    const totalPayouts = txns
      .filter((t) => t.type === 'payout')
      .reduce((s, t) => s + Number(t.amount), 0);
    const netAmount = totalSales - totalPayouts;
    const machNum = machineAmount != null ? Number(machineAmount) : null;
    const digNum = digitalAmount != null ? Number(digitalAmount) : null;
    const variance = machNum != null ? machNum + (digNum || 0) - netAmount : null;

    const toDec = (v: unknown): number | null => (v != null && v !== '' ? Number(v) : null);

    const report = await prisma.lotteryShiftReport.upsert({
      where: { shiftId },
      update: {
        machineAmount: machNum,
        digitalAmount: digNum,
        scannedTickets: scannedTickets || undefined,
        scannedAmount: scannedAmount ? Number(scannedAmount) : null,
        boxScans: boxScans || undefined,
        totalSales,
        totalPayouts,
        netAmount,
        variance,
        notes: notes || null,
        closedById: closedById || null,
        closedAt: new Date(),
        // Cumulative-day readings (only update when supplied so EoD wizard
        // can persist them while back-office edits don't clobber them)
        ...(grossSalesReading     !== undefined && { grossSalesReading:     toDec(grossSalesReading) }),
        ...(cancelsReading        !== undefined && { cancelsReading:        toDec(cancelsReading) }),
        ...(machineCashingReading !== undefined && { machineCashingReading: toDec(machineCashingReading) }),
        ...(couponCashReading     !== undefined && { couponCashReading:     toDec(couponCashReading) }),
        ...(discountsReading      !== undefined && { discountsReading:      toDec(discountsReading) }),
        ...(instantCashingReading !== undefined && { instantCashingReading: toDec(instantCashingReading) }),
      },
      create: {
        orgId,
        storeId,
        shiftId,
        machineAmount: machNum,
        digitalAmount: digNum,
        scannedTickets: scannedTickets || undefined,
        scannedAmount: scannedAmount ? Number(scannedAmount) : null,
        boxScans: boxScans || undefined,
        totalSales,
        totalPayouts,
        netAmount,
        variance,
        notes: notes || null,
        closedById: closedById || null,
        closedAt: new Date(),
        grossSalesReading:     toDec(grossSalesReading),
        cancelsReading:        toDec(cancelsReading),
        machineCashingReading: toDec(machineCashingReading),
        couponCashReading:     toDec(couponCashReading),
        discountsReading:      toDec(discountsReading),
        instantCashingReading: toDec(instantCashingReading),
      },
    });

    // Propagate scanned end-tickets to each LotteryBox + emit close_day_snapshot
    // events. Without this, the cashier's EoD scan never reached the box's
    // currentTicket field (so scan engine kept the old position) AND no
    // snapshot existed for the next-day rollover.
    if (Array.isArray(boxScans)) {
      for (const bs of boxScans as BoxScanInput[]) {
        if (!bs?.boxId) continue;
        const isSoldout = !!bs.soldout || bs.endTicket === 'SO';
        const endTicket =
          !isSoldout && bs.endTicket != null && bs.endTicket !== '' ? String(bs.endTicket) : null;

        // Update the box if we have a real end ticket
        if (endTicket != null) {
          await prisma.lotteryBox
            .update({
              where: { id: bs.boxId },
              data: {
                currentTicket: endTicket,
                lastShiftEndTicket: endTicket,
                updatedAt: new Date(),
              },
            })
            .catch((e: unknown) =>
              console.warn('[saveShiftReport] box update failed', bs.boxId, errMsg(e)),
            );
        }

        // Create close_day_snapshot event so the next-day rollover works.
        // (Soldout boxes also get an event so the daily-close report
        // includes them — currentTicket: null indicates no specific ticket.)
        await prisma.lotteryScanEvent
          .create({
            data: {
              orgId,
              storeId,
              boxId: bs.boxId,
              scannedBy: closedById || null,
              raw: `shift_close:${shiftId}`,
              parsed: {
                gameNumber: bs.gameNumber || null,
                gameName: bs.gameName || null,
                slotNumber: bs.slotNumber ?? null,
                currentTicket: endTicket,
                ticketsSold: bs.ticketsSold ?? null,
                soldout: isSoldout,
              } as unknown as Prisma.InputJsonValue,
              action: 'close_day_snapshot',
              context: 'eod',
            },
          })
          .catch((e: unknown) =>
            console.warn('[saveShiftReport] snapshot insert failed', bs.boxId, errMsg(e)),
          );
      }
    }

    res.json({ success: true, data: report });
  } catch (err) {
    console.error('[saveLotteryShiftReport]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════════════════════

export const getLotteryDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;

    // B9 — month-to-date window in store-local timezone (NOT UTC). For a
    // store in EDT, "April MTD" means April 1 00:00 EDT = April 1 04:00 UTC,
    // not April 1 00:00 UTC. Snapshots written at local 22:00 land in the
    // correct local-day bucket only when day boundaries respect tz.
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } });
    const tz = store?.timezone || 'UTC';
    const todayLocalStr = formatLocalDate(new Date(), tz);
    const monthStartLocalStr = `${todayLocalStr.slice(0, 7)}-01`;
    const monthStart = localDayStartUTC(monthStartLocalStr, tz);
    const monthEnd = new Date();

    const [monthTxnsRaw, activeBoxes, inventoryBoxes, real] = await Promise.all([
      // Payouts + posSales come from LotteryTransaction (audit signal only)
      prisma.lotteryTransaction.findMany({
        where: { orgId, storeId, createdAt: { gte: monthStart, lte: monthEnd } },
        select: { type: true, amount: true },
      }),
      prisma.lotteryBox.count({ where: { orgId, storeId, status: 'active' } }),
      prisma.lotteryBox.count({ where: { orgId, storeId, status: 'inventory' } }),
      // Authoritative sales come from ticket-math snapshots (the cashier
      // doesn't have to ring up every ticket — close_day_snapshot deltas are truth)
      _realSalesRange({ orgId, storeId, from: monthStart, to: monthEnd, timezone: tz }),
    ]);
    const monthTxns = monthTxnsRaw as LotteryTxnRow[];

    const totalSales = real.totalSales; // ticket-math truth
    const posSales = monthTxns
      .filter((t) => t.type === 'sale')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const totalPayouts = monthTxns
      .filter((t) => t.type === 'payout')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    // Round all currency math to 2dp so floating-point noise (eg .9500000005)
    // doesn't leak into the response. Compare-then-round: keeps unreported
    // semantics intact while presenting clean values to the UI.
    const unreported = Math.max(0, Math.round((totalSales - posSales) * 100) / 100);
    const netRevenue = Math.round((totalSales - totalPayouts) * 100) / 100;

    const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
    const commissionRate = settings?.commissionRate ? Number(settings.commissionRate) : 0.05;
    const commission = Math.round(totalSales * commissionRate * 100) / 100;

    res.json({
      totalSales,
      posSales: Math.round(posSales * 100) / 100,
      unreported,
      totalPayouts: Math.round(totalPayouts * 100) / 100,
      netRevenue,
      commission,
      activeBoxes,
      inventoryBoxes,
      salesSource: real.source, // 'snapshot' | 'live' | 'pos_fallback' | 'mixed' | 'empty'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const getLotteryReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const { period = 'day', from, to } = req.query;

    // B9 — date-string parsing must respect store timezone. A `from=2026-04-23`
    // query for an EDT store means "starting at local midnight on Apr 23",
    // which is 04:00 UTC the same day — NOT 00:00 UTC. Otherwise close_day_snapshot
    // events written at local 22:00 (= UTC 02:00 next day) land in the wrong bucket
    // and per-day sales drift by one day across the whole window.
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } });
    const tz = store?.timezone || 'UTC';

    const now = new Date();
    const todayLocal = formatLocalDate(now, tz);
    let startDate: Date;
    if (from) {
      startDate = localDayStartUTC(from as string, tz);
    } else if (period === 'week') {
      // 7 days ago in store-local terms
      const seven = new Date(localDayStartUTC(todayLocal, tz).getTime() - 7 * 24 * 3600 * 1000);
      startDate = localDayStartUTC(formatLocalDate(seven, tz), tz);
    } else if (period === 'month') {
      // 30 days ago in store-local terms
      const thirty = new Date(localDayStartUTC(todayLocal, tz).getTime() - 30 * 24 * 3600 * 1000);
      startDate = localDayStartUTC(formatLocalDate(thirty, tz), tz);
    } else {
      startDate = localDayStartUTC(todayLocal, tz);
    }
    const endDate = to ? localDayEndUTC(to as string, tz) : new Date();

    // Ticket-math (authoritative) sales — walks close_day_snapshot deltas day by day
    const real = await _realSalesRange({ orgId, storeId, from: startDate, to: endDate, timezone: tz });
    const totalSales = real.totalSales;

    // POS-side data (audit signal): payouts + ringed-up sales
    const txns = (await prisma.lotteryTransaction.findMany({
      where: { orgId, storeId, createdAt: { gte: startDate, lte: endDate } },
      orderBy: { createdAt: 'asc' },
      select: { type: true, amount: true, gameId: true, createdAt: true },
    })) as LotteryTxnRow[];

    const posSales =
      Math.round(
        txns.filter((t) => t.type === 'sale').reduce((s, t) => s + Number(t.amount || 0), 0) * 100,
      ) / 100;
    const totalPayouts =
      Math.round(
        txns.filter((t) => t.type === 'payout').reduce((s, t) => s + Number(t.amount || 0), 0) *
          100,
      ) / 100;
    const unreported = Math.max(0, Math.round((totalSales - posSales) * 100) / 100);
    const netAmount = Math.round((totalSales - totalPayouts) * 100) / 100;

    // Chart: per-day buckets with FIVE series so the UI can render a
    // multi-line graph with checkbox toggles.
    const dayMap: Record<string, DayBucket> = {};
    real.byDay.forEach((d) => {
      dayMap[d.date] = {
        date: d.date,
        sales: d.sales,
        payouts: 0,
        net: d.sales,
        machineSales: 0,
        machineCashing: 0,
        instantCashing: 0,
      };
    });
    txns
      .filter((t) => t.type === 'payout')
      .forEach((t) => {
        // B9 — bucket payouts by store-local date (not UTC) so they line up
        // with rangeSales' tz-aware day buckets.
        const key = formatLocalDate(t.createdAt, tz);
        if (!dayMap[key])
          dayMap[key] = {
            date: key,
            sales: 0,
            payouts: 0,
            net: 0,
            machineSales: 0,
            machineCashing: 0,
            instantCashing: 0,
          };
        dayMap[key].payouts += Number(t.amount || 0);
        dayMap[key].net = dayMap[key].sales - dayMap[key].payouts;
      });

    // Online totals (machine draws + cashings) — one row per day
    const onlineRows = (await prisma.lotteryOnlineTotal.findMany({
      where: { orgId, storeId, date: { gte: startDate, lte: endDate } },
      select: { date: true, machineSales: true, machineCashing: true, instantCashing: true },
    })) as LotteryOnlineTotalRow[];
    onlineRows.forEach((o) => {
      const key = o.date.toISOString().slice(0, 10);
      if (!dayMap[key])
        dayMap[key] = {
          date: key,
          sales: 0,
          payouts: 0,
          net: 0,
          machineSales: 0,
          machineCashing: 0,
          instantCashing: 0,
        };
      dayMap[key].machineSales = Number(o.machineSales || 0);
      dayMap[key].machineCashing = Number(o.machineCashing || 0);
      dayMap[key].instantCashing = Number(o.instantCashing || 0);
    });

    const chart = Object.values(dayMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date,
        sales: Math.round(d.sales * 100) / 100,
        payouts: Math.round(d.payouts * 100) / 100,
        net: Math.round(d.net * 100) / 100,
        machineSales: Math.round(d.machineSales * 100) / 100,
        machineCashing: Math.round(d.machineCashing * 100) / 100,
        instantCashing: Math.round(d.instantCashing * 100) / 100,
      }));

    // Per-game breakdown — sales from ticket math (real.byGame), payouts from txns
    const gameMap: Record<string, GameBucket> = {};
    for (const [gameId, info] of real.byGame.entries()) {
      gameMap[gameId] = {
        gameId,
        gameName: null,
        sales: info.sales,
        payouts: 0,
        net: info.sales,
        count: info.count,
      };
    }
    txns.forEach((t) => {
      const key = t.gameId || '_unknown';
      if (!gameMap[key])
        gameMap[key] = { gameId: key, gameName: null, sales: 0, payouts: 0, net: 0, count: 0 };
      if (t.type === 'payout') {
        gameMap[key].payouts += Number(t.amount || 0);
        gameMap[key].net = gameMap[key].sales - gameMap[key].payouts;
      }
    });
    const gameIds = Object.keys(gameMap).filter((k) => k !== '_unknown');
    if (gameIds.length) {
      const games = (await prisma.lotteryGame.findMany({
        where: { id: { in: gameIds } },
        select: { id: true, name: true },
      })) as LotteryGameRow[];
      games.forEach((g) => {
        if (gameMap[g.id]) gameMap[g.id].gameName = g.name;
      });
    }
    const byGame = Object.values(gameMap).map((g) => ({ ...g, gameName: g.gameName || 'Other' }));

    res.json({
      totalSales,
      posSales,
      unreported,
      totalPayouts,
      netRevenue: netAmount,
      transactionCount: txns.length,
      byGame,
      chart,
      salesSource: real.source, // 'snapshot' | 'live' | 'pos_fallback' | 'mixed' | 'empty'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const getLotteryCommissionReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const { from, to, period = 'month' } = req.query;

    // B9 — same tz-aware date parsing as getLotteryReport. Without this,
    // commission rates × snapshot sales for non-UTC stores produce numbers
    // that drift by one day every day across the window.
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } });
    const tz = store?.timezone || 'UTC';
    const todayLocal = formatLocalDate(new Date(), tz);

    let startDate: Date;
    if (from) {
      startDate = localDayStartUTC(from as string, tz);
    } else if (period === 'week') {
      const seven = new Date(localDayStartUTC(todayLocal, tz).getTime() - 7 * 24 * 3600 * 1000);
      startDate = localDayStartUTC(formatLocalDate(seven, tz), tz);
    } else if (period === 'day') {
      startDate = localDayStartUTC(todayLocal, tz);
    } else {
      // Default 'month' = MTD (first of current local month)
      const monthStartLocal = `${todayLocal.slice(0, 7)}-01`;
      startDate = localDayStartUTC(monthStartLocal, tz);
    }
    const endDate = to ? localDayEndUTC(to as string, tz) : new Date();

    // Authoritative sales from ticket math — already grouped by gameId
    const real = await _realSalesRange({ orgId, storeId, from: startDate, to: endDate, timezone: tz });

    // Game catalog for naming + ensure inactive games still show with $0 sales
    const games = (await prisma.lotteryGame.findMany({
      where: { orgId, storeId, deleted: false },
      select: { id: true, name: true },
    })) as LotteryGameRow[];

    // Get store commission rate from settings
    const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
    const storeCommissionRate = settings?.commissionRate ? Number(settings.commissionRate) : 0.05;

    interface CommissionAccumulator {
      gameName: string;
      gameId: string;
      sales: number;
    }

    // Merge real sales with the game catalog. A game with no sales in the
    // window still appears with $0 so the UI doesn't have a sparse row count.
    const gameById = new Map<string, CommissionAccumulator>(
      games.map((g) => [g.id, { gameName: g.name, gameId: g.id, sales: 0 }]),
    );
    for (const [gameId, info] of real.byGame.entries()) {
      const existing = gameById.get(gameId) || { gameName: 'Other', gameId, sales: 0 };
      existing.sales += info.sales;
      gameById.set(gameId, existing);
    }

    const commissionRows = [...gameById.values()].map((g) => {
      const earned = g.sales * storeCommissionRate;
      return {
        gameName: g.gameName,
        commissionRate: storeCommissionRate,
        totalSales: g.sales,
        commission: earned,
      };
    });

    const totalCommission = commissionRows.reduce((s, c) => s + c.commission, 0);
    const totalSalesAll = commissionRows.reduce((s, c) => s + c.totalSales, 0);
    const avgRate = totalSalesAll > 0 ? totalCommission / totalSalesAll : 0;
    const byGame = commissionRows.map((c) => ({
      gameName: c.gameName,
      rate: c.commissionRate,
      sales: c.totalSales,
      commission: c.commission,
    }));
    res.json({ totalCommission, totalSales: totalSalesAll, avgRate, byGame });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const getShiftReports = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const reports = await prisma.lotteryShiftReport.findMany({
      where: { orgId, storeId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * GET /api/lottery/previous-shift-readings?excludeShiftId=X
 *
 * Returns the cumulative-day terminal readings recorded by the most recent
 * LotteryShiftReport closed TODAY at this store, EXCLUDING the given shiftId.
 *
 * Used by the cashier-app EoD wizard for Shift 2+ to compute its INCREMENTAL
 * contribution to today's online sales (Apr 2026 — Fix #3). Without this,
 * Shift 2's "Daily Due" would double-count Shift 1's online activity (since
 * the cashier reads cumulative-day totals off the terminal printout).
 *
 * Returns all-zeros if no prior shift report exists today (Shift 1 case).
 */
export const getPreviousShiftReadings = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const excludeShiftId = (req.query?.excludeShiftId as string) || null;

    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const tomorrowUtc = new Date(todayUtc.getTime() + 24 * 3600 * 1000);

    const where: Prisma.LotteryShiftReportWhereInput = {
      orgId,
      storeId,
      closedAt: { gte: todayUtc, lt: tomorrowUtc },
    };
    if (excludeShiftId) where.shiftId = { not: excludeShiftId };

    const prev = await prisma.lotteryShiftReport.findFirst({
      where,
      orderBy: { closedAt: 'desc' },
      select: {
        shiftId: true,
        closedAt: true,
        grossSalesReading: true,
        cancelsReading: true,
        machineCashingReading: true,
        couponCashReading: true,
        discountsReading: true,
        instantCashingReading: true,
      },
    });

    const num = (v: unknown): number => (v != null ? Number(v) : 0);
    res.json({
      success: true,
      hasPrevious: !!prev,
      shiftId: prev?.shiftId ?? null,
      closedAt: prev?.closedAt ?? null,
      readings: {
        grossSales:     num(prev?.grossSalesReading),
        cancels:        num(prev?.cancelsReading),
        machineCashing: num(prev?.machineCashingReading),
        couponCash:     num(prev?.couponCashReading),
        discounts:      num(prev?.discountsReading),
        instantCashing: num(prev?.instantCashingReading),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * GET /api/lottery/shift-audit?date=YYYY-MM-DD
 *
 * Per-day owner audit view. Returns every closed shift on the date in
 * chronological order along with:
 *   - cumulative-day readings off the lottery terminal (snapshotted at
 *     each shift close on LotteryShiftReport)
 *   - per-shift DELTAS computed as `this.reading − previous.reading`
 *     (the lottery terminal shows running daily totals — so cashier 2's
 *     activity = cashier 2's reading − cashier 1's reading)
 *   - full reconcileShift() drawer math per shift (expected vs counted
 *     vs variance, including ticket-math un-rung-cash)
 *   - day-level rollup (last-shift's reading IS the day total for any
 *     cumulative field; per-shift instant scans sum to day total)
 *
 * Powers the back-office Shift Reports drill-down view (Phase D).
 */
export const getShiftAudit = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    if (!orgId || !storeId) {
      res.status(400).json({ success: false, error: 'orgId + storeId required' });
      return;
    }
    const dateStr = (req.query?.date as string | undefined) || new Date().toISOString().slice(0, 10);
    const date = parseDate(dateStr);
    if (!date) {
      res.status(400).json({ success: false, error: 'date required (YYYY-MM-DD)' });
      return;
    }

    // Local-day boundary (matches listShifts pattern)
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

    // 1. Closed shifts opened on this day, chronologically ascending
    interface ShiftLite {
      id: string; cashierId: string; stationId: string | null;
      openedAt: Date; closedAt: Date | null; status: string;
      closingAmount: Prisma.Decimal | null;
    }
    const shifts = (await prisma.shift.findMany({
      where: { orgId, storeId, openedAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { openedAt: 'asc' },
      select: {
        id: true, cashierId: true, stationId: true,
        openedAt: true, closedAt: true, status: true, closingAmount: true,
      },
    })) as ShiftLite[];

    // 2. LotteryShiftReports for those shifts (cumulative readings + box scans)
    const shiftIds = shifts.map((s) => s.id);
    const reports = shiftIds.length
      ? await prisma.lotteryShiftReport.findMany({ where: { shiftId: { in: shiftIds } } })
      : ([] as Awaited<ReturnType<typeof prisma.lotteryShiftReport.findMany>>);
    type LotShiftReport = (typeof reports)[number];
    const reportByShiftId: Record<string, LotShiftReport> = Object.fromEntries(
      reports.map((r: LotShiftReport) => [r.shiftId, r]),
    );

    // 3. Cashier + station name lookups
    const cashierIds = [...new Set(shifts.map((s) => s.cashierId).filter(Boolean))];
    const stationIds = [...new Set(shifts.map((s) => s.stationId).filter((x): x is string => !!x))];
    const [users, stations] = await Promise.all([
      cashierIds.length
        ? prisma.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, name: true } })
        : [],
      stationIds.length
        ? prisma.station.findMany({ where: { id: { in: stationIds } }, select: { id: true, name: true } })
        : [],
    ]);
    interface NameRow { id: string; name: string }
    const userMap: Record<string, string> = Object.fromEntries(
      (users as NameRow[]).map((u) => [u.id, u.name]),
    );
    const stationMap: Record<string, string> = Object.fromEntries(
      (stations as NameRow[]).map((s) => [s.id, s.name]),
    );

    // 4. Per-shift audit row builder
    const r2 = (n: number): number => Math.round(n * 100) / 100;
    const toNum = (v: unknown): number => {
      if (v == null) return 0;
      const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : Number(String(v));
      return Number.isFinite(n) ? n : 0;
    };

    interface Reading {
      grossSales: number; cancels: number; machineCashing: number;
      couponCash: number; discounts: number; instantCashing: number;
    }
    let prev: Reading = {
      grossSales: 0, cancels: 0, machineCashing: 0,
      couponCash: 0, discounts: 0, instantCashing: 0,
    };
    const auditShifts = [] as Array<Record<string, unknown>>;

    for (const s of shifts) {
      const report = reportByShiftId[s.id];
      const readings: Reading = {
        grossSales:     toNum(report?.grossSalesReading),
        cancels:        toNum(report?.cancelsReading),
        machineCashing: toNum(report?.machineCashingReading),
        couponCash:     toNum(report?.couponCashReading),
        discounts:      toNum(report?.discountsReading),
        instantCashing: toNum(report?.instantCashingReading),
      };
      const hasReadings =
        readings.grossSales > 0 || readings.machineCashing > 0 ||
        readings.cancels > 0 || readings.couponCash > 0 ||
        readings.discounts > 0 || readings.instantCashing > 0;

      // Per-shift deltas (this − previous). For the very first shift of the
      // day, prev is all zeros (matches user's "Yes, zero each morning").
      // For shifts where the cashier didn't enter readings, delta is
      // computed from prev = prev (i.e. no movement attributed) — see Q4
      // "missing baseline" handling below.
      const deltas: Reading = {
        grossSales:     hasReadings ? readings.grossSales     - prev.grossSales     : 0,
        cancels:        hasReadings ? readings.cancels        - prev.cancels        : 0,
        machineCashing: hasReadings ? readings.machineCashing - prev.machineCashing : 0,
        couponCash:     hasReadings ? readings.couponCash     - prev.couponCash     : 0,
        discounts:      hasReadings ? readings.discounts      - prev.discounts      : 0,
        instantCashing: hasReadings ? readings.instantCashing - prev.instantCashing : 0,
      };
      const onlineSalesNetShift =
        deltas.grossSales - deltas.cancels - deltas.machineCashing -
        deltas.couponCash - deltas.discounts;

      // Per-shift drawer reconciliation via the unified service.
      // Failures are non-fatal — show an empty reconciliation block instead
      // of failing the whole audit response.
      let reconciliation: Awaited<ReturnType<typeof reconcileShift>> | null = null;
      try {
        reconciliation = await reconcileShift({
          shiftId: s.id,
          closingAmount: s.closingAmount != null ? Number(s.closingAmount) : undefined,
        });
      } catch (e) {
        console.warn('[getShiftAudit] reconcileShift failed for', s.id, errMsg(e));
      }

      // Per-shift instant sales (sum of box scan amounts)
      interface BoxScan { amount?: number | string | null }
      const boxScans = (Array.isArray(report?.boxScans) ? (report?.boxScans as unknown as BoxScan[]) : []) ?? [];
      const instantSalesScan = boxScans.reduce(
        (sum: number, bs) => sum + toNum(bs?.amount),
        0,
      );
      const posRangSales = toNum(report?.totalSales);
      const posRangPayouts = toNum(report?.totalPayouts);

      auditShifts.push({
        shiftId:      s.id,
        cashierId:    s.cashierId,
        cashierName:  userMap[s.cashierId] || 'Unknown',
        stationId:    s.stationId,
        stationName:  s.stationId ? (stationMap[s.stationId] || s.stationId) : 'Unassigned',
        openedAt:     s.openedAt,
        closedAt:     s.closedAt,
        status:       s.status,
        hasReadings,
        readings: {
          grossSales:     r2(readings.grossSales),
          cancels:        r2(readings.cancels),
          machineCashing: r2(readings.machineCashing),
          couponCash:     r2(readings.couponCash),
          discounts:      r2(readings.discounts),
          instantCashing: r2(readings.instantCashing),
        },
        deltas: {
          grossSales:     r2(deltas.grossSales),
          cancels:        r2(deltas.cancels),
          machineCashing: r2(deltas.machineCashing),
          couponCash:     r2(deltas.couponCash),
          discounts:      r2(deltas.discounts),
          instantCashing: r2(deltas.instantCashing),
        },
        onlineSalesNet:    r2(onlineSalesNetShift),
        instantSalesScan:  r2(instantSalesScan),
        posRangSales:      r2(posRangSales),
        posRangPayouts:    r2(posRangPayouts),
        reconciliation,
      });

      // Only roll the prev-readings forward when this shift actually
      // recorded readings — preserves the chain for shifts that skipped
      // entry (their delta becomes 0, next shift's delta picks up from
      // the last-known reading).
      if (hasReadings) prev = readings;
    }

    // 5. Day-level rollup
    const lastWithReadings = [...auditShifts].reverse().find((a) => a.hasReadings);
    const lastReadings = (lastWithReadings?.readings || {
      grossSales: 0, cancels: 0, machineCashing: 0,
      couponCash: 0, discounts: 0, instantCashing: 0,
    }) as Reading;

    const dayInstantSalesTotal = auditShifts.reduce(
      (s: number, a) => s + Number(a.instantSalesScan || 0),
      0,
    );
    const dayOnlineSalesNet =
      lastReadings.grossSales - lastReadings.cancels - lastReadings.machineCashing -
      lastReadings.couponCash - lastReadings.discounts;
    const dailyDue =
      (dayInstantSalesTotal - lastReadings.instantCashing) + dayOnlineSalesNet;

    const expectedDrawerSum = auditShifts.reduce(
      (s: number, a) => s + Number((a.reconciliation as { expectedDrawer?: number } | null)?.expectedDrawer || 0),
      0,
    );
    const countedSum = auditShifts.reduce(
      (s: number, a) => s + Number((a.reconciliation as { closingAmount?: number } | null)?.closingAmount || 0),
      0,
    );
    const varianceSum = auditShifts.reduce(
      (s: number, a) => s + Number((a.reconciliation as { variance?: number } | null)?.variance || 0),
      0,
    );
    const posSalesTotal = auditShifts.reduce(
      (s: number, a) => s + Number(a.posRangSales || 0),
      0,
    );
    const unreportedCashTotal = Math.max(0, dayInstantSalesTotal - posSalesTotal);

    // 6. Lottery settings (variance display preference for the front-end)
    const settings = await prisma.lotterySettings
      .findUnique({ where: { storeId } })
      .catch(() => null);

    res.json({
      date: dateStr,
      shifts: auditShifts,
      day: {
        instantSalesTotal:   r2(dayInstantSalesTotal),
        onlineSalesNet:      r2(dayOnlineSalesNet),
        instantCashingTotal: r2(lastReadings.instantCashing),
        machineCashingTotal: r2(lastReadings.machineCashing),
        grossSalesTotal:     r2(lastReadings.grossSales),
        cancelsTotal:        r2(lastReadings.cancels),
        couponCashTotal:     r2(lastReadings.couponCash),
        discountsTotal:      r2(lastReadings.discounts),
        dailyDue:            r2(dailyDue),
        expectedDrawerSum:   r2(expectedDrawerSum),
        countedSum:          r2(countedSum),
        varianceSum:         r2(varianceSum),
        posSalesTotal:       r2(posSalesTotal),
        unreportedCashTotal: r2(unreportedCashTotal),
      },
      settings: {
        shiftVarianceDisplay:   settings?.shiftVarianceDisplay   || 'always',
        shiftVarianceThreshold: Number(settings?.shiftVarianceThreshold || 0),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// LOTTERY SETTINGS (store-level)
// ══════════════════════════════════════════════════════════════════════════

export const getLotterySettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    let settings = storeId ? await prisma.lotterySettings.findUnique({ where: { storeId } }) : null;
    if (!settings) {
      // Return defaults without creating
      settings = {
        orgId: orgId as string,
        storeId: storeId as string,
        enabled: true,
        cashOnly: false,
        state: null,
        commissionRate: null,
        scanRequiredAtShiftEnd: false,
      } as unknown as Awaited<ReturnType<typeof prisma.lotterySettings.findUnique>>;
    }
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// TICKET CATALOG  (superadmin/admin – platform-wide, state-scoped)
// ══════════════════════════════════════════════════════════════════════════

/** Stores call this — returns only tickets for the store's state */
export const getCatalogTickets = async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = getStore(req);
    const { state, all } = req.query;

    let filterState = state as string | undefined;
    if (!filterState && storeId) {
      const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
      filterState = settings?.state ?? undefined;
    }

    const tickets = await prisma.lotteryTicketCatalog.findMany({
      where: {
        active: true,
        ...(filterState && all !== 'true' ? { state: filterState } : {}),
      },
      orderBy: [{ state: 'asc' }, { ticketPrice: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/** Admin calls this — returns ALL tickets (optionally filtered by state) */
export const getAllCatalogTickets = async (req: Request, res: Response): Promise<void> => {
  try {
    const { state } = req.query;
    const tickets = await prisma.lotteryTicketCatalog.findMany({
      where: { ...(state ? { state: state as string } : {}) },
      orderBy: [{ state: 'asc' }, { ticketPrice: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const createCatalogTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, gameNumber, ticketPrice, ticketsPerBook, state, category } = req.body;
    if (!name || !ticketPrice || !state) {
      res
        .status(400)
        .json({ success: false, error: 'name, ticketPrice, and state are required' });
      return;
    }
    const ticket = await prisma.lotteryTicketCatalog.create({
      data: {
        name,
        gameNumber: gameNumber || null,
        ticketPrice: Number(ticketPrice),
        ticketsPerBook: Number(ticketsPerBook || 300),
        state,
        category: category || null,
        createdBy: req.user?.id || null,
      },
    });
    res.json({ success: true, data: ticket });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateCatalogTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, gameNumber, ticketPrice, ticketsPerBook, state, category, active } = req.body;
    const ticket = await prisma.lotteryTicketCatalog.update({
      where: { id },
      data: {
        ...(name != null && { name }),
        ...(gameNumber != null && { gameNumber }),
        ...(ticketPrice != null && { ticketPrice: Number(ticketPrice) }),
        ...(ticketsPerBook != null && { ticketsPerBook: Number(ticketsPerBook) }),
        ...(state != null && { state }),
        ...(category != null && { category }),
        ...(active != null && { active: Boolean(active) }),
      },
    });
    res.json({ success: true, data: ticket });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deleteCatalogTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.lotteryTicketCatalog.update({ where: { id }, data: { active: false } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// TICKET REQUESTS  (stores submit, admins review)
// ══════════════════════════════════════════════════════════════════════════

export const getTicketRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { status } = req.query;
    const isAdmin = ['superadmin', 'admin'].includes(req.user?.role || '');

    const requests = await prisma.lotteryTicketRequest.findMany({
      where: {
        ...(isAdmin ? { orgId } : { orgId, storeId }),
        ...(status ? { status: status as string } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: requests });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const createTicketRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStore(req);
    const { name, gameNumber, ticketPrice, ticketsPerBook, state, notes, storeName } = req.body;
    if (!name) {
      res.status(400).json({ success: false, error: 'name is required' });
      return;
    }

    const request = await prisma.lotteryTicketRequest.create({
      data: {
        orgId: orgId as string,
        storeId: storeId as string,
        storeName: storeName || null,
        name,
        gameNumber: gameNumber || null,
        ticketPrice: ticketPrice ? Number(ticketPrice) : null,
        ticketsPerBook: ticketsPerBook ? Number(ticketsPerBook) : null,
        state: state || null,
        notes: notes || null,
        status: 'pending',
      },
    });
    res.json({ success: true, data: request });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const reviewTicketRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, adminNotes, addToCatalog, catalogData } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      res.status(400).json({ success: false, error: 'status must be approved or rejected' });
      return;
    }

    let resolvedCatalogId: string | null = null;

    if (status === 'approved' && addToCatalog && catalogData) {
      const cat = await prisma.lotteryTicketCatalog.create({
        data: {
          name: catalogData.name,
          gameNumber: catalogData.gameNumber || null,
          ticketPrice: Number(catalogData.ticketPrice),
          ticketsPerBook: Number(catalogData.ticketsPerBook || 300),
          state: catalogData.state,
          category: catalogData.category || null,
          createdBy: req.user?.id || null,
        },
      });
      resolvedCatalogId = cat.id;
    }

    const updated = await prisma.lotteryTicketRequest.update({
      where: { id },
      data: { status, adminNotes: adminNotes || null, resolvedCatalogId },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const getPendingRequestCount = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const count = await prisma.lotteryTicketRequest.count({
      where: { orgId, status: 'pending' },
    });
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// RECEIVE FROM CATALOG
// Store selects a catalog ticket + enters qty → auto-creates a local
// LotteryGame (if none exists) then creates LotteryBox records.
// ══════════════════════════════════════════════════════════════════════════

export const receiveFromCatalog = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const { catalogTicketId, qty } = req.body;

    if (!catalogTicketId || !qty || Number(qty) < 1) {
      res
        .status(400)
        .json({ success: false, error: 'catalogTicketId and qty (≥1) are required' });
      return;
    }

    // Route through the shared resolver — stores the REAL gameNumber on the
    // store-level LotteryGame (fixes the legacy "catalog:xxx" synthetic-ref
    // bug that prevented scan-driven receive from matching the catalog).
    // If a legacy row already exists with the synthetic ref, the resolver
    // returns that existing row unchanged so we don't create a duplicate.
    const game = await resolveOrCreateStoreGame({ orgId, storeId, catalogTicketId });

    const boxes = await Promise.all(
      Array.from({ length: Number(qty) }, () =>
        prisma.lotteryBox.create({
          data: {
            orgId,
            storeId,
            gameId: game.id,
            totalTickets: game.ticketsPerBox,
            ticketPrice: Number(game.ticketPrice),
            totalValue: Number(game.ticketPrice) * game.ticketsPerBox,
            status: 'inventory',
          },
        }),
      ),
    );

    res.json({ success: true, data: boxes, game, count: boxes.length });
  } catch (err) {
    console.error('[lottery.receiveFromCatalog]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateLotterySettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const {
      enabled,
      cashOnly,
      state,
      commissionRate,
      scanRequiredAtShiftEnd,
      sellDirection,
      allowMultipleActivePerGame,
      weekStartDay,
      settlementPctThreshold,
      settlementMaxDaysActive,
      // Apr 2026 — per-shift variance display preference
      shiftVarianceDisplay,
      shiftVarianceThreshold,
    } = req.body;

    const normalizedDirection =
      sellDirection === 'asc' || sellDirection === 'desc' ? sellDirection : undefined;

    const ALLOWED_VARIANCE_DISPLAY = new Set(['always', 'threshold', 'hidden']);
    const normalizedVarianceDisplay =
      typeof shiftVarianceDisplay === 'string' && ALLOWED_VARIANCE_DISPLAY.has(shiftVarianceDisplay)
        ? shiftVarianceDisplay
        : undefined;

    const settings = await prisma.lotterySettings.upsert({
      where: { storeId },
      update: {
        ...(enabled != null && { enabled: Boolean(enabled) }),
        ...(cashOnly != null && { cashOnly: Boolean(cashOnly) }),
        ...(state != null && { state }),
        ...(commissionRate != null && { commissionRate: Number(commissionRate) }),
        ...(scanRequiredAtShiftEnd != null && {
          scanRequiredAtShiftEnd: Boolean(scanRequiredAtShiftEnd),
        }),
        ...(normalizedDirection && { sellDirection: normalizedDirection }),
        ...(allowMultipleActivePerGame != null && {
          allowMultipleActivePerGame: Boolean(allowMultipleActivePerGame),
        }),
        ...(weekStartDay != null && { weekStartDay: Number(weekStartDay) }),
        ...(settlementPctThreshold != null && {
          settlementPctThreshold: Number(settlementPctThreshold),
        }),
        ...(settlementMaxDaysActive != null && {
          settlementMaxDaysActive: Number(settlementMaxDaysActive),
        }),
        ...(normalizedVarianceDisplay && { shiftVarianceDisplay: normalizedVarianceDisplay }),
        ...(shiftVarianceThreshold != null && {
          shiftVarianceThreshold: Number(shiftVarianceThreshold),
        }),
      },
      create: {
        orgId,
        storeId,
        enabled: enabled != null ? Boolean(enabled) : true,
        cashOnly: cashOnly != null ? Boolean(cashOnly) : false,
        state: state || null,
        commissionRate: commissionRate != null ? Number(commissionRate) : null,
        scanRequiredAtShiftEnd:
          scanRequiredAtShiftEnd != null ? Boolean(scanRequiredAtShiftEnd) : false,
        sellDirection: normalizedDirection || 'desc',
        allowMultipleActivePerGame:
          allowMultipleActivePerGame != null ? Boolean(allowMultipleActivePerGame) : false,
        weekStartDay: weekStartDay != null ? Number(weekStartDay) : null,
        settlementPctThreshold:
          settlementPctThreshold != null ? Number(settlementPctThreshold) : null,
        settlementMaxDaysActive:
          settlementMaxDaysActive != null ? Number(settlementMaxDaysActive) : null,
        shiftVarianceDisplay: normalizedVarianceDisplay || 'always',
        shiftVarianceThreshold:
          shiftVarianceThreshold != null ? Number(shiftVarianceThreshold) : 0,
      },
    });
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ══════════════════════════════════════════════════════════════════════════
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

    // Resolve the soldout date. parseDate returns UTC-midnight; we shift
    // to end-of-day so:
    //   - depletedAt sorts last on the day
    //   - the close_day_snapshot event we write below is the LATEST event
    //     for that day → snapshotSales picks our new "fully sold" position
    //     over any prior same-day snapshot.
    const dateParsed = dateStr ? parseDate(dateStr) : new Date();
    if (!dateParsed) {
      res.status(400).json({ success: false, error: 'Invalid date (expected YYYY-MM-DD)' });
      return;
    }
    const soldoutAt = new Date(dateParsed);
    soldoutAt.setUTCHours(23, 59, 59, 0);

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
    if (box.status !== 'depleted') {
      res
        .status(400)
        .json({ success: false, error: `Cannot restore to counter from status ${box.status} — only depleted books can be restored` });
      return;
    }

    // Find the prior close_day_snapshot for this box (the one BEFORE the
    // soldout's snapshot). The soldout's createdAt is `box.depletedAt`,
    // so we look for the latest snapshot with createdAt < depletedAt.
    const cutoff = box.depletedAt || new Date();
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
        autoSoldoutReason: null,
        currentTicket: restoredTicket,
        ticketsSold,
        salesAmount,
        updatedAt: new Date(),
      },
      include: { game: true },
    });

    // Write a correction close_day_snapshot for the soldout day. createdAt
    // is `box.depletedAt + 1 ms` so it sorts AFTER the original soldout
    // event — snapshotSales picks this one as the "latest event of the day"
    // and reverts that day's inflated sale back to reality.
    const correctionAt = new Date((box.depletedAt || new Date()).getTime() + 1);
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

    const data: Prisma.LotteryBoxUpdateInput = {
      status: 'returned',
      returnedAt: new Date(),
      slotNumber: null,
      autoSoldoutReason: reason || (returnType ? `Return (${returnType})` : null),
      updatedAt: new Date(),
    };

    // Accept ticketsSold for partial returns. Clamp to [0, totalTickets].
    if (ticketsSold != null) {
      const n = Number(ticketsSold);
      if (!Number.isFinite(n) || n < 0) {
        res
          .status(400)
          .json({ success: false, error: 'ticketsSold must be a non-negative number' });
        return;
      }
      const total = Number(box.totalTickets || 0);
      data.ticketsSold = total > 0 ? Math.min(n, total) : Math.floor(n);
    }

    const updated = await prisma.lotteryBox.update({
      where: { id: boxId },
      data,
      include: { game: true },
    });
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

// ══════════════════════════════════════════════════════════════════════════
// DAILY ONLINE TOTALS + DAILY SCAN / CLOSE THE DAY (Phase 1b)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Parse a YYYY-MM-DD query param into a local-midnight Date (DB Date column
 * stores the calendar day without TZ). Same pattern used by
 * employeeReportsController + posTerminalController.listTransactions.
 */
function parseDate(str: unknown): Date | null {
  if (!str) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const d = new Date(String(str) + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

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
// Ticket-math helpers — moved to `src/services/lottery/reporting/`.
// The two thin local aliases below preserve the underscore-prefixed names
// the rest of this file already uses. New code should import directly:
//   import { bestEffortDailySales, rangeSales, windowSales }
//     from '../services/lottery/reporting/index.js';
// ─────────────────────────────────────────────────────────────────────────
const _bestEffortDailySales = bestEffortDailySales;
const _realSalesRange = rangeSales;


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
    const date = parseDate(req.query.date);
    if (!date) {
      res.status(400).json({ success: false, error: 'Invalid date' });
      return;
    }

    const dayStart = new Date(date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setUTCHours(23, 59, 59, 999);

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
    const todayMidnight = new Date();
    todayMidnight.setUTCHours(0, 0, 0, 0);
    const isToday = dayStart.getTime() === todayMidnight.getTime();
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
 * POST /api/lottery/close-day
 * Body: { date?: 'YYYY-MM-DD' }
 *
 * Finalises the lottery day:
 *   1. Runs the pending-move sweep (any books scheduled for move-to-safe
 *      with effectiveDate <= today get flipped now).
 *   2. Snapshots the active-book counter positions (audit trail).
 *   3. Returns a summary the UI can print / display.
 *
 * Idempotent — calling twice on the same date is safe (sweep returns 0
 * executed on second call).
 */
export const closeLotteryDay = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const userId = req.user?.id || null;
    const dateStr = req.body?.date || new Date().toISOString().slice(0, 10);
    const date = parseDate(dateStr);
    if (!date) {
      res.status(400).json({ success: false, error: 'Invalid date' });
      return;
    }

    // 1. Execute pending moves
    const sweep = await _runPendingMoveSweep({ storeId, asOfDate: new Date() });

    // 2. Snapshot active counter — one LotteryScanEvent per active book so
    //    there's an immutable "end of day position" record.
    type ActiveBox = {
      id: string;
      boxNumber: string | null;
      slotNumber: number | null;
      currentTicket: string | null;
      startTicket: string | null;
      ticketsSold: number | null;
      totalTickets: number | null;
      game: {
        id: string;
        name: string;
        gameNumber: string | null;
        ticketPrice: number | string;
      } | null;
    };
    const active = (await prisma.lotteryBox.findMany({
      where: { orgId, storeId, status: 'active' },
      select: {
        id: true,
        boxNumber: true,
        slotNumber: true,
        currentTicket: true,
        startTicket: true,
        ticketsSold: true,
        totalTickets: true,
        game: { select: { id: true, name: true, gameNumber: true, ticketPrice: true } },
      },
    })) as ActiveBox[];

    await Promise.all(
      active.map((b) =>
        prisma.lotteryScanEvent
          .create({
            data: {
              orgId,
              storeId,
              boxId: b.id,
              scannedBy: userId,
              raw: `close_day:${dateStr}`,
              parsed: {
                gameNumber: b.game?.gameNumber ?? null,
                gameName: b.game?.name ?? null,
                slotNumber: b.slotNumber,
                currentTicket: b.currentTicket,
                ticketsSold: b.ticketsSold,
              } as unknown as Prisma.InputJsonValue,
              action: 'close_day_snapshot',
              context: 'eod',
            },
          })
          .catch(() => null),
      ),
    );

    // 3. Today's inventory snapshot (same math as daily-inventory endpoint)
    res.json({
      success: true,
      date: dateStr,
      pendingMoveSweep: sweep,
      snapshotCount: active.length,
    });
  } catch (err) {
    console.error('[lottery.close-day]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

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
    const date = parseDate(req.query.date);
    if (!date) {
      res.status(400).json({ success: false, error: 'Invalid date' });
      return;
    }

    const dayStart = new Date(date);
    dayStart.setUTCHours(0, 0, 0, 0);

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
    const date = parseDate(req.query.date);
    if (!date) {
      res.status(400).json({ success: false, error: 'Invalid date' });
      return;
    }

    const dayStart = new Date(date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setUTCHours(23, 59, 59, 999);
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const isToday = dayStart.getTime() === todayUtc.getTime();

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
      // Display value for "yesterday" — prior close if we have one,
      // else the book's startTicket (first-day books had no prior close).
      const openingTicket = yesterdayClose ?? b.startTicket ?? null;
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

    const dayStart = new Date(date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setUTCHours(23, 59, 59, 999);

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
// WEEKLY SETTLEMENT (Phase 2)
// ══════════════════════════════════════════════════════════════════════════

interface SettlementParams {
  stateCode: string | null;
  weekStartDay: number;
  commissionRate: number;
}

/**
 * Resolve the settlement parameters for the active store.
 * Precedence for weekStartDay / settlement rules:
 *   1. LotterySettings override fields (manager set these to override state)
 *   2. State adapter defaults
 *   3. Sunday start / null rules
 */
async function _settlementParams(_orgId: string, storeId: string): Promise<SettlementParams> {
  const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
  const adapter = _getAdapter(settings?.state ?? null);
  const weekStartDay = settings?.weekStartDay ?? adapter?.weekStartDay ?? 0;
  return {
    stateCode: settings?.state || null,
    weekStartDay,
    commissionRate: Number(settings?.commissionRate || 0),
  };
}

/**
 * GET /api/lottery/settlements?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Lists settlement rows in the date window. Rows that don't yet exist in
 * the DB are computed on the fly and returned as 'draft' (not persisted).
 */
export const listLotterySettlements = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const { stateCode, weekStartDay, commissionRate } = await _settlementParams(orgId, storeId);

    const toDate = req.query.to ? new Date((req.query.to as string) + 'T23:59:59Z') : new Date();
    const fromDate = req.query.from
      ? new Date((req.query.from as string) + 'T00:00:00Z')
      : (() => {
          const d = new Date(toDate);
          d.setUTCMonth(d.getUTCMonth() - 3);
          return d;
        })();

    // Build ordered list of week ranges in the window
    interface WeekEntry {
      start: Date;
      end: Date;
      due: Date;
    }
    const weeks: WeekEntry[] = [];
    const { start: firstStart } = _weekRangeFor(toDate, weekStartDay);
    let cursor = new Date(firstStart);
    while (cursor >= fromDate) {
      const { start, end, due } = _weekRangeFor(cursor, weekStartDay);
      weeks.push({ start, end, due });
      cursor = new Date(start);
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    // Fetch any persisted rows for the window
    type SettlementRow = {
      id: string;
      weekStart: Date;
      [k: string]: unknown;
    };
    const persisted = (await prisma.lotteryWeeklySettlement.findMany({
      where: {
        orgId,
        storeId,
        weekStart: { in: weeks.map((w) => w.start) },
      },
    })) as SettlementRow[];
    const byStart = new Map<string, SettlementRow>(
      persisted.map((r) => [r.weekStart.toISOString().slice(0, 10), r]),
    );

    // Merge — persisted rows win, otherwise compute lightweight preview
    const results = await Promise.all(
      weeks.map(async (w) => {
        const key = w.start.toISOString().slice(0, 10);
        const existing = byStart.get(key);
        if (existing) return existing;
        // Lightweight preview — just totals, no book-ids arrays
        const snapshot = await _computeSettlement({
          orgId,
          storeId,
          weekStart: w.start,
          weekEnd: w.end,
          stateCode: stateCode as Parameters<typeof _computeSettlement>[0]['stateCode'],
          commissionRate,
        }).catch(() => null);
        return {
          id: null,
          orgId,
          storeId,
          weekStart: w.start,
          weekEnd: w.end,
          dueDate: w.due,
          ...snapshot,
          bonus: 0,
          serviceCharge: 0,
          adjustments: 0,
          notes: null,
          status: 'draft',
          computedAt: new Date(),
          persisted: false,
        };
      }),
    );

    res.json({
      success: true,
      data: results,
      from: fromDate,
      to: toDate,
      weekStartDay,
      stateCode,
    });
  } catch (err) {
    console.error('[lottery.settlements.list]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * GET /api/lottery/settlements/:weekStart
 * weekStart is YYYY-MM-DD. Computes + returns (but does not persist) a fresh
 * snapshot merged with any saved adjustments.
 */
export const getLotterySettlement = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const { stateCode, weekStartDay, commissionRate } = await _settlementParams(orgId, storeId);
    const { weekStart: raw } = req.params;
    const ws = new Date(raw + 'T00:00:00Z');
    if (Number.isNaN(ws.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid weekStart' });
      return;
    }

    // Snap to actual week boundaries in case caller passed a mid-week date
    const { start, end, due } = _weekRangeFor(ws, weekStartDay);

    const existing = await prisma.lotteryWeeklySettlement.findUnique({
      where: { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
    });

    const snapshot = await _computeSettlement({
      orgId,
      storeId,
      weekStart: start,
      weekEnd: end,
      stateCode: stateCode as Parameters<typeof _computeSettlement>[0]['stateCode'],
      commissionRate,
    });

    // If finalized/paid, return as-is (don't re-compute over the frozen numbers)
    if (existing && existing.status !== 'draft') {
      res.json({ success: true, data: existing, snapshot });
      return;
    }

    // Merge persisted adjustments onto the fresh snapshot.
    const bonus = Number(existing?.bonus || 0);
    const serviceCharge = Number(existing?.serviceCharge || 0);
    const adjustments = Number(existing?.adjustments || 0);

    const weeklyNet =
      snapshot.grossBeforeCommission - snapshot.returnsDeduction - snapshot.totalCommission;
    const weeklyPayable = weeklyNet - bonus + serviceCharge - adjustments;

    const merged = {
      id: existing?.id || null,
      orgId,
      storeId,
      weekStart: start,
      weekEnd: end,
      dueDate: due,
      ...snapshot,
      bonus,
      serviceCharge,
      adjustments,
      notes: existing?.notes || null,
      status: existing?.status || 'draft',
      persisted: !!existing,

      // Explicit totals — frontend displays both with/without commission
      weeklyGross: Math.round(snapshot.grossBeforeCommission * 100) / 100,
      weeklyNet: Math.round(weeklyNet * 100) / 100,
      weeklyPayable: Math.round(weeklyPayable * 100) / 100,
      totalDue: Math.round(weeklyPayable * 100) / 100, // canonical
    };

    res.json({ success: true, data: merged });
  } catch (err) {
    console.error('[lottery.settlements.get]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * PUT /api/lottery/settlements/:weekStart
 * Body: { bonus?, serviceCharge?, adjustments?, notes?, saveComputedSnapshot? }
 *
 * Upserts the adjustments. If `saveComputedSnapshot` is true, also saves
 * the freshly-computed sales/commission numbers (locks them in).
 */
export const upsertLotterySettlement = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const { stateCode, weekStartDay, commissionRate } = await _settlementParams(orgId, storeId);
    const { weekStart: raw } = req.params;
    const ws = new Date(raw + 'T00:00:00Z');
    if (Number.isNaN(ws.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid weekStart' });
      return;
    }
    const { start, end, due } = _weekRangeFor(ws, weekStartDay);

    const existing = await prisma.lotteryWeeklySettlement.findUnique({
      where: { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
    });
    if (existing && existing.status !== 'draft') {
      res
        .status(409)
        .json({ success: false, error: `Cannot edit a ${existing.status} settlement` });
      return;
    }

    const { bonus, serviceCharge, adjustments, notes, saveComputedSnapshot } = req.body || {};

    const snap = saveComputedSnapshot
      ? await _computeSettlement({
          orgId,
          storeId,
          weekStart: start,
          weekEnd: end,
          stateCode: stateCode as Parameters<typeof _computeSettlement>[0]['stateCode'],
          commissionRate,
        })
      : null;

    // Cast to permissive shape because computed snapshot has more fields
    // than the persisted row, and we accept both via the same code path.
    const totalSnapshot = (snap || {
      onlineGross: Number(existing?.onlineGross || 0),
      onlineCashings: Number(existing?.onlineCashings || 0),
      onlineCommission: Number(existing?.onlineCommission || 0),
      instantSales: Number(existing?.instantSales || 0),
      instantSalesComm: Number(existing?.instantSalesComm || 0),
      instantCashingComm: Number(existing?.instantCashingComm || 0),
      returnsDeduction: Number(existing?.returnsDeduction || 0),
      settledBookIds: existing?.settledBookIds || [],
      returnedBookIds: existing?.returnedBookIds || [],
      unsettledBookIds: existing?.unsettledBookIds || [],
    }) as Record<string, unknown>;

    const b = bonus != null ? Number(bonus) : Number(existing?.bonus || 0);
    const s = serviceCharge != null ? Number(serviceCharge) : Number(existing?.serviceCharge || 0);
    const a = adjustments != null ? Number(adjustments) : Number(existing?.adjustments || 0);

    // Match the unified formula — user spec:
    //   Weekly Payable = Σ daily − bonus + service − adjustments − returns − commissions
    const snapGross =
      Number(totalSnapshot.instantSales || 0) -
      Number(totalSnapshot.instantPayouts || totalSnapshot.instantCashingComm || 0) +
      (Number(totalSnapshot.onlineGross || 0) - Number(totalSnapshot.onlineCashings || 0));
    const snapCommission =
      Number(totalSnapshot.instantSalesComm || 0) +
      Number(totalSnapshot.instantCashingComm || 0) +
      Number(totalSnapshot.machineSalesComm || 0) +
      Number(totalSnapshot.machineCashingComm || 0);
    const snapReturns = Number(totalSnapshot.returnsDeduction || 0);

    const totalDue =
      Math.round((snapGross - snapReturns - snapCommission - b + s - a) * 100) / 100;

    const data = {
      orgId,
      storeId,
      weekStart: start,
      weekEnd: end,
      dueDate: due,
      onlineGross: totalSnapshot.onlineGross as number,
      onlineCashings: totalSnapshot.onlineCashings as number,
      onlineCommission: totalSnapshot.onlineCommission as number,
      instantSales: totalSnapshot.instantSales as number,
      instantSalesComm: totalSnapshot.instantSalesComm as number,
      instantCashingComm: totalSnapshot.instantCashingComm as number,
      returnsDeduction: totalSnapshot.returnsDeduction as number,
      settledBookIds: (totalSnapshot.settledBookIds as string[]) || [],
      returnedBookIds: (totalSnapshot.returnedBookIds as string[]) || [],
      unsettledBookIds: (totalSnapshot.unsettledBookIds as string[]) || [],
      bonus: b,
      serviceCharge: s,
      adjustments: a,
      notes: notes != null ? notes : existing?.notes || null,
      totalDue,
      computedAt: snap ? new Date() : existing?.computedAt || null,
    };

    const row = await prisma.lotteryWeeklySettlement.upsert({
      where: { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
      update: data,
      create: { ...data, status: 'draft' },
    });

    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[lottery.settlements.upsert]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * POST /api/lottery/settlements/:weekStart/finalize
 * Body: { paidRef? }
 *
 * Locks the row (status='finalized'). Also flips every book in
 * settledBookIds from their current status to 'settled' so they don't
 * re-appear in next week's candidate list.
 */
export const finalizeLotterySettlement = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const userId = req.user?.id || null;
    const { weekStartDay } = await _settlementParams(orgId, storeId);
    const { weekStart: raw } = req.params;
    const ws = new Date(raw + 'T00:00:00Z');
    if (Number.isNaN(ws.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid weekStart' });
      return;
    }
    const { start } = _weekRangeFor(ws, weekStartDay);

    const existing = await prisma.lotteryWeeklySettlement.findUnique({
      where: { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Save the settlement first' });
      return;
    }
    if (existing.status !== 'draft') {
      res
        .status(409)
        .json({ success: false, error: `Settlement already ${existing.status}` });
      return;
    }

    const ids = Array.isArray(existing.settledBookIds) ? (existing.settledBookIds as string[]) : [];
    const [row] = await prisma.$transaction([
      prisma.lotteryWeeklySettlement.update({
        where: { id: existing.id },
        data: { status: 'finalized', finalizedAt: new Date(), finalizedById: userId },
      }),
      ...(ids.length > 0
        ? [
            prisma.lotteryBox.updateMany({
              where: { id: { in: ids }, orgId, storeId, status: { in: ['active', 'depleted'] } },
              data: { status: 'settled' },
            }),
          ]
        : []),
    ]);

    res.json({ success: true, data: row, settledBooksUpdated: ids.length });
  } catch (err) {
    console.error('[lottery.settlements.finalize]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/**
 * POST /api/lottery/settlements/:weekStart/mark-paid
 * Body: { paidRef? }
 */
export const markLotterySettlementPaid = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStore(req) as string;
    const { weekStartDay } = await _settlementParams(orgId, storeId);
    const { weekStart: raw } = req.params;
    const ws = new Date(raw + 'T00:00:00Z');
    if (Number.isNaN(ws.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid weekStart' });
      return;
    }
    const { start } = _weekRangeFor(ws, weekStartDay);

    const existing = await prisma.lotteryWeeklySettlement.findUnique({
      where: { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Settlement not found' });
      return;
    }
    if (existing.status === 'paid') {
      res.json({ success: true, data: existing, alreadyPaid: true });
      return;
    }
    if (existing.status !== 'finalized') {
      res
        .status(409)
        .json({ success: false, error: 'Finalize the settlement before marking paid' });
      return;
    }

    const row = await prisma.lotteryWeeklySettlement.update({
      where: { id: existing.id },
      data: { status: 'paid', paidAt: new Date(), paidRef: req.body?.paidRef || null },
    });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[lottery.settlements.mark-paid]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// CATALOG SYNC (Phase 3b) — pull state-lottery game lists from their
// public feeds and upsert into LotteryTicketCatalog.
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/lottery/catalog/sync
 * Body: { state?: 'MA' | 'all' }
 *
 * Only MA is supported today; adding ME will extend this endpoint
 * without a route change. Returns a per-state diff summary.
 */
export const syncLotteryCatalog = async (req: Request, res: Response): Promise<void> => {
  try {
    const state = String(req.body?.state || 'all').toUpperCase();
    if (state === 'ALL') {
      const results = await _syncAllSupported();
      res.json({ success: true, results });
      return;
    }

    interface UnsupportedStateError extends Error {
      code?: string;
    }
    const diff = await _syncState(state).catch((err: UnsupportedStateError) => {
      if (err.code === 'UNSUPPORTED_STATE') return { state, error: err.message, unsupported: true };
      throw err;
    });
    res.json({ success: true, result: diff });
  } catch (err) {
    console.error('[lottery.catalog.sync]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

