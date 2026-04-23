/**
 * Shift Controller — Cash drawer open/close management
 *
 * Routes:
 *   GET  /api/pos-terminal/shift/active        → getActiveShift
 *   POST /api/pos-terminal/shift/open          → openShift
 *   POST /api/pos-terminal/shift/:id/close     → closeShift
 *   POST /api/pos-terminal/shift/:id/drop      → addCashDrop
 *   POST /api/pos-terminal/shift/:id/payout    → addPayout
 *   GET  /api/pos-terminal/shift/:id/report    → getShiftReport
 *   GET  /api/pos-terminal/shifts              → listShifts
 *   GET  /api/pos-terminal/payouts             → listPayouts
 *   GET  /api/pos-terminal/cash-drops          → listCashDrops
 */

import prisma from '../config/postgres.js';
import { nanoid } from 'nanoid';

const getOrgId = (req) => req.orgId || req.user?.orgId;

// ── GET /shift/active ─────────────────────────────────────────────────────
export const getActiveShift = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const { storeId } = req.query;

    const shift = await prisma.shift.findFirst({
      where:   { orgId, storeId, status: 'open' },
      include: { drops: { orderBy: { createdAt: 'asc' } }, payouts: { orderBy: { createdAt: 'asc' } } },
      orderBy: { openedAt: 'desc' },
    });

    if (!shift) return res.json({ shift: null });

    // Resolve cashier name
    const cashier = await prisma.user.findUnique({ where: { id: shift.cashierId }, select: { name: true } });

    res.json({
      shift: {
        ...shift,
        cashierName:   cashier?.name || 'Unknown',
        openingAmount: Number(shift.openingAmount),
        drops:   shift.drops.map(d => ({ ...d, amount: Number(d.amount) })),
        payouts: shift.payouts.map(p => ({ ...p, amount: Number(p.amount) })),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /shift/open ──────────────────────────────────────────────────────
export const openShift = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { storeId, stationId, openingAmount, openingDenominations, openingNote, cashierId } = req.body;

    if (!storeId)           return res.status(400).json({ error: 'storeId required' });
    if (openingAmount == null) return res.status(400).json({ error: 'openingAmount required' });

    // Guard: only one open shift per store at a time
    const existing = await prisma.shift.findFirst({ where: { orgId, storeId, status: 'open' } });
    if (existing) {
      return res.status(409).json({
        error: 'A shift is already open for this store',
        shiftId: existing.id,
        openedAt: existing.openedAt,
      });
    }

    // Back-office open-on-behalf: manager can supply a specific cashierId.
    // Validate that user belongs to this org. Defaults to the caller (the
    // cashier themselves when called from cashier-app).
    let effectiveCashierId = req.user.id;
    if (cashierId && cashierId !== req.user.id) {
      const target = await prisma.user.findFirst({ where: { id: cashierId, orgId } });
      if (!target) return res.status(400).json({ error: 'Invalid cashierId' });
      effectiveCashierId = target.id;
    }

    const shift = await prisma.shift.create({
      data: {
        id:                   nanoid(),
        orgId,
        storeId,
        stationId:            stationId || null,
        cashierId:            effectiveCashierId,
        openingAmount:        parseFloat(openingAmount),
        openingDenominations: openingDenominations || null,
        openingNote:          openingNote || null,
        status:               'open',
      },
    });

    res.status(201).json({ ...shift, openingAmount: Number(shift.openingAmount) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /shift/:id/close ─────────────────────────────────────────────────
export const closeShift = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { id }  = req.params;
    const { closingAmount, closingDenominations, closingNote } = req.body;

    if (closingAmount == null) return res.status(400).json({ error: 'closingAmount required' });

    const shift = await prisma.shift.findFirst({
      where:   { id, orgId },
      include: { drops: true, payouts: true },
    });
    if (!shift)              return res.status(404).json({ error: 'Shift not found' });
    if (shift.status !== 'open') return res.status(400).json({ error: 'Shift is already closed' });

    // ── Calculate totals from transactions in this shift window ───────────
    const txs = await prisma.transaction.findMany({
      where: {
        orgId,
        storeId:   shift.storeId,
        createdAt: { gte: shift.openedAt },
        status:    { in: ['complete', 'refund'] },
      },
      select: { grandTotal: true, tenderLines: true, status: true, changeGiven: true },
    });

    let cashSales   = 0;
    let cashRefunds = 0;

    txs.forEach(tx => {
      const cashLines = (tx.tenderLines || []).filter(l => l.method === 'cash');
      const cashIn    = cashLines.reduce((s, l) => s + Number(l.amount), 0);
      // For cash sales the cashier received cash. Change given reduces what's in drawer.
      if (tx.status === 'complete') {
        cashSales += cashIn - Number(tx.changeGiven || 0);
      }
      if (tx.status === 'refund') {
        const refundCash = cashLines.reduce((s, l) => s + Number(l.amount), 0);
        cashRefunds += refundCash;
      }
    });

    const cashDropsTotal = shift.drops.reduce((s, d) => s + Number(d.amount), 0);
    const payoutsTotal   = shift.payouts.reduce((s, p) => s + Number(p.amount), 0);

    const expectedAmount = Number(shift.openingAmount) + cashSales - cashRefunds - cashDropsTotal - payoutsTotal;
    const variance       = parseFloat(closingAmount) - expectedAmount;

    const closed = await prisma.shift.update({
      where: { id },
      data: {
        status:               'closed',
        closedAt:             new Date(),
        closedById:           req.user.id,
        closingAmount:        parseFloat(closingAmount),
        closingDenominations: closingDenominations || null,
        closingNote:          closingNote || null,
        expectedAmount:       Math.round(expectedAmount * 10000) / 10000,
        variance:             Math.round(variance * 10000) / 10000,
        cashSales:            Math.round(cashSales * 10000) / 10000,
        cashRefunds:          Math.round(cashRefunds * 10000) / 10000,
        cashDropsTotal:       Math.round(cashDropsTotal * 10000) / 10000,
        payoutsTotal:         Math.round(payoutsTotal * 10000) / 10000,
      },
    });

    res.json({
      ...closed,
      openingAmount:  Number(closed.openingAmount),
      closingAmount:  Number(closed.closingAmount),
      expectedAmount: Number(closed.expectedAmount),
      variance:       Number(closed.variance),
      cashSales,
      cashRefunds,
      cashDropsTotal,
      payoutsTotal,
      transactionCount: txs.filter(t => t.status === 'complete').length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /shift/:id/drop ─────────────────────────────────────────────────
export const addCashDrop = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { id }           = req.params;
    const { amount, note } = req.body;

    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'amount must be > 0' });

    const shift = await prisma.shift.findFirst({ where: { id, orgId, status: 'open' } });
    if (!shift) return res.status(404).json({ error: 'Active shift not found' });

    const drop = await prisma.cashDrop.create({
      data: {
        id:          nanoid(),
        orgId,
        shiftId:     id,
        amount:      parseFloat(amount),
        note:        note || null,
        createdById: req.user.id,
      },
    });

    res.status(201).json({ ...drop, amount: Number(drop.amount) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /shift/:id/payout ────────────────────────────────────────────────
export const addPayout = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const { amount, recipient, note, vendorId, payoutType } = req.body;

    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'amount must be > 0' });

    const shift = await prisma.shift.findFirst({ where: { id, orgId, status: 'open' } });
    if (!shift) return res.status(404).json({ error: 'Active shift not found' });

    const payout = await prisma.cashPayout.create({
      data: {
        id:          nanoid(),
        orgId,
        shiftId:     id,
        amount:      parseFloat(amount),
        recipient:   recipient || null,
        vendorId:    vendorId ? parseInt(vendorId) : null,
        payoutType:  payoutType || null,
        note:        note || null,
        createdById: req.user.id,
      },
    });

    res.status(201).json({ ...payout, amount: Number(payout.amount) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /shift/:id/report ────────────────────────────────────────────────
export const getShiftReport = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { id }  = req.params;

    const shift = await prisma.shift.findFirst({
      where:   { id, orgId },
      include: { drops: { orderBy: { createdAt: 'asc' } }, payouts: { orderBy: { createdAt: 'asc' } } },
    });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    const [cashier, closer] = await Promise.all([
      prisma.user.findUnique({ where: { id: shift.cashierId }, select: { name: true } }),
      shift.closedById ? prisma.user.findUnique({ where: { id: shift.closedById }, select: { name: true } }) : null,
    ]);

    const resolveUsers = async (items) => {
      const ids = [...new Set(items.map(i => i.createdById).filter(Boolean))];
      if (!ids.length) return {};
      const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      return Object.fromEntries(users.map(u => [u.id, u.name]));
    };

    const userMap = await resolveUsers([...shift.drops, ...shift.payouts]);

    res.json({
      ...shift,
      cashierName:    cashier?.name  || 'Unknown',
      closedByName:   closer?.name   || null,
      openingAmount:  Number(shift.openingAmount),
      closingAmount:  shift.closingAmount  ? Number(shift.closingAmount)  : null,
      expectedAmount: shift.expectedAmount ? Number(shift.expectedAmount) : null,
      variance:       shift.variance       ? Number(shift.variance)       : null,
      cashSales:      shift.cashSales      ? Number(shift.cashSales)      : null,
      cashRefunds:    shift.cashRefunds    ? Number(shift.cashRefunds)    : null,
      cashDropsTotal: shift.cashDropsTotal ? Number(shift.cashDropsTotal) : null,
      payoutsTotal:   shift.payoutsTotal   ? Number(shift.payoutsTotal)   : null,
      drops:   shift.drops.map(d => ({ ...d, amount: Number(d.amount), createdByName: userMap[d.createdById] || '' })),
      payouts: shift.payouts.map(p => ({ ...p, amount: Number(p.amount), createdByName: userMap[p.createdById] || '' })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /shifts ───────────────────────────────────────────────────────────
export const listShifts = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { storeId, dateFrom, dateTo, status, limit = 30 } = req.query;

    const where = { orgId };
    if (storeId) where.storeId = storeId;
    if (status)  where.status  = status;
    if (dateFrom || dateTo) {
      where.openedAt = {};
      if (dateFrom) { const d = new Date(dateFrom); where.openedAt.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
      if (dateTo)   { const d = new Date(dateTo);   where.openedAt.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
    }

    const shifts = await prisma.shift.findMany({
      where,
      orderBy:  { openedAt: 'desc' },
      take:     Math.min(parseInt(limit) || 30, 200),
      include:  { drops: { select: { amount: true } }, payouts: { select: { amount: true } } },
    });

    const cashierIds = [...new Set(shifts.map(s => s.cashierId).filter(Boolean))];
    const stationIds = [...new Set(shifts.map(s => s.stationId).filter(Boolean))];
    const [users, stations] = await Promise.all([
      cashierIds.length ? prisma.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, name: true } }) : [],
      stationIds.length ? prisma.station.findMany({ where: { id: { in: stationIds } }, select: { id: true, name: true } }) : [],
    ]);
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
    const stationMap = Object.fromEntries(stations.map(s => [s.id, s.name]));

    // Fetch transactions for the same period to compute tender breakdown per shift
    const txWhere = { orgId, status: 'complete' };
    if (storeId) txWhere.storeId = storeId;
    if (dateFrom || dateTo) {
      txWhere.createdAt = {};
      if (dateFrom) { const d = new Date(dateFrom); txWhere.createdAt.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
      if (dateTo)   { const d = new Date(dateTo);   txWhere.createdAt.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
    }

    const transactions = await prisma.transaction.findMany({
      where: txWhere,
      select: { grandTotal: true, taxTotal: true, tenderLines: true, stationId: true, createdAt: true },
    });

    // Build per-shift sales summary
    const shiftSalesMap = {};
    for (const s of shifts) {
      const openT = new Date(s.openedAt).getTime();
      const closeT = s.closedAt ? new Date(s.closedAt).getTime() : Date.now();
      const key = s.id;
      shiftSalesMap[key] = { totalSales: 0, totalTax: 0, cashAmount: 0, cardAmount: 0, ebtAmount: 0, otherAmount: 0, txCount: 0 };

      for (const tx of transactions) {
        const txTime = new Date(tx.createdAt).getTime();
        const matchStation = !s.stationId || !tx.stationId || s.stationId === tx.stationId;
        if (txTime >= openT && txTime <= closeT && matchStation) {
          const sm = shiftSalesMap[key];
          sm.totalSales += Number(tx.grandTotal) || 0;
          sm.totalTax += Number(tx.taxTotal) || 0;
          sm.txCount += 1;
          const tenders = Array.isArray(tx.tenderLines) ? tx.tenderLines : [];
          for (const t of tenders) {
            const amt = Number(t.amount) || 0;
            const m = (t.method || '').toLowerCase();
            if (m === 'cash') sm.cashAmount += amt;
            else if (['card', 'credit', 'debit'].includes(m)) sm.cardAmount += amt;
            else if (m === 'ebt') sm.ebtAmount += amt;
            else sm.otherAmount += amt;
          }
        }
      }
    }

    const r2 = (n) => Math.round(n * 100) / 100;

    res.json({
      shifts: shifts.map(s => {
        const sales = shiftSalesMap[s.id] || {};
        return {
          ...s,
          cashierName:    userMap[s.cashierId] || 'Unknown',
          stationName:    stationMap[s.stationId] || s.stationId || 'Unassigned',
          openingAmount:  Number(s.openingAmount),
          closingAmount:  s.closingAmount  ? Number(s.closingAmount)  : null,
          expectedAmount: s.expectedAmount ? Number(s.expectedAmount) : null,
          variance:       s.variance       ? Number(s.variance)       : null,
          cashSales:      s.cashSales ? Number(s.cashSales) : r2(sales.cashAmount),
          cashRefunds:    s.cashRefunds ? Number(s.cashRefunds) : 0,
          dropsCount:     s.drops.length,
          payoutsCount:   s.payouts.length,
          cashDropsTotal: s.cashDropsTotal ? Number(s.cashDropsTotal) : r2(s.drops.reduce((sum, d) => sum + Number(d.amount), 0)),
          payoutsTotal:   s.payoutsTotal ? Number(s.payoutsTotal) : r2(s.payouts.reduce((sum, p) => sum + Number(p.amount), 0)),
          // Tender breakdown
          salesSummary: {
            totalSales: r2(sales.totalSales || 0),
            totalTax:   r2(sales.totalTax || 0),
            txCount:    sales.txCount || 0,
            cash:       r2(sales.cashAmount || 0),
            card:       r2(sales.cardAmount || 0),
            ebt:        r2(sales.ebtAmount || 0),
            other:      r2(sales.otherAmount || 0),
          },
          drops:   undefined,
          payouts: undefined,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /payouts ──────────────────────────────────────────────────────────────
// List all payouts across shifts for back-office reporting
export const listPayouts = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { storeId, dateFrom, dateTo, payoutType, vendorId, limit = 100 } = req.query;

    const where = { orgId };
    // CashPayout has no direct storeId column — scope via the parent Shift
    if (storeId)    where.shift      = { storeId };
    if (payoutType) where.payoutType = payoutType;
    if (vendorId)   where.vendorId   = parseInt(vendorId);
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) { const d = new Date(dateFrom); where.createdAt.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
      if (dateTo)   { const d = new Date(dateTo);   where.createdAt.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
    }

    const payouts = await prisma.cashPayout.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit) || 100, 500),
      include: { shift: { select: { storeId: true } } },
    });

    // Resolve cashier names
    const userIds = [...new Set(payouts.map(p => p.createdById).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

    // Bug B4 fix: summary treats ONLY cash payouts (which are real expenses
    // out of the drawer) as expenses. Cash drops (register pickups) are a
    // separate movement — they do NOT count as expenses and are shown in
    // their own endpoint (/cash-drops). The EoD report presents both
    // separately.
    const totalExpense     = payouts.filter(p => p.payoutType !== 'merchandise').reduce((s, p) => s + Number(p.amount), 0);
    const totalMerchandise = payouts.filter(p => p.payoutType === 'merchandise').reduce((s, p) => s + Number(p.amount), 0);

    res.json({
      payouts: payouts.map(p => ({
        ...p,
        amount:       Number(p.amount),
        cashierName:  userMap[p.createdById] || '',
        storeId:      p.shift?.storeId || storeId,
        shift:        undefined,
      })),
      summary: {
        total:            totalExpense + totalMerchandise,
        totalExpense,
        totalMerchandise,
        count:            payouts.length,
        // Explicit clarification: cash drops are NOT included here
        note: 'Summary includes only cash payouts (expenses + merchandise). Cash drops/pickups are separate — see /cash-drops.',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /cash-drops ───────────────────────────────────────────────────────────
export const listCashDrops = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { storeId, dateFrom, dateTo, limit = 100 } = req.query;

    const where = { orgId };
    // CashDrop has no direct storeId column — scope via the parent Shift
    if (storeId) where.shift = { storeId };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) { const d = new Date(dateFrom); where.createdAt.gte = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
      if (dateTo)   { const d = new Date(dateTo);   where.createdAt.lte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
    }

    const drops = await prisma.cashDrop.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit) || 100, 500),
    });

    const userIds = [...new Set(drops.map(d => d.createdById).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

    res.json({
      drops: drops.map(d => ({ ...d, amount: Number(d.amount), cashierName: userMap[d.createdById] || '' })),
      summary: { total: drops.reduce((s, d) => s + Number(d.amount), 0), count: drops.length },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PUT /api/pos-terminal/shift/:id/balance — Back-office cash adjustment ────
// Allows managers to edit the closing cash amount after a shift is closed.
// Recalculates variance. Only works on closed shifts.
export const updateShiftBalance = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const { closingAmount, closingNote } = req.body;

    if (closingAmount == null) return res.status(400).json({ error: 'closingAmount is required' });

    const shift = await prisma.shift.findFirst({ where: { id, orgId } });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    if (shift.status !== 'closed') return res.status(400).json({ error: 'Can only adjust closed shifts' });

    const newClosing = parseFloat(closingAmount);
    const expected = shift.expectedAmount ? Number(shift.expectedAmount) : 0;
    const newVariance = Math.round((newClosing - expected) * 10000) / 10000;

    const updated = await prisma.shift.update({
      where: { id },
      data: {
        closingAmount: newClosing,
        variance: newVariance,
        ...(closingNote !== undefined ? { closingNote } : {}),
      },
    });

    res.json({
      success: true,
      shift: {
        ...updated,
        openingAmount:  Number(updated.openingAmount),
        closingAmount:  Number(updated.closingAmount),
        expectedAmount: updated.expectedAmount ? Number(updated.expectedAmount) : null,
        variance:       Number(updated.variance),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
