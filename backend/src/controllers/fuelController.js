/**
 * fuelController.js
 *
 * Fuel module — gas station mode.
 *   Types        → fuel grades + per-gallon price (3-decimal precision)
 *   Settings     → enable flag, default entry mode, cash-only, reconciliation cadence
 *   Transactions → individual fuel sale / refund records
 *   Report       → date-range aggregate by type with gallons + amount + P&L
 *   Dashboard    → today / month KPIs
 *
 *   Inventory (Session 42):
 *   Tanks        → physical underground storage tanks (per-grade, multi-tank)
 *   ManifoldGrps → tanks sharing a level (sales deduct proportionally)
 *   Deliveries   → BOL entries that create FIFO cost layers
 *   StickReadings→ manual measurements vs. software-expected → variance report
 *   BlendConfigs → middle-grade dispenser blending (87+93 → 89)
 */

import prisma from '../config/postgres.js';
import {
  getTankLevel,
  getAllTankLevels,
  recordDelivery,
  recordStickReading,
  drawFromTank,
  checkDeliveryCostVariance,
} from '../services/fuelInventory.js';

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
    const {
      enabled, cashOnly, allowRefunds, defaultEntryMode, defaultFuelTypeId,
      reconciliationCadence, varianceAlertThreshold, blendingEnabled,
      pumpTrackingEnabled, deliveryCostVarianceThreshold,
    } = req.body;
    const data = {
      ...(enabled          != null && { enabled:          Boolean(enabled) }),
      ...(cashOnly         != null && { cashOnly:         Boolean(cashOnly) }),
      ...(allowRefunds     != null && { allowRefunds:     Boolean(allowRefunds) }),
      ...(defaultEntryMode != null && { defaultEntryMode: defaultEntryMode === 'gallons' ? 'gallons' : 'amount' }),
      ...(defaultFuelTypeId !== undefined && { defaultFuelTypeId: defaultFuelTypeId || null }),
      ...(reconciliationCadence != null && { reconciliationCadence: ['shift', 'daily', 'weekly', 'on_demand'].includes(reconciliationCadence) ? reconciliationCadence : 'shift' }),
      ...(varianceAlertThreshold != null && { varianceAlertThreshold: Number(varianceAlertThreshold) }),
      ...(blendingEnabled != null && { blendingEnabled: Boolean(blendingEnabled) }),
      ...(pumpTrackingEnabled != null && { pumpTrackingEnabled: Boolean(pumpTrackingEnabled) }),
      ...(deliveryCostVarianceThreshold != null && { deliveryCostVarianceThreshold: Number(deliveryCostVarianceThreshold) }),
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

// ══════════════════════════════════════════════════════════════════════════
// TANKS
// ══════════════════════════════════════════════════════════════════════════

export const listFuelTanks = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });

    const tanks = await prisma.fuelTank.findMany({
      where:   { orgId, storeId, deleted: false },
      orderBy: [{ fuelTypeId: 'asc' }, { name: 'asc' }],
      include: {
        fuelType:      { select: { id: true, name: true, gradeLabel: true, color: true, pricePerGallon: true } },
        manifoldGroup: { select: { id: true, name: true, drainMode: true } },
      },
    });

    // Attach current level to each tank from FIFO layers
    const levels = await getAllTankLevels(storeId);
    const rows = tanks.map(t => ({
      ...t,
      currentLevelGal: levels.get(t.id) || 0,
      fillPct: Number(t.capacityGal) > 0
        ? Math.max(0, Math.min(100, ((levels.get(t.id) || 0) / Number(t.capacityGal)) * 100))
        : 0,
    }));

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createFuelTank = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const {
      name, tankCode, fuelTypeId, capacityGal,
      diameterInches, lengthInches,
      topology, manifoldGroupId, isPrimary,
    } = req.body;
    if (!name || !fuelTypeId || capacityGal == null) {
      return res.status(400).json({ success: false, error: 'name, fuelTypeId, capacityGal required' });
    }
    const cap = Number(capacityGal);
    if (!Number.isFinite(cap) || cap <= 0) {
      return res.status(400).json({ success: false, error: 'capacityGal must be > 0' });
    }
    // If this tank is marked primary, clear any other primary for the same grade
    if (isPrimary) {
      await prisma.fuelTank.updateMany({
        where: { orgId, storeId, fuelTypeId, isPrimary: true },
        data:  { isPrimary: false },
      });
    }
    const t = await prisma.fuelTank.create({
      data: {
        orgId, storeId,
        name:     String(name).trim(),
        tankCode: tankCode ? String(tankCode).trim() : null,
        fuelTypeId,
        capacityGal: cap,
        diameterInches: num(diameterInches),
        lengthInches:   num(lengthInches),
        topology:        topology || 'independent',
        manifoldGroupId: manifoldGroupId || null,
        isPrimary:       Boolean(isPrimary),
      },
    });
    res.json({ success: true, data: t });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateFuelTank = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const tank = await prisma.fuelTank.findFirst({ where: { id, orgId, storeId } });
    if (!tank) return res.status(404).json({ success: false, error: 'Tank not found' });

    const allowed = ['name', 'tankCode', 'capacityGal', 'diameterInches', 'lengthInches',
                     'topology', 'manifoldGroupId', 'isPrimary', 'active'];
    const data = {};
    for (const k of allowed) {
      if (req.body[k] === undefined) continue;
      if (['capacityGal', 'diameterInches', 'lengthInches'].includes(k)) data[k] = num(req.body[k]);
      else data[k] = req.body[k];
    }
    // If becoming primary, clear other primaries in the same grade
    if (data.isPrimary === true) {
      await prisma.fuelTank.updateMany({
        where: { orgId, storeId, fuelTypeId: tank.fuelTypeId, isPrimary: true, id: { not: id } },
        data:  { isPrimary: false },
      });
    }
    const updated = await prisma.fuelTank.update({ where: { id }, data });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteFuelTank = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const tank = await prisma.fuelTank.findFirst({ where: { id, orgId, storeId } });
    if (!tank) return res.status(404).json({ success: false, error: 'Tank not found' });
    // Soft delete — keep for historical reporting
    await prisma.fuelTank.update({ where: { id }, data: { deleted: true, active: false } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// MANIFOLD GROUPS
// ══════════════════════════════════════════════════════════════════════════

export const listManifoldGroups = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const groups = await prisma.fuelManifoldGroup.findMany({
      where:   { orgId, storeId, deleted: false },
      include: { tanks: { where: { deleted: false }, select: { id: true, name: true, fuelTypeId: true, capacityGal: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: groups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createManifoldGroup = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const { name, drainMode } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const g = await prisma.fuelManifoldGroup.create({
      data: { orgId, storeId, name: String(name).trim(), drainMode: drainMode || 'equal' },
    });
    res.json({ success: true, data: g });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateManifoldGroup = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const group = await prisma.fuelManifoldGroup.findFirst({ where: { id, orgId, storeId } });
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    const updated = await prisma.fuelManifoldGroup.update({
      where: { id },
      data: {
        name:      req.body.name ?? group.name,
        drainMode: req.body.drainMode ?? group.drainMode,
        active:    req.body.active ?? group.active,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteManifoldGroup = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    // Detach tanks first, then soft-delete
    await prisma.fuelTank.updateMany({
      where: { manifoldGroupId: id, orgId, storeId },
      data:  { manifoldGroupId: null, topology: 'independent' },
    });
    await prisma.fuelManifoldGroup.update({ where: { id }, data: { deleted: true, active: false } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// DELIVERIES — multi-tank split supported
// ══════════════════════════════════════════════════════════════════════════

export const listDeliveries = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const { from, to, limit } = req.query;
    const where = { orgId, storeId };
    if (from || to) {
      where.deliveryDate = {};
      if (from) where.deliveryDate.gte = new Date(from + 'T00:00:00');
      if (to)   where.deliveryDate.lte = new Date(to   + 'T23:59:59');
    }
    const deliveries = await prisma.fuelDelivery.findMany({
      where,
      orderBy: { deliveryDate: 'desc' },
      take: Math.min(Number(limit) || 100, 500),
      include: {
        items: {
          include: { tank: { select: { id: true, name: true, fuelTypeId: true, fuelType: { select: { name: true, gradeLabel: true, color: true } } } } },
        },
      },
    });
    res.json({ success: true, data: deliveries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createDelivery = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const { deliveryDate, supplier, bolNumber, notes, items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one delivery item (tank + gallons + price) is required.' });
    }
    // Validate every item
    for (const it of items) {
      if (!it.tankId || !Number.isFinite(Number(it.gallonsReceived)) || !Number.isFinite(Number(it.pricePerGallon))) {
        return res.status(400).json({ success: false, error: 'Each delivery item requires tankId, gallonsReceived, pricePerGallon.' });
      }
      if (Number(it.gallonsReceived) <= 0 || Number(it.pricePerGallon) < 0) {
        return res.status(400).json({ success: false, error: 'gallonsReceived must be > 0 and pricePerGallon >= 0.' });
      }
      // Ownership check — tank must belong to this store
      const tank = await prisma.fuelTank.findFirst({ where: { id: it.tankId, orgId, storeId } });
      if (!tank) return res.status(400).json({ success: false, error: `Tank ${it.tankId} not found in this store.` });
    }
    const delivery = await recordDelivery({
      orgId, storeId, deliveryDate, supplier, bolNumber, notes,
      createdById: req.user?.id || null,
      items,
    });

    // V1.5: compute delivery cost variance per line vs last-3-delivery avg
    // for the same fuel type. Flag anything exceeding the store threshold.
    const settings = await prisma.fuelSettings.findUnique({ where: { storeId } });
    const thresholdPct = Number(settings?.deliveryCostVarianceThreshold || 5);
    const varianceWarnings = [];
    for (const it of items) {
      const tank = await prisma.fuelTank.findUnique({ where: { id: it.tankId }, select: { fuelTypeId: true, name: true } });
      if (!tank) continue;
      const variance = await checkDeliveryCostVariance({
        orgId, storeId,
        fuelTypeId: tank.fuelTypeId,
        newPricePerGallon: Number(it.pricePerGallon),
      });
      if (variance && Math.abs(variance.variancePct) > thresholdPct) {
        varianceWarnings.push({
          tankId: it.tankId,
          tankName: tank.name,
          newPricePerGallon: Number(it.pricePerGallon),
          avgPricePerGallon: variance.avgPricePerGallon,
          variancePct: variance.variancePct,
          thresholdPct,
        });
      }
    }

    // Re-fetch with items for response convenience
    const full = await prisma.fuelDelivery.findUnique({
      where: { id: delivery.id },
      include: { items: { include: { tank: { select: { id: true, name: true } } } } },
    });
    res.json({ success: true, data: full, varianceWarnings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteDelivery = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const d = await prisma.fuelDelivery.findFirst({ where: { id, orgId, storeId } });
    if (!d) return res.status(404).json({ success: false, error: 'Delivery not found' });
    // Hard-delete is safer than soft-delete here: FIFO layers must go too.
    // Only allow delete if NO sales have consumed any of the layers yet.
    const consumed = await prisma.fuelDeliveryItem.findFirst({
      where: { deliveryId: id, remainingGallons: { lt: prisma.fuelDeliveryItem.fields?.gallonsReceived } },
    });
    // Prisma raw field compare isn't clean — use findMany and check manually
    const items = await prisma.fuelDeliveryItem.findMany({ where: { deliveryId: id } });
    const anyConsumed = items.some(i => Number(i.remainingGallons) < Number(i.gallonsReceived));
    if (anyConsumed) {
      return res.status(400).json({ success: false, error: 'Cannot delete: some layers have already been consumed by sales. Record a negative delivery or stick-reading adjustment instead.' });
    }
    await prisma.fuelDelivery.delete({ where: { id } }); // cascades items
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// STICK READINGS
// ══════════════════════════════════════════════════════════════════════════

export const listStickReadings = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const { tankId, from, to, limit } = req.query;
    const where = { orgId, storeId };
    if (tankId) where.tankId = tankId;
    if (from || to) {
      where.readingDate = {};
      if (from) where.readingDate.gte = new Date(from + 'T00:00:00');
      if (to)   where.readingDate.lte = new Date(to   + 'T23:59:59');
    }
    const readings = await prisma.fuelStickReading.findMany({
      where,
      orderBy: { readingDate: 'desc' },
      take: Math.min(Number(limit) || 200, 1000),
      include: { tank: { select: { id: true, name: true, fuelType: { select: { name: true, color: true } } } } },
    });
    res.json({ success: true, data: readings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createStickReading = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const { tankId, actualGallons, shiftId, notes } = req.body;
    if (!tankId || actualGallons == null) {
      return res.status(400).json({ success: false, error: 'tankId and actualGallons required' });
    }
    const tank = await prisma.fuelTank.findFirst({ where: { id: tankId, orgId, storeId } });
    if (!tank) return res.status(404).json({ success: false, error: 'Tank not found' });
    const reading = await recordStickReading({
      orgId, storeId, tankId,
      actualGallons: Number(actualGallons),
      shiftId, notes,
      createdById: req.user?.id || null,
    });
    res.json({ success: true, data: reading });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteStickReading = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const r = await prisma.fuelStickReading.findFirst({ where: { id, orgId, storeId } });
    if (!r) return res.status(404).json({ success: false, error: 'Reading not found' });
    await prisma.fuelStickReading.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// BLEND CONFIGS
// ══════════════════════════════════════════════════════════════════════════

export const listBlendConfigs = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const rows = await prisma.fuelBlendConfig.findMany({
      where: { orgId, storeId },
      include: {
        middleFuelType:  { select: { id: true, name: true, gradeLabel: true, color: true } },
        baseFuelType:    { select: { id: true, name: true, gradeLabel: true, color: true } },
        premiumFuelType: { select: { id: true, name: true, gradeLabel: true, color: true } },
      },
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const upsertBlendConfig = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const { middleFuelTypeId, baseFuelTypeId, premiumFuelTypeId, baseRatio, active } = req.body;
    if (!middleFuelTypeId || !baseFuelTypeId || !premiumFuelTypeId || baseRatio == null) {
      return res.status(400).json({ success: false, error: 'middleFuelTypeId, baseFuelTypeId, premiumFuelTypeId, baseRatio required' });
    }
    const ratio = Number(baseRatio);
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      return res.status(400).json({ success: false, error: 'baseRatio must be between 0 and 1' });
    }
    const data = {
      orgId, storeId,
      middleFuelTypeId, baseFuelTypeId, premiumFuelTypeId,
      baseRatio: ratio,
      premiumRatio: 1 - ratio,
      active: active !== false,
    };
    const existing = await prisma.fuelBlendConfig.findFirst({ where: { orgId, storeId, middleFuelTypeId } });
    const saved = existing
      ? await prisma.fuelBlendConfig.update({ where: { id: existing.id }, data })
      : await prisma.fuelBlendConfig.create({ data });
    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteBlendConfig = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const b = await prisma.fuelBlendConfig.findFirst({ where: { id, orgId, storeId } });
    if (!b) return res.status(404).json({ success: false, error: 'Blend config not found' });
    await prisma.fuelBlendConfig.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// INVENTORY STATUS — current tank levels + variance alerts
// ══════════════════════════════════════════════════════════════════════════

export const getInventoryStatus = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });

    const [tanks, settings, latestReadings] = await Promise.all([
      prisma.fuelTank.findMany({
        where:   { orgId, storeId, deleted: false, active: true },
        include: { fuelType: { select: { id: true, name: true, gradeLabel: true, color: true } } },
      }),
      prisma.fuelSettings.findUnique({ where: { storeId } }),
      prisma.fuelStickReading.findMany({
        where:   { orgId, storeId },
        orderBy: { readingDate: 'desc' },
        take:    50,
      }),
    ]);

    const levels = await getAllTankLevels(storeId);
    const threshold = Number(settings?.varianceAlertThreshold || 2.0);

    // Map latest reading per tank for the alert flag
    const latestByTank = new Map();
    for (const r of latestReadings) if (!latestByTank.has(r.tankId)) latestByTank.set(r.tankId, r);

    const rows = tanks.map(t => {
      const current = levels.get(t.id) || 0;
      const capacity = Number(t.capacityGal);
      const fillPct  = capacity > 0 ? Math.max(0, Math.min(100, (current / capacity) * 100)) : 0;
      const lastReading = latestByTank.get(t.id);
      const alerting = lastReading ? Math.abs(Number(lastReading.variancePct)) > threshold : false;
      return {
        tank:  t,
        currentLevelGal: current,
        fillPct,
        lastReading: lastReading || null,
        alerting,
      };
    });

    res.json({
      success: true,
      data: {
        rows,
        threshold,
        cadence: settings?.reconciliationCadence || 'shift',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// TIME-GRANULAR REPORTS — hourly / daily / weekly / monthly / yearly P&L
// ══════════════════════════════════════════════════════════════════════════

const bucketKey = (date, granularity) => {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  switch (granularity) {
    case 'hourly':  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`;
    case 'daily':   return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    case 'weekly': {
      // ISO week start (Mon)
      const dd = new Date(d); const day = dd.getDay() || 7;
      dd.setDate(dd.getDate() - day + 1);
      return `${dd.getFullYear()}-W${pad(Math.floor((dd.getDate() + new Date(dd.getFullYear(), 0, 1).getDay()) / 7))}-${pad(dd.getMonth()+1)}-${pad(dd.getDate())}`;
    }
    case 'monthly': return `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
    case 'yearly':  return `${d.getFullYear()}`;
    default:        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
};

export const getFuelPnlReport = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });

    const { from, to, granularity = 'daily' } = req.query;
    const fromDate = from ? new Date(from + 'T00:00:00') : new Date(new Date().setDate(new Date().getDate() - 30));
    const toDate   = to   ? new Date(to   + 'T23:59:59') : new Date();

    const txs = await prisma.fuelTransaction.findMany({
      where: { orgId, storeId, createdAt: { gte: fromDate, lte: toDate } },
      include: { fuelType: { select: { id: true, name: true, gradeLabel: true, color: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // Per-bucket + per-grade accumulator
    const buckets = new Map(); // key → { bucket, buckets-metrics, byGrade: Map }

    for (const t of txs) {
      const sign = t.type === 'refund' ? -1 : 1;
      const gal = sign * Number(t.gallons);
      const amt = sign * Number(t.amount);
      // COGS from stored FIFO trace — signed (refunds add back)
      let cogs = 0;
      if (Array.isArray(t.fifoLayers)) {
        cogs = sign * t.fifoLayers.reduce((s, l) => s + Number(l.cost || 0), 0);
      }
      const profit = amt - cogs;

      const key = bucketKey(t.createdAt, granularity);
      if (!buckets.has(key)) {
        buckets.set(key, {
          bucket: key,
          gallons: 0, revenue: 0, cogs: 0, profit: 0, txCount: 0,
          byGrade: new Map(),
        });
      }
      const b = buckets.get(key);
      b.gallons += gal;
      b.revenue += amt;
      b.cogs    += cogs;
      b.profit  += profit;
      b.txCount += 1;

      const gradeKey = t.fuelTypeId || 'unknown';
      if (!b.byGrade.has(gradeKey)) {
        b.byGrade.set(gradeKey, {
          fuelTypeId: gradeKey,
          name:  t.fuelType?.name || t.fuelTypeName,
          color: t.fuelType?.color || null,
          gallons: 0, revenue: 0, cogs: 0, profit: 0,
        });
      }
      const g = b.byGrade.get(gradeKey);
      g.gallons += gal;
      g.revenue += amt;
      g.cogs    += cogs;
      g.profit  += profit;
    }

    const rows = Array.from(buckets.values())
      .map(b => ({
        ...b,
        byGrade: Array.from(b.byGrade.values()),
        marginPct: b.revenue > 0 ? (b.profit / b.revenue) * 100 : 0,
        avgPrice:  b.gallons > 0 ? b.revenue / b.gallons : 0,
      }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));

    // Aggregate totals
    const totals = rows.reduce((acc, r) => ({
      gallons: acc.gallons + r.gallons,
      revenue: acc.revenue + r.revenue,
      cogs:    acc.cogs    + r.cogs,
      profit:  acc.profit  + r.profit,
      txCount: acc.txCount + r.txCount,
    }), { gallons: 0, revenue: 0, cogs: 0, profit: 0, txCount: 0 });
    totals.marginPct = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;
    totals.avgPrice  = totals.gallons > 0 ? totals.revenue / totals.gallons : 0;

    res.json({
      success: true,
      data: {
        from: fromDate.toISOString(),
        to:   toDate.toISOString(),
        granularity,
        rows,
        totals,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// FUEL PUMPS (V1.5)
// ══════════════════════════════════════════════════════════════════════════

export const listFuelPumps = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const pumps = await prisma.fuelPump.findMany({
      where:   { orgId, storeId, deleted: false },
      orderBy: [{ sortOrder: 'asc' }, { pumpNumber: 'asc' }],
    });
    res.json({ success: true, data: pumps });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createFuelPump = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const { pumpNumber, label, color, tankOverrides, sortOrder } = req.body;
    const n = Number(pumpNumber);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ success: false, error: 'pumpNumber required (positive integer)' });
    }
    const existing = await prisma.fuelPump.findFirst({
      where: { orgId, storeId, pumpNumber: n, deleted: false },
    });
    if (existing) {
      return res.status(409).json({ success: false, error: `Pump #${n} already exists at this store.` });
    }
    const pump = await prisma.fuelPump.create({
      data: {
        orgId, storeId,
        pumpNumber: n,
        label:      label ? String(label).trim() : null,
        color:      color || null,
        tankOverrides: tankOverrides && typeof tankOverrides === 'object' ? tankOverrides : {},
        sortOrder:  Number(sortOrder) || 0,
      },
    });
    res.json({ success: true, data: pump });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateFuelPump = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    const pump = await prisma.fuelPump.findFirst({ where: { id, orgId, storeId } });
    if (!pump) return res.status(404).json({ success: false, error: 'Pump not found' });

    const data = {};
    if (req.body.pumpNumber !== undefined) {
      const n = Number(req.body.pumpNumber);
      if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ success: false, error: 'pumpNumber must be a positive integer' });
      if (n !== pump.pumpNumber) {
        const dup = await prisma.fuelPump.findFirst({ where: { orgId, storeId, pumpNumber: n, deleted: false, NOT: { id } } });
        if (dup) return res.status(409).json({ success: false, error: `Pump #${n} already exists at this store.` });
      }
      data.pumpNumber = n;
    }
    if (req.body.label          !== undefined) data.label = req.body.label ? String(req.body.label).trim() : null;
    if (req.body.color          !== undefined) data.color = req.body.color || null;
    if (req.body.tankOverrides  !== undefined) data.tankOverrides = req.body.tankOverrides && typeof req.body.tankOverrides === 'object' ? req.body.tankOverrides : {};
    if (req.body.sortOrder      !== undefined) data.sortOrder = Number(req.body.sortOrder) || 0;
    if (req.body.active         !== undefined) data.active = Boolean(req.body.active);

    const updated = await prisma.fuelPump.update({ where: { id }, data });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteFuelPump = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    const pump = await prisma.fuelPump.findFirst({ where: { id, orgId, storeId } });
    if (!pump) return res.status(404).json({ success: false, error: 'Pump not found' });
    // Soft-delete — preserves historical attribution on FuelTransaction.pumpId
    await prisma.fuelPump.update({ where: { id }, data: { deleted: true, active: false } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// RECENT FUEL SALES — powers pump-aware refund picker in cashier-app
// Returns sales only (not refunds), with cumulative already-refunded amounts
// so the UI can show "Refunded $X of $Y" + prevent over-refunds.
// ══════════════════════════════════════════════════════════════════════════

export const listRecentFuelSales = async (req, res) => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) return res.status(400).json({ success: false, error: 'storeId required' });
    const { limit = 30, pumpId, shiftId } = req.query;

    const where = { orgId, storeId, type: 'sale' };
    if (pumpId)  where.pumpId  = pumpId;
    if (shiftId) where.shiftId = shiftId;

    const rows = await prisma.fuelTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 30, 200),
      include: {
        fuelType: { select: { id: true, name: true, gradeLabel: true, color: true } },
        pump:     { select: { id: true, pumpNumber: true, label: true } },
      },
    });

    const saleIds = rows.map(r => r.id);
    const refunds = saleIds.length > 0 ? await prisma.fuelTransaction.findMany({
      where: { refundsOf: { in: saleIds } },
      select: { refundsOf: true, amount: true, gallons: true },
    }) : [];
    const refundedByTx = new Map();
    for (const r of refunds) {
      const prev = refundedByTx.get(r.refundsOf) || { amount: 0, gallons: 0 };
      refundedByTx.set(r.refundsOf, {
        amount:  prev.amount  + Number(r.amount),
        gallons: prev.gallons + Number(r.gallons),
      });
    }

    const enriched = rows.map(r => ({
      ...r,
      refundedAmount:  refundedByTx.get(r.id)?.amount  || 0,
      refundedGallons: refundedByTx.get(r.id)?.gallons || 0,
      remainingAmount:  Number(r.amount)  - (refundedByTx.get(r.id)?.amount  || 0),
      remainingGallons: Number(r.gallons) - (refundedByTx.get(r.id)?.gallons || 0),
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
