/**
 * lotteryController.js
 *
 * Handles all lottery module operations:
 *   Games    → ticket types, prices, commission rates
 *   Boxes    → physical packs: inventory → active → depleted
 *   Transactions → per-shift sale / payout recording
 *   ShiftReport  → end-of-shift reconciliation
 *   Reports  → daily / weekly / monthly summary + commission
 */

import prisma from '../config/postgres.js';
import {
  parseScan as _parseScan,
  processScan as _processScan,
  runPendingMoveSweep as _runPendingMoveSweep,
  weekRangeFor as _weekRangeFor,
  recentWeeks as _recentWeeks,
  computeSettlement as _computeSettlement,
  getAdapter as _getAdapter,
  syncState as _syncState,
  syncAllSupported as _syncAllSupported,
} from '../services/lottery/index.js';

const getOrgId  = (req) => req.orgId  || req.user?.orgId;
const getStore  = (req) => req.headers['x-store-id'] || req.storeId || req.query.storeId;

// ── helpers ────────────────────────────────────────────────────────────────
const num = (v) => v != null ? Number(v) : null;

// ══════════════════════════════════════════════════════════════════════════
// GAMES
// ══════════════════════════════════════════════════════════════════════════

export const getLotteryGames = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    // Get store's state from LotterySettings (if set)
    const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
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
          where:  { status: { in: ['inventory', 'active'] } },
          select: { id: true, status: true, ticketsSold: true, totalTickets: true },
        },
      },
      orderBy: { ticketPrice: 'asc' },
    });
    res.json({ success: true, data: games });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createLotteryGame = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { name, gameNumber, ticketPrice, ticketsPerBox, state, isGlobal } = req.body;
    if (!name || !ticketPrice) return res.status(400).json({ success: false, error: 'name and ticketPrice are required' });
    const game = await prisma.lotteryGame.create({
      data: {
        orgId, storeId,
        name, gameNumber,
        ticketPrice:  Number(ticketPrice),
        ticketsPerBox: Number(ticketsPerBox || 300),
        state:    state    || null,
        isGlobal: isGlobal ? true : false,
      },
    });
    res.json({ success: true, data: game });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateLotteryGame = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    const game = await prisma.lotteryGame.findFirst({ where: { id, orgId } });
    if (!game) return res.status(404).json({ success: false, error: 'Game not found' });
    const { name, gameNumber, ticketPrice, ticketsPerBox, active, state, isGlobal } = req.body;
    const updated = await prisma.lotteryGame.update({
      where: { id },
      data: {
        ...(name          != null && { name }),
        ...(gameNumber    != null && { gameNumber }),
        ...(ticketPrice   != null && { ticketPrice:   Number(ticketPrice) }),
        ...(ticketsPerBox != null && { ticketsPerBox: Number(ticketsPerBox) }),
        ...(active        != null && { active:        Boolean(active) }),
        ...(state         != null && { state }),
        ...(isGlobal      != null && { isGlobal:      Boolean(isGlobal) }),
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteLotteryGame = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    await prisma.lotteryGame.updateMany({ where: { id, orgId, storeId }, data: { deleted: true, active: false } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// BOXES
// ══════════════════════════════════════════════════════════════════════════

export const getLotteryBoxes = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { status, gameId } = req.query;
    const boxes = await prisma.lotteryBox.findMany({
      where: {
        orgId, storeId,
        ...(status && { status }),
        ...(gameId && { gameId }),
      },
      include: { game: { select: { id: true, name: true, ticketPrice: true } } },
      orderBy: [{ status: 'asc' }, { slotNumber: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ success: true, data: boxes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

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
async function resolveOrCreateStoreGame({ orgId, storeId, gameId, catalogTicketId, state, gameNumber }) {
  // 1. Direct gameId
  if (gameId) {
    const g = await prisma.lotteryGame.findFirst({ where: { id: gameId, orgId, storeId, deleted: false } });
    if (g) return g;
  }

  // 2. Real gameNumber match at this store (scan-driven receive will hit this
  //    after the store has the game in its own list from a prior receive)
  if (gameNumber) {
    const g = await prisma.lotteryGame.findFirst({
      where: {
        orgId, storeId,
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
      orgId, storeId,
      gameNumber: cat.gameNumber,
      state:      cat.state,
      deleted:    false,
    },
  });
  if (existing) return existing;

  return prisma.lotteryGame.create({
    data: {
      orgId, storeId,
      name:          cat.name,
      gameNumber:    cat.gameNumber,
      ticketPrice:   Number(cat.ticketPrice),
      ticketsPerBox: cat.ticketsPerBook,
      state:         cat.state,
      isGlobal:      false,
      active:        true,
    },
  });
}

export const receiveBoxOrder = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    // Support multiple request shapes:
    //   1. { boxes: [{ gameId, boxNumber, ... }, ...] }        — bulk by gameId
    //   2. { boxes: [{ catalogTicketId, boxNumber, ... }, ...] } — bulk by catalog
    //   3. { boxes: [{ state, gameNumber, boxNumber, ... }] } — scan-driven bulk
    //   4. { gameId, quantity, startTicket, boxNumber }       — legacy portal form
    let items = req.body.boxes;
    if (!items) {
      const { gameId, quantity = 1, startTicket, boxNumber } = req.body;
      if (!gameId) return res.status(400).json({ success: false, error: 'gameId is required' });
      items = Array.from({ length: Number(quantity) }, () => ({ gameId, startTicket, boxNumber: boxNumber || null }));
    }
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ success: false, error: 'No boxes to receive' });

    const created = await Promise.all(items.map(async (b) => {
      let game = await resolveOrCreateStoreGame({
        orgId, storeId,
        gameId:          b.gameId,
        catalogTicketId: b.catalogTicketId,
        state:           b.state,
        gameNumber:      b.gameNumber,
      });
      const total = Number(b.totalTickets || game.ticketsPerBox);

      // Persist the user's pack-size correction back to the store-level
      // LotteryGame so future receives of the same game default to the
      // correct size (no need to re-pick every time). Every book of the
      // same game has the same pack size — this is the natural home for
      // the value. We only update if the caller explicitly supplied
      // totalTickets and it disagrees with what the game currently holds.
      if (b.totalTickets != null && Number.isFinite(total) && total > 0 && total !== game.ticketsPerBox) {
        game = await prisma.lotteryGame.update({
          where: { id: game.id },
          data:  { ticketsPerBox: total },
        });
      }

      return prisma.lotteryBox.create({
        data: {
          orgId, storeId,
          gameId:       game.id,
          boxNumber:    b.boxNumber   || null,
          totalTickets: total,
          ticketPrice:  Number(game.ticketPrice),
          totalValue:   Number(game.ticketPrice) * total,
          startTicket:  b.startTicket || null,
          status:       'inventory',
        },
      });
    }));
    res.json({ success: true, data: created, count: created.length });
  } catch (err) {
    console.error('[lottery.receiveBoxOrder]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const activateBox = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    const { slotNumber, date, currentTicket } = req.body || {};

    const box = await prisma.lotteryBox.findFirst({ where: { id, orgId, storeId } });
    if (!box) return res.status(404).json({ success: false, error: 'Box not found' });
    if (['depleted', 'returned', 'settled'].includes(box.status)) {
      return res.status(400).json({ success: false, error: `Cannot activate a ${box.status} book` });
    }

    // Auto-pick the next free slot if the caller didn't supply one.
    let slot = slotNumber != null ? Number(slotNumber) : null;
    if (slot == null) {
      const active = await prisma.lotteryBox.findMany({
        where: { orgId, storeId, status: 'active', slotNumber: { not: null }, NOT: { id } },
        select: { slotNumber: true },
      });
      const used = new Set(active.map((r) => r.slotNumber));
      let n = 1;
      while (used.has(n)) n += 1;
      slot = n;
    } else {
      // If an explicit slot was provided, make sure it isn't already occupied
      // by another active book at this store.
      const clash = await prisma.lotteryBox.findFirst({
        where: { orgId, storeId, status: 'active', slotNumber: slot, NOT: { id } },
      });
      if (clash) {
        return res.status(409).json({ success: false, error: `Slot ${slot} is already occupied by book ${clash.boxNumber || clash.id}` });
      }
    }

    const activatedAt = date ? new Date(date) : new Date();
    const updated = await prisma.lotteryBox.update({
      where: { id },
      data: {
        status: 'active',
        activatedAt,
        slotNumber: slot,
        ...(currentTicket != null && { currentTicket: String(currentTicket), lastShiftStartTicket: String(currentTicket) }),
      },
      include: { game: true },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateBox = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    const box = await prisma.lotteryBox.findFirst({ where: { id, orgId, storeId } });
    if (!box) return res.status(404).json({ success: false, error: 'Box not found' });
    const {
      slotNumber, status, currentTicket,
      // Additional fields: used to fix pack-size / pricing mistakes on books
      // that were received with the wrong metadata. totalValue is auto-
      // recomputed when totalTickets or ticketPrice change so reports stay
      // consistent. startTicket is accepted for EoD corrections.
      totalTickets, ticketPrice, startTicket, boxNumber,
    } = req.body;

    const patch = {
      ...(slotNumber     != null && { slotNumber:     Number(slotNumber) }),
      ...(status         != null && { status }),
      ...(currentTicket  != null && { currentTicket: String(currentTicket) }),
      ...(startTicket    != null && { startTicket:   String(startTicket) }),
      ...(boxNumber      != null && { boxNumber:     String(boxNumber) }),
      ...(status === 'depleted' && !box.depletedAt && { depletedAt: new Date() }),
    };

    // Recompute totalValue whenever totalTickets or ticketPrice change so
    // Counter/Safe value totals stay accurate.
    if (totalTickets != null || ticketPrice != null) {
      const newTotal = totalTickets != null ? Number(totalTickets) : Number(box.totalTickets || 0);
      const newPrice = ticketPrice  != null ? Number(ticketPrice)  : Number(box.ticketPrice  || 0);
      if (totalTickets != null) patch.totalTickets = newTotal;
      if (ticketPrice  != null) patch.ticketPrice  = newPrice;
      patch.totalValue = newTotal * newPrice;
    }

    const updated = await prisma.lotteryBox.update({
      where: { id },
      data: patch,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[lottery.updateBox]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteBox = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    const box = await prisma.lotteryBox.findFirst({ where: { id, orgId, storeId } });
    if (!box) return res.status(404).json({ success: false, error: 'Box not found' });
    // Activated boxes CANNOT be deleted
    if (box.status !== 'inventory') {
      return res.status(400).json({ success: false, error: 'Only inventory boxes can be deleted. Activated, depleted, or settled boxes cannot be removed.' });
    }
    await prisma.lotteryBox.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// TICKET ADJUSTMENT (+/-)
// Used to correct box counts — e.g. damaged tickets, returned, miscounts.
// Creates an adjustment transaction record for audit trail.
// ══════════════════════════════════════════════════════════════════════════

export const adjustBoxTickets = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    const { delta, reason, notes } = req.body;

    if (delta === undefined || delta === null || Number(delta) === 0) {
      return res.status(400).json({ success: false, error: 'delta is required and must be non-zero' });
    }
    if (!reason) {
      return res.status(400).json({ success: false, error: 'reason is required' });
    }

    const box = await prisma.lotteryBox.findFirst({
      where: { id, orgId, storeId },
      include: { game: { select: { id: true, name: true, ticketPrice: true } } },
    });
    if (!box) return res.status(404).json({ success: false, error: 'Box not found' });

    const deltaInt = parseInt(delta);
    const newTicketsSold = Math.max(0, (box.ticketsSold || 0) + deltaInt);

    // Don't allow going above total tickets
    if (box.totalTickets && newTicketsSold > box.totalTickets) {
      return res.status(400).json({
        success: false,
        error: `Cannot exceed total tickets (${box.totalTickets}). Box already has ${box.ticketsSold} sold.`,
      });
    }

    // Update box
    const updatedBox = await prisma.lotteryBox.update({
      where: { id },
      data: {
        ticketsSold: newTicketsSold,
        currentTicket: box.currentTicket != null
          ? Math.max(box.startTicket || 0, (box.currentTicket || 0) + deltaInt)
          : undefined,
      },
    });

    // Create adjustment transaction record
    const ticketPrice = Number(box.game?.ticketPrice || 0);
    const amount = deltaInt * ticketPrice;

    await prisma.lotteryTransaction.create({
      data: {
        orgId, storeId,
        boxId: box.id,
        gameId: box.gameId,
        type: 'adjustment',
        amount: Math.abs(amount),
        ticketCount: Math.abs(deltaInt),
        notes: `${deltaInt > 0 ? '+' : ''}${deltaInt} tickets — ${reason}${notes ? ': ' + notes : ''}`,
        userId: req.user?.id || null,
      },
    }).catch(() => {});

    res.json({ success: true, data: updatedBox });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ══════════════════════════════════════════════════════════════════════════

export const getLotteryTransactions = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { shiftId, type, limit = 50, offset = 0, from, to } = req.query;
    const where = {
      orgId, storeId,
      ...(shiftId && { shiftId }),
      ...(type    && { type }),
      ...(from || to) && {
        createdAt: {
          ...(from && { gte: new Date(from) }),
          ...(to   && { lte: new Date(to)   }),
        },
      },
    };
    const [txns, total] = await Promise.all([
      prisma.lotteryTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: Number(offset), take: Number(limit) }),
      prisma.lotteryTransaction.count({ where }),
    ]);
    res.json({ success: true, data: txns, total });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createLotteryTransaction = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { type, amount, shiftId, cashierId, stationId, gameId, boxId, ticketCount, notes, posTransactionId } = req.body;
    if (!type || !amount) return res.status(400).json({ success: false, error: 'type and amount are required' });
    if (!['sale', 'payout'].includes(type)) return res.status(400).json({ success: false, error: 'type must be sale or payout' });

    const txn = await prisma.lotteryTransaction.create({
      data: {
        orgId, storeId, type,
        amount:          Number(amount),
        shiftId:         shiftId         || null,
        cashierId:       cashierId       || null,
        stationId:       stationId       || null,
        gameId:          gameId          || null,
        boxId:           boxId           || null,
        ticketCount:     ticketCount     ? Number(ticketCount) : null,
        notes:           notes           || null,
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
    res.status(500).json({ success: false, error: err.message });
  }
};

// Bulk — record multiple sales/payouts in one request (used at shift end scan)
export const bulkCreateLotteryTransactions = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { transactions } = req.body;
    if (!Array.isArray(transactions) || !transactions.length) {
      return res.status(400).json({ success: false, error: 'transactions array required' });
    }
    const created = await prisma.lotteryTransaction.createMany({
      data: transactions.map(t => ({
        orgId, storeId,
        type:    t.type,
        amount:  Number(t.amount),
        shiftId: t.shiftId         || null,
        cashierId: t.cashierId     || null,
        gameId:  t.gameId          || null,
        boxId:   t.boxId           || null,
        ticketCount: t.ticketCount ? Number(t.ticketCount) : null,
        notes:   t.notes           || null,
      })),
    });
    res.json({ success: true, count: created.count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// SHIFT REPORT
// ══════════════════════════════════════════════════════════════════════════

export const getLotteryShiftReport = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { shiftId } = req.params;

    let report = await prisma.lotteryShiftReport.findFirst({ where: { shiftId, orgId, storeId } });

    // Compute live totals from transactions
    const txns = await prisma.lotteryTransaction.findMany({ where: { shiftId, orgId, storeId } });
    const totalSales   = txns.filter(t => t.type === 'sale').reduce((s, t)   => s + Number(t.amount), 0);
    const totalPayouts = txns.filter(t => t.type === 'payout').reduce((s, t) => s + Number(t.amount), 0);
    const netAmount    = totalSales - totalPayouts;

    if (!report) {
      // Return a computed preview (not yet saved)
      return res.json({ success: true, data: { shiftId, orgId, storeId, totalSales, totalPayouts, netAmount, saved: false } });
    }

    const variance = report.machineAmount != null || report.digitalAmount != null
      ? ((num(report.machineAmount) || 0) + (num(report.digitalAmount) || 0)) - netAmount
      : null;

    res.json({ success: true, data: { ...report, totalSales, totalPayouts, netAmount, variance, saved: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const saveLotteryShiftReport = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { shiftId, machineAmount, digitalAmount, scannedTickets, scannedAmount, boxScans, notes, closedById } = req.body;
    if (!shiftId) return res.status(400).json({ success: false, error: 'shiftId required' });

    // Compute from transactions
    const txns = await prisma.lotteryTransaction.findMany({ where: { shiftId, orgId, storeId } });
    const totalSales   = txns.filter(t => t.type === 'sale').reduce((s, t)   => s + Number(t.amount), 0);
    const totalPayouts = txns.filter(t => t.type === 'payout').reduce((s, t) => s + Number(t.amount), 0);
    const netAmount    = totalSales - totalPayouts;
    const machNum      = machineAmount != null ? Number(machineAmount) : null;
    const digNum       = digitalAmount != null ? Number(digitalAmount) : null;
    const variance     = machNum != null ? (machNum + (digNum || 0)) - netAmount : null;

    const report = await prisma.lotteryShiftReport.upsert({
      where:  { shiftId },
      update: { machineAmount: machNum, digitalAmount: digNum, scannedTickets: scannedTickets || undefined, scannedAmount: scannedAmount ? Number(scannedAmount) : null, boxScans: boxScans || undefined, totalSales, totalPayouts, netAmount, variance, notes: notes || null, closedById: closedById || null, closedAt: new Date() },
      create: { orgId, storeId, shiftId, machineAmount: machNum, digitalAmount: digNum, scannedTickets: scannedTickets || undefined, scannedAmount: scannedAmount ? Number(scannedAmount) : null, boxScans: boxScans || undefined, totalSales, totalPayouts, netAmount, variance, notes: notes || null, closedById: closedById || null, closedAt: new Date() },
    });
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════════════════════

export const getLotteryDashboard = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    const [monthTxns, activeBoxes, inventoryBoxes] = await Promise.all([
      prisma.lotteryTransaction.findMany({ where: { orgId, storeId, createdAt: { gte: monthStart } } }),
      prisma.lotteryBox.count({ where: { orgId, storeId, status: 'active' } }),
      prisma.lotteryBox.count({ where: { orgId, storeId, status: 'inventory' } }),
    ]);

    const totalSales   = monthTxns.filter(t => t.type === 'sale').reduce((s, t)   => s + Number(t.amount), 0);
    const totalPayouts = monthTxns.filter(t => t.type === 'payout').reduce((s, t) => s + Number(t.amount), 0);
    const netRevenue   = totalSales - totalPayouts;
    const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
    const commissionRate = settings?.commissionRate ? Number(settings.commissionRate) : 0.05;
    const commission   = totalSales * commissionRate;

    res.json({ totalSales, totalPayouts, netRevenue, commission, activeBoxes, inventoryBoxes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getLotteryReport = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { period = 'day', from, to } = req.query;

    const now  = new Date();
    let startDate;
    if (from) {
      startDate = new Date(from);
    } else if (period === 'week') {
      startDate = new Date(now); startDate.setDate(now.getDate() - 7);
    } else if (period === 'month') {
      startDate = new Date(now); startDate.setMonth(now.getMonth() - 1);
    } else {
      startDate = new Date(now); startDate.setHours(0, 0, 0, 0);
    }
    const endDate = to ? new Date(to) : new Date();

    const txns = await prisma.lotteryTransaction.findMany({
      where: { orgId, storeId, createdAt: { gte: startDate, lte: endDate } },
      orderBy: { createdAt: 'asc' },
    });

    const totalSales   = txns.filter(t => t.type === 'sale').reduce((s, t)   => s + Number(t.amount), 0);
    const totalPayouts = txns.filter(t => t.type === 'payout').reduce((s, t) => s + Number(t.amount), 0);
    const netAmount    = totalSales - totalPayouts;

    // Group by day for chart data
    const byDay = {};
    txns.forEach(t => {
      const key = t.createdAt.toISOString().slice(0, 10);
      if (!byDay[key]) byDay[key] = { date: key, sales: 0, payouts: 0, net: 0 };
      if (t.type === 'sale')   byDay[key].sales   += Number(t.amount);
      if (t.type === 'payout') byDay[key].payouts += Number(t.amount);
      byDay[key].net = byDay[key].sales - byDay[key].payouts;
    });

    // Group by game
    const gameMap = {};
    txns.forEach(t => {
      const key = t.gameId || '_unknown';
      if (!gameMap[key]) gameMap[key] = { gameId: key, gameName: null, sales: 0, payouts: 0, net: 0, count: 0 };
      if (t.type === 'sale')   { gameMap[key].sales += Number(t.amount); gameMap[key].count++; }
      if (t.type === 'payout') { gameMap[key].payouts += Number(t.amount); }
      gameMap[key].net = gameMap[key].sales - gameMap[key].payouts;
    });
    // Lookup game names
    const gameIds = Object.keys(gameMap).filter(k => k !== '_unknown');
    if (gameIds.length) {
      const games = await prisma.lotteryGame.findMany({ where: { id: { in: gameIds } }, select: { id: true, name: true } });
      games.forEach(g => { if (gameMap[g.id]) gameMap[g.id].gameName = g.name; });
    }
    const byGame = Object.values(gameMap).map(g => ({ ...g, gameName: g.gameName || 'Other' }));

    res.json({ totalSales, totalPayouts, netRevenue: netAmount, transactionCount: txns.length, byGame, chart: Object.values(byDay) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getLotteryCommissionReport = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { from, to, period = 'month' } = req.query;

    let startDate;
    if (from) {
      startDate = new Date(from);
    } else if (period === 'week') {
      startDate = new Date(); startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'day') {
      startDate = new Date(); startDate.setHours(0, 0, 0, 0);
    } else {
      startDate = new Date(); startDate.setDate(1); startDate.setHours(0,0,0,0);
    }
    const endDate = to ? new Date(to) : new Date();

    const games = await prisma.lotteryGame.findMany({
      where: { orgId, storeId, deleted: false },
      include: { boxes: { select: { salesAmount: true, ticketsSold: true } } },
    });

    const txns = await prisma.lotteryTransaction.findMany({
      where: { orgId, storeId, type: 'sale', createdAt: { gte: startDate, lte: endDate } },
    });

    const salesByGameId = {};
    txns.forEach(t => {
      const gId = t.gameId || '_unknown';
      if (!salesByGameId[gId]) salesByGameId[gId] = 0;
      salesByGameId[gId] += Number(t.amount);
    });

    // Get store commission rate from settings
    const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
    const storeCommissionRate = settings?.commissionRate ? Number(settings.commissionRate) : 0.05;

    const commissionRows = games.map(g => {
      const sales  = salesByGameId[g.id] || 0;
      const rate   = storeCommissionRate; // store-level rate, not per-game
      const earned = sales * rate;
      return { gameName: g.name, commissionRate: rate, totalSales: sales, commission: earned };
    });

    const totalCommission = commissionRows.reduce((s, c) => s + c.commission, 0);
    const totalSalesAll   = commissionRows.reduce((s, c) => s + c.totalSales, 0);
    const avgRate         = totalSalesAll > 0 ? totalCommission / totalSalesAll : 0;
    const byGame          = commissionRows.map(c => ({ gameName: c.gameName, rate: c.commissionRate, sales: c.totalSales, commission: c.commission }));
    res.json({ totalCommission, totalSales: totalSalesAll, avgRate, byGame });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getShiftReports = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const reports = await prisma.lotteryShiftReport.findMany({
      where: { orgId, storeId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// LOTTERY SETTINGS (store-level)
// ══════════════════════════════════════════════════════════════════════════

export const getLotterySettings = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    let settings = await prisma.lotterySettings.findUnique({ where: { storeId } });
    if (!settings) {
      // Return defaults without creating
      settings = { orgId, storeId, enabled: true, cashOnly: false, state: null, commissionRate: null, scanRequiredAtShiftEnd: false };
    }
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// TICKET CATALOG  (superadmin/admin – platform-wide, state-scoped)
// ══════════════════════════════════════════════════════════════════════════

/** Stores call this — returns only tickets for the store's state */
export const getCatalogTickets = async (req, res) => {
  try {
    const storeId    = getStore(req);
    const { state, all } = req.query;

    let filterState = state;
    if (!filterState && storeId) {
      const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
      filterState = settings?.state;
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
    res.status(500).json({ success: false, error: err.message });
  }
};

/** Admin calls this — returns ALL tickets (optionally filtered by state) */
export const getAllCatalogTickets = async (req, res) => {
  try {
    const { state } = req.query;
    const tickets = await prisma.lotteryTicketCatalog.findMany({
      where: { ...(state ? { state } : {}) },
      orderBy: [{ state: 'asc' }, { ticketPrice: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createCatalogTicket = async (req, res) => {
  try {
    const { name, gameNumber, ticketPrice, ticketsPerBook, state, category } = req.body;
    if (!name || !ticketPrice || !state)
      return res.status(400).json({ success: false, error: 'name, ticketPrice, and state are required' });
    const ticket = await prisma.lotteryTicketCatalog.create({
      data: {
        name, gameNumber: gameNumber || null,
        ticketPrice:   Number(ticketPrice),
        ticketsPerBook: Number(ticketsPerBook || 300),
        state, category: category || null,
        createdBy: req.user?.id || null,
      },
    });
    res.json({ success: true, data: ticket });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateCatalogTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, gameNumber, ticketPrice, ticketsPerBook, state, category, active } = req.body;
    const ticket = await prisma.lotteryTicketCatalog.update({
      where: { id },
      data: {
        ...(name           != null && { name }),
        ...(gameNumber     != null && { gameNumber }),
        ...(ticketPrice    != null && { ticketPrice:    Number(ticketPrice) }),
        ...(ticketsPerBook != null && { ticketsPerBook: Number(ticketsPerBook) }),
        ...(state          != null && { state }),
        ...(category       != null && { category }),
        ...(active         != null && { active: Boolean(active) }),
      },
    });
    res.json({ success: true, data: ticket });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteCatalogTicket = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.lotteryTicketCatalog.update({ where: { id }, data: { active: false } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// TICKET REQUESTS  (stores submit, admins review)
// ══════════════════════════════════════════════════════════════════════════

export const getTicketRequests = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { status } = req.query;
    const isAdmin = ['superadmin', 'admin'].includes(req.user?.role);

    const requests = await prisma.lotteryTicketRequest.findMany({
      where: {
        ...(isAdmin ? { orgId } : { orgId, storeId }),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: requests });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createTicketRequest = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { name, gameNumber, ticketPrice, ticketsPerBook, state, notes, storeName } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name is required' });

    const request = await prisma.lotteryTicketRequest.create({
      data: {
        orgId, storeId, storeName: storeName || null, name,
        gameNumber:    gameNumber    || null,
        ticketPrice:   ticketPrice   ? Number(ticketPrice)   : null,
        ticketsPerBook: ticketsPerBook ? Number(ticketsPerBook) : null,
        state: state || null,
        notes: notes || null,
        status: 'pending',
      },
    });
    res.json({ success: true, data: request });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const reviewTicketRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes, addToCatalog, catalogData } = req.body;
    if (!['approved', 'rejected'].includes(status))
      return res.status(400).json({ success: false, error: 'status must be approved or rejected' });

    let resolvedCatalogId = null;

    if (status === 'approved' && addToCatalog && catalogData) {
      const cat = await prisma.lotteryTicketCatalog.create({
        data: {
          name:           catalogData.name,
          gameNumber:     catalogData.gameNumber     || null,
          ticketPrice:    Number(catalogData.ticketPrice),
          ticketsPerBook: Number(catalogData.ticketsPerBook || 300),
          state:          catalogData.state,
          category:       catalogData.category       || null,
          createdBy:      req.user?.id               || null,
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
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getPendingRequestCount = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const count = await prisma.lotteryTicketRequest.count({
      where: { orgId, status: 'pending' },
    });
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// RECEIVE FROM CATALOG
// Store selects a catalog ticket + enters qty → auto-creates a local
// LotteryGame (if none exists) then creates LotteryBox records.
// ══════════════════════════════════════════════════════════════════════════

export const receiveFromCatalog = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { catalogTicketId, qty } = req.body;

    if (!catalogTicketId || !qty || Number(qty) < 1)
      return res.status(400).json({ success: false, error: 'catalogTicketId and qty (≥1) are required' });

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
            orgId, storeId,
            gameId:       game.id,
            totalTickets: game.ticketsPerBox,
            ticketPrice:  Number(game.ticketPrice),
            totalValue:   Number(game.ticketPrice) * game.ticketsPerBox,
            status:       'inventory',
          },
        })
      )
    );

    res.json({ success: true, data: boxes, game, count: boxes.length });
  } catch (err) {
    console.error('[lottery.receiveFromCatalog]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateLotterySettings = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const {
      enabled, cashOnly, state, commissionRate, scanRequiredAtShiftEnd,
      sellDirection, allowMultipleActivePerGame,
      weekStartDay, settlementPctThreshold, settlementMaxDaysActive,
    } = req.body;

    const normalizedDirection = sellDirection === 'asc' || sellDirection === 'desc' ? sellDirection : undefined;

    const settings = await prisma.lotterySettings.upsert({
      where:  { storeId },
      update: {
        ...(enabled                    != null && { enabled:                    Boolean(enabled) }),
        ...(cashOnly                   != null && { cashOnly:                   Boolean(cashOnly) }),
        ...(state                      != null && { state }),
        ...(commissionRate             != null && { commissionRate:             Number(commissionRate) }),
        ...(scanRequiredAtShiftEnd     != null && { scanRequiredAtShiftEnd:     Boolean(scanRequiredAtShiftEnd) }),
        ...(normalizedDirection                && { sellDirection:              normalizedDirection }),
        ...(allowMultipleActivePerGame != null && { allowMultipleActivePerGame: Boolean(allowMultipleActivePerGame) }),
        ...(weekStartDay               != null && { weekStartDay:               Number(weekStartDay) }),
        ...(settlementPctThreshold     != null && { settlementPctThreshold:     Number(settlementPctThreshold) }),
        ...(settlementMaxDaysActive    != null && { settlementMaxDaysActive:    Number(settlementMaxDaysActive) }),
      },
      create: {
        orgId, storeId,
        enabled:                    enabled                    != null ? Boolean(enabled) : true,
        cashOnly:                   cashOnly                   != null ? Boolean(cashOnly) : false,
        state:                      state                      || null,
        commissionRate:             commissionRate             != null ? Number(commissionRate) : null,
        scanRequiredAtShiftEnd:     scanRequiredAtShiftEnd     != null ? Boolean(scanRequiredAtShiftEnd) : false,
        sellDirection:              normalizedDirection        || 'desc',
        allowMultipleActivePerGame: allowMultipleActivePerGame != null ? Boolean(allowMultipleActivePerGame) : false,
        weekStartDay:               weekStartDay               != null ? Number(weekStartDay) : null,
        settlementPctThreshold:     settlementPctThreshold     != null ? Number(settlementPctThreshold) : null,
        settlementMaxDaysActive:    settlementMaxDaysActive    != null ? Number(settlementMaxDaysActive) : null,
      },
    });
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// SCAN / LOCATION HANDLERS (Phase 1a)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Log a scan event. Never throws — audit logging must not break the user flow.
 */
async function logScanEvent({ orgId, storeId, boxId, userId, raw, parsed, action, context, notes }) {
  try {
    await prisma.lotteryScanEvent.create({
      data: {
        orgId,
        storeId,
        boxId:     boxId ?? null,
        scannedBy: userId ?? null,
        raw:       String(raw ?? ''),
        parsed:    parsed ?? undefined,
        action,
        context,
        notes:     notes ?? null,
      },
    });
  } catch (err) {
    console.warn('[lottery] failed to write scan event:', err.message);
  }
}

/**
 * POST /api/lottery/scan
 * Body: { raw: string, context?: 'pos'|'eod'|'receive'|'return'|'admin' }
 *
 * Parses the raw barcode via the state adapter, finds the matching book in
 * inventory, and auto-activates / updates currentTicket / auto-soldouts as
 * needed. Returns a structured result the UI can react to.
 */
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
export const parseLotteryScan = async (req, res) => {
  try {
    const storeId = getStore(req);
    const { raw } = req.body || {};
    if (!raw || typeof raw !== 'string') {
      return res.status(400).json({ success: false, error: 'raw barcode string is required' });
    }
    const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
    const parsed = _parseScan(raw, settings?.state || null);
    if (!parsed) {
      return res.status(400).json({ success: false, error: 'Barcode format not recognised for any supported state' });
    }
    return res.json({ success: true, state: parsed.adapter.code, parsed: parsed.parsed });
  } catch (err) {
    console.error('[lottery.parseScan]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const scanLotteryBarcode = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const userId  = req.user?.id || null;
    const { raw, context = 'admin' } = req.body || {};

    if (!raw || typeof raw !== 'string') {
      return res.status(400).json({ success: false, error: 'raw barcode string is required' });
    }

    const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
    const stateCode = settings?.state || null;

    const parsed = _parseScan(raw, stateCode);
    if (!parsed) {
      await logScanEvent({ orgId, storeId, userId, raw, parsed: null, action: 'rejected', context, notes: 'unknown_format' });
      return res.status(400).json({ success: false, error: 'Barcode format not recognised for any supported state' });
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
      action:  result.action,
      context,
      notes:   result.reason || null,
      boxId:   result.box?.id || null,
    });

    if (result.action === 'activate' && result.autoSoldout) {
      await logScanEvent({
        orgId, storeId, userId,
        raw, parsed: { adapter: parsed.adapter.code, ...parsed.parsed },
        action: 'auto_soldout',
        context,
        notes:  `soldout by new scan of ${result.box?.boxNumber}`,
        boxId:  result.autoSoldout.id,
      });
    }

    // Surface sequence-gap warnings so the UI can nag the user
    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
      for (const w of result.warnings) {
        await logScanEvent({
          orgId, storeId, userId,
          raw, parsed: { adapter: parsed.adapter.code, ...parsed.parsed, warning: w.code },
          action: 'warning',
          context,
          notes:  w.message,
          boxId:  result.box?.id || null,
        });
      }
    }

    return res.json({
      success: true,
      action:       result.action,
      reason:       result.reason || null,
      message:      result.message || null,
      box:          result.box || null,
      autoSoldout:  result.autoSoldout || null,
      warnings:     result.warnings || [],
      state:        parsed.adapter.code,
      parsed:       parsed.parsed,
    });
  } catch (err) {
    console.error('[lottery.scan]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/lottery/boxes/:id/move-to-safe
 * Body: { date?: ISO date string }
 *
 * - If date is today or omitted → execute immediately.
 * - If date is in the future    → schedule via pendingLocation fields.
 */
export const moveBoxToSafe = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const boxId   = req.params.id;
    const { date } = req.body || {};

    const box = await prisma.lotteryBox.findFirst({ where: { id: boxId, orgId, storeId } });
    if (!box) return res.status(404).json({ success: false, error: 'Box not found' });
    if (box.status !== 'active') {
      return res.status(400).json({ success: false, error: `Only active (counter) books can move to safe. Current: ${box.status}` });
    }

    const target = date ? new Date(date) : new Date();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const asOfMidnight = new Date(target); asOfMidnight.setHours(0, 0, 0, 0);
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
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/lottery/boxes/:id/soldout
 * Body: { reason?: 'manual'|'eod_so_button' }
 */
export const markBoxSoldout = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const boxId   = req.params.id;
    const { reason = 'manual' } = req.body || {};

    const box = await prisma.lotteryBox.findFirst({ where: { id: boxId, orgId, storeId } });
    if (!box) return res.status(404).json({ success: false, error: 'Box not found' });
    if (!['active', 'inventory'].includes(box.status)) {
      return res.status(400).json({ success: false, error: `Cannot soldout from status ${box.status}` });
    }

    const updated = await prisma.lotteryBox.update({
      where: { id: boxId },
      data: {
        status: 'depleted',
        depletedAt: new Date(),
        autoSoldoutReason: reason,
        updatedAt: new Date(),
      },
      include: { game: true },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
export const returnBoxToLotto = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const boxId   = req.params.id;
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
    if (!box) return res.status(404).json({ success: false, error: 'Box not found' });
    if (!['inventory', 'active'].includes(box.status)) {
      return res.status(400).json({ success: false, error: `Cannot return from status ${box.status}` });
    }

    const data = {
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
        return res.status(400).json({ success: false, error: 'ticketsSold must be a non-negative number' });
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
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * DELETE /api/lottery/boxes/:id/pending-move
 * Cancels a scheduled Move to Safe (or any other pending location change).
 */
export const cancelPendingMove = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const boxId   = req.params.id;

    const box = await prisma.lotteryBox.findFirst({ where: { id: boxId, orgId, storeId } });
    if (!box) return res.status(404).json({ success: false, error: 'Box not found' });
    if (!box.pendingLocation) {
      return res.status(400).json({ success: false, error: 'No pending move to cancel' });
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
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/lottery/run-pending-moves
 * On-demand trigger for the pending-move sweep. Useful for "Close the Day".
 */
export const runPendingMovesNow = async (req, res) => {
  try {
    const storeId = getStore(req);
    const result = await _runPendingMoveSweep({ storeId });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
function parseDate(str) {
  if (!str) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const d = new Date(str + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * GET /api/lottery/online-total?date=YYYY-MM-DD
 * Returns the 3-number online total row for the given date (or nulls if none).
 */
export const getLotteryOnlineTotal = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const date    = parseDate(req.query.date);
    if (!date) return res.status(400).json({ success: false, error: 'Invalid date' });

    const row = await prisma.lotteryOnlineTotal.findUnique({
      where: { orgId_storeId_date: { orgId, storeId, date } },
    }).catch(() => null);

    res.json({ success: true, data: row || null, date: req.query.date || date.toISOString().slice(0, 10) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * PUT /api/lottery/online-total
 * Body: { date: 'YYYY-MM-DD', instantCashing?, machineSales?, machineCashing?, notes? }
 * Upserts the per-day row. Only fields provided are overwritten.
 */
export const upsertLotteryOnlineTotal = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const userId  = req.user?.id || null;
    const { date: dateStr, instantCashing, machineSales, machineCashing, notes } = req.body || {};
    const date = parseDate(dateStr);
    if (!date) return res.status(400).json({ success: false, error: 'date is required (YYYY-MM-DD)' });

    const updateData = {
      ...(instantCashing != null && { instantCashing: Number(instantCashing) }),
      ...(machineSales   != null && { machineSales:   Number(machineSales) }),
      ...(machineCashing != null && { machineCashing: Number(machineCashing) }),
      ...(notes          != null && { notes }),
      enteredById: userId,
    };
    const row = await prisma.lotteryOnlineTotal.upsert({
      where:  { orgId_storeId_date: { orgId, storeId, date } },
      update: updateData,
      create: {
        orgId, storeId, date,
        instantCashing: instantCashing != null ? Number(instantCashing) : 0,
        machineSales:   machineSales   != null ? Number(machineSales)   : 0,
        machineCashing: machineCashing != null ? Number(machineCashing) : 0,
        notes: notes || null,
        enteredById: userId,
      },
    });
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

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
export const getDailyLotteryInventory = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const date    = parseDate(req.query.date);
    if (!date) return res.status(400).json({ success: false, error: 'Invalid date' });

    const dayStart = new Date(date); dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd   = new Date(date); dayEnd.setUTCHours(23, 59, 59, 999);

    // Current state (as of now, not historical)
    const [activeCnt, safeCnt, soldoutCnt, activeBoxes, safeBoxes] = await Promise.all([
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

    // Value on hand = total face value of active + safe boxes minus already-sold tickets
    const safeValue  = safeBoxes.reduce((s, b) => s + Number(b.totalValue || 0), 0);
    const activeRemaining = activeBoxes.reduce((s, b) => {
      const total = Number(b.totalValue || 0);
      const sold  = Number(b.ticketsSold || 0) * Number(b.ticketPrice || 0);
      return s + Math.max(0, total - sold);
    }, 0);
    const end = safeValue + activeRemaining;

    // Today's movements
    const [receivedToday, activatedToday, returnsToday, saleTxs] = await Promise.all([
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
          orgId, storeId,
          type: 'sale',
          createdAt: { gte: dayStart, lte: dayEnd },
        },
        select: { amount: true },
      }),
    ]);

    const received   = receivedToday.reduce((s, b) => s + Number(b.totalValue || 0), 0);
    const activated  = activatedToday.length;
    const sold       = saleTxs.reduce((s, t) => s + Number(t.amount || 0), 0);
    const returnPart = returnsToday
      .filter((b) => Number(b.ticketsSold || 0) > 0)
      .reduce((s, b) => s + Math.max(0, (Number(b.totalTickets || 0) - Number(b.ticketsSold || 0)) * Number(b.ticketPrice || 0)), 0);
    const returnFull = returnsToday
      .filter((b) => Number(b.ticketsSold || 0) === 0)
      .reduce((s, b) => s + Number(b.totalValue || 0), 0);

    // Begin = End + Sold + Returns − Received
    const begin = end + sold + returnPart + returnFull - received;

    res.json({
      success: true,
      data: {
        begin:      Math.round(begin * 100) / 100,
        received:   Math.round(received * 100) / 100,
        activated,
        sold:       Math.round(sold * 100) / 100,
        returnPart: Math.round(returnPart * 100) / 100,
        returnFull: Math.round(returnFull * 100) / 100,
        end:        Math.round(end * 100) / 100,
        counts: {
          active:  activeCnt,
          safe:    safeCnt,
          soldout: soldoutCnt,
        },
      },
    });
  } catch (err) {
    console.error('[lottery.daily-inventory]', err);
    res.status(500).json({ success: false, error: err.message });
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
export const closeLotteryDay = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const userId  = req.user?.id || null;
    const dateStr = req.body?.date || new Date().toISOString().slice(0, 10);
    const date    = parseDate(dateStr);
    if (!date) return res.status(400).json({ success: false, error: 'Invalid date' });

    // 1. Execute pending moves
    const sweep = await _runPendingMoveSweep({ storeId, asOfDate: new Date() });

    // 2. Snapshot active counter — one LotteryScanEvent per active book so
    //    there's an immutable "end of day position" record.
    const active = await prisma.lotteryBox.findMany({
      where: { orgId, storeId, status: 'active' },
      select: {
        id: true, boxNumber: true, slotNumber: true,
        currentTicket: true, startTicket: true,
        ticketsSold: true, totalTickets: true,
        game: { select: { id: true, name: true, gameNumber: true, ticketPrice: true } },
      },
    });

    await Promise.all(active.map((b) => prisma.lotteryScanEvent.create({
      data: {
        orgId, storeId,
        boxId:     b.id,
        scannedBy: userId,
        raw:       `close_day:${dateStr}`,
        parsed:    {
          gameNumber:     b.game?.gameNumber ?? null,
          gameName:       b.game?.name ?? null,
          slotNumber:     b.slotNumber,
          currentTicket:  b.currentTicket,
          ticketsSold:    b.ticketsSold,
        },
        action:  'close_day_snapshot',
        context: 'eod',
      },
    }).catch(() => null)));

    // 3. Today's inventory snapshot (same math as daily-inventory endpoint)
    res.json({
      success: true,
      date: dateStr,
      pendingMoveSweep: sweep,
      snapshotCount:    active.length,
    });
  } catch (err) {
    console.error('[lottery.close-day]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/lottery/yesterday-closes?date=YYYY-MM-DD
 *
 * For the given `date`, returns the LAST close_day_snapshot for each
 * LotteryBox that happened BEFORE the date's local midnight. This is
 * "the ticket number each book closed at on the previous day" — used by
 * the Daily page to populate the Counter's "yesterday" column so the
 * day-to-day rollover math works correctly.
 *
 * Shape: { success, closes: { [boxId]: { ticket, soldThatDay, closedAt } } }
 */
export const getYesterdayCloses = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const date    = parseDate(req.query.date);
    if (!date) return res.status(400).json({ success: false, error: 'Invalid date' });

    const dayStart = new Date(date); dayStart.setUTCHours(0, 0, 0, 0);

    // All close_day_snapshot events prior to this date's start. Newest first
    // so the first one we encounter per box is its most recent close.
    const events = await prisma.lotteryScanEvent.findMany({
      where: {
        orgId, storeId,
        action: 'close_day_snapshot',
        createdAt: { lt: dayStart },
      },
      orderBy: { createdAt: 'desc' },
      select: { boxId: true, parsed: true, createdAt: true },
    });

    const closes = {};
    for (const ev of events) {
      if (!ev.boxId || closes[ev.boxId]) continue;   // already have newer close for this box
      const parsed = ev.parsed && typeof ev.parsed === 'object' ? ev.parsed : {};
      const ticket = parsed.currentTicket ?? null;
      closes[ev.boxId] = {
        ticket,
        ticketsSold: parsed.ticketsSold ?? null,
        closedAt:    ev.createdAt,
      };
    }
    res.json({ success: true, closes });
  } catch (err) {
    console.error('[lottery.yesterdayCloses]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// WEEKLY SETTLEMENT (Phase 2)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Resolve the settlement parameters for the active store.
 * Precedence for weekStartDay / settlement rules:
 *   1. LotterySettings override fields (manager set these to override state)
 *   2. State adapter defaults
 *   3. Sunday start / null rules
 */
async function _settlementParams(orgId, storeId) {
  const settings = await prisma.lotterySettings.findUnique({ where: { storeId } }).catch(() => null);
  const adapter = _getAdapter(settings?.state);
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
export const listLotterySettlements = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { stateCode, weekStartDay, commissionRate } = await _settlementParams(orgId, storeId);

    const toDate   = req.query.to   ? new Date(req.query.to + 'T23:59:59Z')   : new Date();
    const fromDate = req.query.from ? new Date(req.query.from + 'T00:00:00Z') : (() => {
      const d = new Date(toDate); d.setUTCMonth(d.getUTCMonth() - 3); return d;
    })();

    // Build ordered list of week ranges in the window
    const weeks = [];
    const { start: firstStart } = _weekRangeFor(toDate, weekStartDay);
    let cursor = new Date(firstStart);
    while (cursor >= fromDate) {
      const { start, end, due } = _weekRangeFor(cursor, weekStartDay);
      weeks.push({ start, end, due });
      cursor = new Date(start);
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    // Fetch any persisted rows for the window
    const persisted = await prisma.lotteryWeeklySettlement.findMany({
      where: {
        orgId, storeId,
        weekStart: { in: weeks.map((w) => w.start) },
      },
    });
    const byStart = new Map(persisted.map((r) => [r.weekStart.toISOString().slice(0, 10), r]));

    // Merge — persisted rows win, otherwise compute lightweight preview
    const results = await Promise.all(weeks.map(async (w) => {
      const key = w.start.toISOString().slice(0, 10);
      const existing = byStart.get(key);
      if (existing) return existing;
      // Lightweight preview — just totals, no book-ids arrays
      const snapshot = await _computeSettlement({
        orgId, storeId,
        weekStart: w.start,
        weekEnd: w.end,
        stateCode,
        commissionRate,
      }).catch(() => null);
      return {
        id: null,
        orgId, storeId,
        weekStart: w.start,
        weekEnd: w.end,
        dueDate: w.due,
        ...snapshot,
        bonus: 0, serviceCharge: 0, adjustments: 0, notes: null,
        status: 'draft',
        computedAt: new Date(),
        persisted: false,
      };
    }));

    res.json({ success: true, data: results, from: fromDate, to: toDate, weekStartDay, stateCode });
  } catch (err) {
    console.error('[lottery.settlements.list]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/lottery/settlements/:weekStart
 * weekStart is YYYY-MM-DD. Computes + returns (but does not persist) a fresh
 * snapshot merged with any saved adjustments.
 */
export const getLotterySettlement = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { stateCode, weekStartDay, commissionRate } = await _settlementParams(orgId, storeId);
    const { weekStart: raw } = req.params;
    const ws = new Date(raw + 'T00:00:00Z');
    if (Number.isNaN(ws.getTime())) return res.status(400).json({ success: false, error: 'Invalid weekStart' });

    // Snap to actual week boundaries in case caller passed a mid-week date
    const { start, end, due } = _weekRangeFor(ws, weekStartDay);

    const existing = await prisma.lotteryWeeklySettlement.findUnique({
      where: { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
    });

    const snapshot = await _computeSettlement({
      orgId, storeId, weekStart: start, weekEnd: end, stateCode, commissionRate,
    });

    // If finalized/paid, return as-is (don't re-compute over the frozen numbers)
    if (existing && existing.status !== 'draft') {
      return res.json({ success: true, data: existing, snapshot });
    }

    // Merge persisted adjustments onto the fresh snapshot.
    //
    // Formula (per user spec):
    //   Daily Due      = Instant sales − Instant cashings + Machine sales − Machine cashings
    //   Weekly Gross   = Σ Daily Due         (already in snapshot.grossBeforeCommission)
    //   Weekly Net     = Weekly Gross − returns − commissions
    //   Weekly Payable = Weekly Net − bonus + service − adjustments
    const bonus         = Number(existing?.bonus || 0);
    const serviceCharge = Number(existing?.serviceCharge || 0);
    const adjustments   = Number(existing?.adjustments || 0);

    const weeklyNet = snapshot.grossBeforeCommission - snapshot.returnsDeduction - snapshot.totalCommission;
    const weeklyPayable = weeklyNet - bonus + serviceCharge - adjustments;

    const merged = {
      id: existing?.id || null,
      orgId, storeId,
      weekStart: start, weekEnd: end, dueDate: due,
      ...snapshot,
      bonus, serviceCharge, adjustments,
      notes:     existing?.notes || null,
      status:    existing?.status || 'draft',
      persisted: !!existing,

      // Explicit totals — frontend displays both with/without commission
      weeklyGross:   Math.round(snapshot.grossBeforeCommission * 100) / 100,
      weeklyNet:     Math.round(weeklyNet * 100) / 100,
      weeklyPayable: Math.round(weeklyPayable * 100) / 100,
      totalDue:      Math.round(weeklyPayable * 100) / 100,   // canonical
    };

    res.json({ success: true, data: merged });
  } catch (err) {
    console.error('[lottery.settlements.get]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * PUT /api/lottery/settlements/:weekStart
 * Body: { bonus?, serviceCharge?, adjustments?, notes?, saveComputedSnapshot? }
 *
 * Upserts the adjustments. If `saveComputedSnapshot` is true, also saves
 * the freshly-computed sales/commission numbers (locks them in).
 */
export const upsertLotterySettlement = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { stateCode, weekStartDay, commissionRate } = await _settlementParams(orgId, storeId);
    const { weekStart: raw } = req.params;
    const ws = new Date(raw + 'T00:00:00Z');
    if (Number.isNaN(ws.getTime())) return res.status(400).json({ success: false, error: 'Invalid weekStart' });
    const { start, end, due } = _weekRangeFor(ws, weekStartDay);

    const existing = await prisma.lotteryWeeklySettlement.findUnique({
      where: { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
    });
    if (existing && existing.status !== 'draft') {
      return res.status(409).json({ success: false, error: `Cannot edit a ${existing.status} settlement` });
    }

    const { bonus, serviceCharge, adjustments, notes, saveComputedSnapshot } = req.body || {};

    const snap = saveComputedSnapshot ? await _computeSettlement({
      orgId, storeId, weekStart: start, weekEnd: end, stateCode, commissionRate,
    }) : null;

    const totalSnapshot = snap || {
      onlineGross:        Number(existing?.onlineGross || 0),
      onlineCashings:     Number(existing?.onlineCashings || 0),
      onlineCommission:   Number(existing?.onlineCommission || 0),
      instantSales:       Number(existing?.instantSales || 0),
      instantSalesComm:   Number(existing?.instantSalesComm || 0),
      instantCashingComm: Number(existing?.instantCashingComm || 0),
      returnsDeduction:   Number(existing?.returnsDeduction || 0),
      settledBookIds:     existing?.settledBookIds || [],
      returnedBookIds:    existing?.returnedBookIds || [],
      unsettledBookIds:   existing?.unsettledBookIds || [],
    };

    const b = bonus != null ? Number(bonus) : Number(existing?.bonus || 0);
    const s = serviceCharge != null ? Number(serviceCharge) : Number(existing?.serviceCharge || 0);
    const a = adjustments != null ? Number(adjustments) : Number(existing?.adjustments || 0);

    // Match the unified formula — user spec:
    //   Weekly Payable = Σ daily − bonus + service − adjustments − returns − commissions
    const snapGross =
      (Number(totalSnapshot.instantSales || 0) - Number(totalSnapshot.instantPayouts || totalSnapshot.instantCashingComm || 0)) +
      (Number(totalSnapshot.onlineGross || 0)  - Number(totalSnapshot.onlineCashings || 0));
    const snapCommission =
      Number(totalSnapshot.instantSalesComm || 0) +
      Number(totalSnapshot.instantCashingComm || 0) +
      Number(totalSnapshot.machineSalesComm || 0) +
      Number(totalSnapshot.machineCashingComm || 0);
    const snapReturns = Number(totalSnapshot.returnsDeduction || 0);

    const totalDue = Math.round(
      (snapGross - snapReturns - snapCommission - b + s - a) * 100
    ) / 100;

    const data = {
      orgId, storeId,
      weekStart: start, weekEnd: end, dueDate: due,
      onlineGross:        totalSnapshot.onlineGross,
      onlineCashings:     totalSnapshot.onlineCashings,
      onlineCommission:   totalSnapshot.onlineCommission,
      instantSales:       totalSnapshot.instantSales,
      instantSalesComm:   totalSnapshot.instantSalesComm,
      instantCashingComm: totalSnapshot.instantCashingComm,
      returnsDeduction:   totalSnapshot.returnsDeduction,
      settledBookIds:     totalSnapshot.settledBookIds || [],
      returnedBookIds:    totalSnapshot.returnedBookIds || [],
      unsettledBookIds:   totalSnapshot.unsettledBookIds || [],
      bonus: b,
      serviceCharge: s,
      adjustments: a,
      notes: notes != null ? notes : existing?.notes || null,
      totalDue,
      computedAt: snap ? new Date() : (existing?.computedAt || null),
    };

    const row = await prisma.lotteryWeeklySettlement.upsert({
      where:  { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
      update: data,
      create: { ...data, status: 'draft' },
    });

    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[lottery.settlements.upsert]', err);
    res.status(500).json({ success: false, error: err.message });
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
export const finalizeLotterySettlement = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const userId  = req.user?.id || null;
    const { weekStartDay } = await _settlementParams(orgId, storeId);
    const { weekStart: raw } = req.params;
    const ws = new Date(raw + 'T00:00:00Z');
    if (Number.isNaN(ws.getTime())) return res.status(400).json({ success: false, error: 'Invalid weekStart' });
    const { start } = _weekRangeFor(ws, weekStartDay);

    const existing = await prisma.lotteryWeeklySettlement.findUnique({
      where: { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
    });
    if (!existing) return res.status(404).json({ success: false, error: 'Save the settlement first' });
    if (existing.status !== 'draft') {
      return res.status(409).json({ success: false, error: `Settlement already ${existing.status}` });
    }

    const ids = Array.isArray(existing.settledBookIds) ? existing.settledBookIds : [];
    const [row] = await prisma.$transaction([
      prisma.lotteryWeeklySettlement.update({
        where: { id: existing.id },
        data: { status: 'finalized', finalizedAt: new Date(), finalizedById: userId },
      }),
      ...(ids.length > 0 ? [
        prisma.lotteryBox.updateMany({
          where: { id: { in: ids }, orgId, storeId, status: { in: ['active', 'depleted'] } },
          data: { status: 'settled' },
        }),
      ] : []),
    ]);

    res.json({ success: true, data: row, settledBooksUpdated: ids.length });
  } catch (err) {
    console.error('[lottery.settlements.finalize]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/lottery/settlements/:weekStart/mark-paid
 * Body: { paidRef? }
 */
export const markLotterySettlementPaid = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { weekStartDay } = await _settlementParams(orgId, storeId);
    const { weekStart: raw } = req.params;
    const ws = new Date(raw + 'T00:00:00Z');
    if (Number.isNaN(ws.getTime())) return res.status(400).json({ success: false, error: 'Invalid weekStart' });
    const { start } = _weekRangeFor(ws, weekStartDay);

    const existing = await prisma.lotteryWeeklySettlement.findUnique({
      where: { orgId_storeId_weekStart: { orgId, storeId, weekStart: start } },
    });
    if (!existing) return res.status(404).json({ success: false, error: 'Settlement not found' });
    if (existing.status === 'paid') return res.json({ success: true, data: existing, alreadyPaid: true });
    if (existing.status !== 'finalized') {
      return res.status(409).json({ success: false, error: 'Finalize the settlement before marking paid' });
    }

    const row = await prisma.lotteryWeeklySettlement.update({
      where: { id: existing.id },
      data: { status: 'paid', paidAt: new Date(), paidRef: req.body?.paidRef || null },
    });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[lottery.settlements.mark-paid]', err);
    res.status(500).json({ success: false, error: err.message });
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
export const syncLotteryCatalog = async (req, res) => {
  try {
    const state = String(req.body?.state || 'all').toUpperCase();
    if (state === 'ALL') {
      const results = await _syncAllSupported();
      return res.json({ success: true, results });
    }

    const diff = await _syncState(state).catch((err) => {
      if (err.code === 'UNSUPPORTED_STATE') return { state, error: err.message, unsupported: true };
      throw err;
    });
    res.json({ success: true, result: diff });
  } catch (err) {
    console.error('[lottery.catalog.sync]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
