/**
 * fuelController.js
 *
 * Fuel module — gas station mode.
 *   Types        → fuel grades + per-gallon price (3-decimal precision)
 *   Settings     → enable flag, default entry mode, default fuel type, cash-only
 *   Transactions → individual fuel sale / refund records
 *   Report       → date-range aggregate by type with gallons + amount
 *   Dashboard    → today / month KPIs
 */

import prisma from '../config/postgres.js';

const getOrgId = (req) => req.orgId || req.user?.orgId;
const getStore = (req) => req.headers['x-store-id'] || req.storeId || req.query.storeId;

const num = (v) => (v != null && v !== '' ? Number(v) : null);

// ══════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════

export const getFuelTypes = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const types = await prisma.fuelType.findMany({
      where:   { orgId, storeId, deleted: false },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: types });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createFuelType = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const { name, gradeLabel, pricePerGallon, color, isDefault, isTaxable, taxRate, sortOrder } = req.body;
    if (!name || pricePerGallon == null) {
      return res.status(400).json({ success: false, error: 'name and pricePerGallon are required' });
    }
    const price = Number(pricePerGallon);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ success: false, error: 'pricePerGallon must be a positive number' });
    }
    // If isDefault=true, clear any existing default in this store
    if (isDefault) {
      await prisma.fuelType.updateMany({
        where: { orgId, storeId, isDefault: true },
        data:  { isDefault: false },
      });
    }
    const t = await prisma.fuelType.create({
      data: {
        orgId, storeId,
        name:           String(name).trim(),
        gradeLabel:     gradeLabel ? String(gradeLabel).trim() : null,
        pricePerGallon: price,
        color:          color || null,
        isDefault:      Boolean(isDefault),
        isTaxable:      Boolean(isTaxable),
        taxRate:        taxRate != null ? Number(taxRate) : null,
        sortOrder:      Number(sortOrder) || 0,
      },
    });
    res.json({ success: true, data: t });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateFuelType = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    const t = await prisma.fuelType.findFirst({ where: { id, orgId, storeId } });
    if (!t) return res.status(404).json({ success: false, error: 'Fuel type not found' });

    const { name, gradeLabel, pricePerGallon, color, isDefault, isTaxable, taxRate, sortOrder, active } = req.body;

    if (pricePerGallon != null) {
      const price = Number(pricePerGallon);
      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({ success: false, error: 'pricePerGallon must be a positive number' });
      }
    }

    if (isDefault === true) {
      await prisma.fuelType.updateMany({
        where: { orgId, storeId, isDefault: true, NOT: { id } },
        data:  { isDefault: false },
      });
    }

    const updated = await prisma.fuelType.update({
      where: { id },
      data: {
        ...(name           != null && { name:           String(name).trim() }),
        ...(gradeLabel     !== undefined && { gradeLabel: gradeLabel ? String(gradeLabel).trim() : null }),
        ...(pricePerGallon != null && { pricePerGallon: Number(pricePerGallon) }),
        ...(color          !== undefined && { color }),
        ...(isDefault      != null && { isDefault: Boolean(isDefault) }),
        ...(isTaxable      != null && { isTaxable: Boolean(isTaxable) }),
        ...(taxRate        !== undefined && { taxRate: taxRate != null ? Number(taxRate) : null }),
        ...(sortOrder      != null && { sortOrder: Number(sortOrder) }),
        ...(active         != null && { active: Boolean(active) }),
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteFuelType = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    await prisma.fuelType.updateMany({
      where: { id, orgId, storeId },
      data:  { deleted: true, active: false, isDefault: false },
    });
    // Also clear it from FuelSettings.defaultFuelTypeId if set
    await prisma.fuelSettings.updateMany({
      where: { orgId, storeId, defaultFuelTypeId: id },
      data:  { defaultFuelTypeId: null },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════════════════

const DEFAULT_SETTINGS = {
  enabled:           false,
  cashOnly:          false,
  allowRefunds:      true,
  defaultEntryMode:  'amount',
  defaultFuelTypeId: null,
};

export const getFuelSettings = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const s = await prisma.fuelSettings.findUnique({ where: { storeId } });
    res.json({ success: true, data: s || { ...DEFAULT_SETTINGS, orgId, storeId } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateFuelSettings = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const { enabled, cashOnly, allowRefunds, defaultEntryMode, defaultFuelTypeId } = req.body;
    const data = {
      ...(enabled          != null && { enabled:          Boolean(enabled) }),
      ...(cashOnly         != null && { cashOnly:         Boolean(cashOnly) }),
      ...(allowRefunds     != null && { allowRefunds:     Boolean(allowRefunds) }),
      ...(defaultEntryMode != null && { defaultEntryMode: defaultEntryMode === 'gallons' ? 'gallons' : 'amount' }),
      ...(defaultFuelTypeId !== undefined && { defaultFuelTypeId: defaultFuelTypeId || null }),
    };
    const settings = await prisma.fuelSettings.upsert({
      where:  { storeId },
      update: data,
      create: { orgId, storeId, ...DEFAULT_SETTINGS, ...data },
    });
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ══════════════════════════════════════════════════════════════════════════

export const listFuelTransactions = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { from, to, fuelTypeId, type, shiftId, cashierId, limit = 200 } = req.query;

    const where = { orgId, ...(storeId && { storeId }) };
    if (fuelTypeId) where.fuelTypeId = fuelTypeId;
    if (type)       where.type = type;
    if (shiftId)    where.shiftId = shiftId;
    if (cashierId)  where.cashierId = cashierId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to)   where.createdAt.lte = new Date(to);
    }

    const txs = await prisma.fuelTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    Math.min(Number(limit) || 200, 1000),
      include: { fuelType: { select: { id: true, name: true, gradeLabel: true, color: true } } },
    });
    res.json({ success: true, data: txs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// REPORTS — date range aggregate by type
// ══════════════════════════════════════════════════════════════════════════

export const getFuelReport = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });

    const { from, to } = req.query;
    const fromDate = from ? new Date(from + 'T00:00:00') : new Date(new Date().setDate(new Date().getDate() - 30));
    const toDate   = to   ? new Date(to   + 'T23:59:59') : new Date();

    const txs = await prisma.fuelTransaction.findMany({
      where: { orgId, storeId, createdAt: { gte: fromDate, lte: toDate } },
      include: { fuelType: { select: { id: true, name: true, gradeLabel: true, color: true } } },
    });

    // Group by fuelType + sale/refund
    const byType = new Map();
    let totalGallons = 0, totalAmount = 0, totalSalesGallons = 0, totalSalesAmount = 0, totalRefundsGallons = 0, totalRefundsAmount = 0;
    let txCount = 0, salesCount = 0, refundsCount = 0;

    for (const t of txs) {
      const id = t.fuelTypeId || 'unknown';
      if (!byType.has(id)) {
        byType.set(id, {
          fuelTypeId: id,
          name:       t.fuelType?.name || t.fuelTypeName || 'Unknown',
          gradeLabel: t.fuelType?.gradeLabel || null,
          color:      t.fuelType?.color || null,
          salesGallons: 0, salesAmount: 0, salesCount: 0,
          refundsGallons: 0, refundsAmount: 0, refundsCount: 0,
          netGallons: 0,    netAmount: 0,
          avgPrice:   0,
        });
      }
      const row = byType.get(id);
      const gal = Number(t.gallons);
      const amt = Number(t.amount);
      if (t.type === 'refund') {
        row.refundsGallons += gal;
        row.refundsAmount  += amt;
        row.refundsCount   += 1;
        totalRefundsGallons += gal; totalRefundsAmount += amt; refundsCount += 1;
      } else {
        row.salesGallons   += gal;
        row.salesAmount    += amt;
        row.salesCount     += 1;
        totalSalesGallons  += gal; totalSalesAmount  += amt; salesCount  += 1;
      }
      txCount += 1;
    }

    const rows = Array.from(byType.values()).map(r => {
      r.netGallons = r.salesGallons - r.refundsGallons;
      r.netAmount  = r.salesAmount  - r.refundsAmount;
      r.avgPrice   = r.netGallons > 0 ? r.netAmount / r.netGallons : 0;
      return r;
    }).sort((a, b) => b.netAmount - a.netAmount);

    totalGallons = totalSalesGallons - totalRefundsGallons;
    totalAmount  = totalSalesAmount  - totalRefundsAmount;

    res.json({
      success: true,
      data: {
        from:   fromDate.toISOString(),
        to:     toDate.toISOString(),
        byType: rows,
        totals: {
          gallons:        totalGallons,
          amount:         totalAmount,
          salesGallons:   totalSalesGallons,
          salesAmount:    totalSalesAmount,
          refundsGallons: totalRefundsGallons,
          refundsAmount:  totalRefundsAmount,
          txCount,
          salesCount,
          refundsCount,
          avgPrice:       totalGallons > 0 ? totalAmount / totalGallons : 0,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getFuelDashboard = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });

    const now      = new Date();
    const startOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayTxs, monthTxs, types] = await Promise.all([
      prisma.fuelTransaction.findMany({
        where: { orgId, storeId, createdAt: { gte: startOfDay } },
        include: { fuelType: { select: { id: true, name: true, color: true } } },
      }),
      prisma.fuelTransaction.findMany({
        where: { orgId, storeId, createdAt: { gte: startOfMonth } },
        select: { type: true, gallons: true, amount: true },
      }),
      prisma.fuelType.count({ where: { orgId, storeId, deleted: false, active: true } }),
    ]);

    const sumNet = (txs) => {
      let g = 0, a = 0;
      for (const t of txs) {
        const sign = t.type === 'refund' ? -1 : 1;
        g += sign * Number(t.gallons);
        a += sign * Number(t.amount);
      }
      return { gallons: g, amount: a };
    };

    // Today by type breakdown
    const todayByType = new Map();
    for (const t of todayTxs) {
      const id = t.fuelTypeId || 'unknown';
      if (!todayByType.has(id)) {
        todayByType.set(id, {
          fuelTypeId: id,
          name:       t.fuelType?.name || t.fuelTypeName,
          color:      t.fuelType?.color || null,
          gallons:    0, amount: 0,
        });
      }
      const r = todayByType.get(id);
      const sign = t.type === 'refund' ? -1 : 1;
      r.gallons += sign * Number(t.gallons);
      r.amount  += sign * Number(t.amount);
    }

    res.json({
      success: true,
      data: {
        today:      sumNet(todayTxs),
        month:      sumNet(monthTxs),
        todayByType: Array.from(todayByType.values()),
        activeTypes: types,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
