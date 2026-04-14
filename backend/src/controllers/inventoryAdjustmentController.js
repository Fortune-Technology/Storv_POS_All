/**
 * Inventory Adjustment Controller
 * Handles shrinkage, damage, spoilage, count corrections, and other inventory adjustments.
 */

import prisma from '../config/postgres.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── POST /api/inventory/adjustments ───────────────────────────────────────
export const createAdjustment = async (req, res, next) => {
  try {
    const { masterProductId, adjustmentQty, reason, notes } = req.body;
    if (!masterProductId || adjustmentQty == null || !reason) {
      return res.status(400).json({ error: 'masterProductId, adjustmentQty, and reason are required' });
    }

    const storeId = req.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId required' });

    const qty = parseInt(adjustmentQty);

    // Get current quantity
    const sp = await prisma.storeProduct.findUnique({
      where: { storeId_masterProductId: { storeId, masterProductId: parseInt(masterProductId) } },
    });
    const previousQty = parseInt(sp?.quantityOnHand ?? 0);
    const newQty = previousQty + qty;

    // Create adjustment record
    const adjustment = await prisma.inventoryAdjustment.create({
      data: {
        orgId: req.orgId,
        storeId,
        masterProductId: parseInt(masterProductId),
        adjustmentQty: qty,
        previousQty,
        newQty,
        reason,
        notes: notes || null,
        createdById: req.user?.id || '',
      },
      include: {
        product: { select: { id: true, name: true, upc: true } },
      },
    });

    // Update store inventory
    await prisma.storeProduct.upsert({
      where: { storeId_masterProductId: { storeId, masterProductId: parseInt(masterProductId) } },
      update: {
        quantityOnHand: newQty,
        lastStockUpdate: new Date(),
      },
      create: {
        storeId,
        masterProductId: parseInt(masterProductId),
        quantityOnHand: newQty,
        lastStockUpdate: new Date(),
      },
    });

    res.status(201).json(adjustment);
  } catch (err) { next(err); }
};

// ── GET /api/inventory/adjustments ────────────────────────────────────────
export const listAdjustments = async (req, res, next) => {
  try {
    const { reason, masterProductId, from, to, page = 1, limit = 50 } = req.query;
    const where = { orgId: req.orgId };
    if (req.storeId) where.storeId = req.storeId;
    if (reason) where.reason = reason;
    if (masterProductId) where.masterProductId = parseInt(masterProductId);
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to + 'T23:59:59');
    }

    const [adjustments, total] = await Promise.all([
      prisma.inventoryAdjustment.findMany({
        where,
        include: { product: { select: { id: true, name: true, upc: true, defaultRetailPrice: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.inventoryAdjustment.count({ where }),
    ]);

    res.json({ adjustments, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
};

// ── GET /api/inventory/adjustments/summary ────────────────────────────────
export const getAdjustmentSummary = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const where = { orgId: req.orgId, adjustmentQty: { lt: 0 } }; // shrinkage = negative
    if (req.storeId) where.storeId = req.storeId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to + 'T23:59:59');
    }

    const adjustments = await prisma.inventoryAdjustment.findMany({
      where,
      include: { product: { select: { name: true, defaultRetailPrice: true } } },
    });

    // Group by reason
    const byReason = {};
    let totalUnits = 0;
    let totalValue = 0;
    for (const adj of adjustments) {
      const r = adj.reason || 'other';
      if (!byReason[r]) byReason[r] = { reason: r, units: 0, value: 0, count: 0 };
      const units = Math.abs(adj.adjustmentQty);
      const value = units * Number(adj.product?.defaultRetailPrice || 0);
      byReason[r].units += units;
      byReason[r].value += value;
      byReason[r].count += 1;
      totalUnits += units;
      totalValue += value;
    }

    res.json({
      totalUnits,
      totalValue: r2(totalValue),
      totalAdjustments: adjustments.length,
      byReason: Object.values(byReason).sort((a, b) => b.value - a.value),
    });
  } catch (err) { next(err); }
};
