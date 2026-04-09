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

export const receiveBoxOrder = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    // Support both: { gameId, quantity, startTicket } (portal form) and { boxes: [...] } (bulk)
    let items = req.body.boxes;
    if (!items) {
      const { gameId, quantity = 1, startTicket, boxNumber } = req.body;
      if (!gameId) return res.status(400).json({ success: false, error: 'gameId is required' });
      items = Array.from({ length: Number(quantity) }, (_, i) => ({ gameId, startTicket, boxNumber: boxNumber || null }));
    }
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ success: false, error: 'No boxes to receive' });

    const created = await Promise.all(items.map(async (b) => {
      const game = await prisma.lotteryGame.findFirst({ where: { id: b.gameId, orgId, storeId } });
      if (!game) throw new Error(`Game ${b.gameId} not found`);
      const total = Number(b.totalTickets || game.ticketsPerBox);
      return prisma.lotteryBox.create({
        data: {
          orgId, storeId,
          gameId:       b.gameId,
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
    res.status(500).json({ success: false, error: err.message });
  }
};

export const activateBox = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    const { slotNumber } = req.body;
    const box = await prisma.lotteryBox.findFirst({ where: { id, orgId, storeId } });
    if (!box) return res.status(404).json({ success: false, error: 'Box not found' });
    const updated = await prisma.lotteryBox.update({
      where: { id },
      data: { status: 'active', activatedAt: new Date(), ...(slotNumber != null && { slotNumber: Number(slotNumber) }) },
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
    const { slotNumber, status, currentTicket } = req.body;
    const updated = await prisma.lotteryBox.update({
      where: { id },
      data: {
        ...(slotNumber     != null && { slotNumber:     Number(slotNumber) }),
        ...(status         != null && { status }),
        ...(currentTicket  != null && { currentTicket: String(currentTicket) }),
        ...(status === 'depleted' && !box.depletedAt && { depletedAt: new Date() }),
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
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

    const cat = await prisma.lotteryTicketCatalog.findUnique({ where: { id: catalogTicketId } });
    if (!cat) return res.status(404).json({ success: false, error: 'Catalog ticket not found' });

    // Use a stable reference key so we can reuse the game across multiple receive orders
    const ref = `catalog:${catalogTicketId}`;
    let game = await prisma.lotteryGame.findFirst({
      where: { orgId, storeId, gameNumber: ref, deleted: false },
    });
    if (!game) {
      game = await prisma.lotteryGame.create({
        data: {
          orgId, storeId,
          name:         cat.name,
          gameNumber:   ref,
          ticketPrice:  Number(cat.ticketPrice),
          ticketsPerBox: cat.ticketsPerBook,
          state:        cat.state,
          isGlobal:     false,
          active:       true,
        },
      });
    }

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
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateLotterySettings = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { enabled, cashOnly, state, commissionRate, scanRequiredAtShiftEnd } = req.body;
    const settings = await prisma.lotterySettings.upsert({
      where:  { storeId },
      update: {
        ...(enabled                != null && { enabled:                Boolean(enabled) }),
        ...(cashOnly               != null && { cashOnly:               Boolean(cashOnly) }),
        ...(state                  != null && { state }),
        ...(commissionRate         != null && { commissionRate:         Number(commissionRate) }),
        ...(scanRequiredAtShiftEnd != null && { scanRequiredAtShiftEnd: Boolean(scanRequiredAtShiftEnd) }),
      },
      create: {
        orgId, storeId,
        enabled:                enabled                != null ? Boolean(enabled) : true,
        cashOnly:               cashOnly               != null ? Boolean(cashOnly) : false,
        state:                  state                  || null,
        commissionRate:         commissionRate         != null ? Number(commissionRate) : null,
        scanRequiredAtShiftEnd: scanRequiredAtShiftEnd != null ? Boolean(scanRequiredAtShiftEnd) : false,
      },
    });
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
