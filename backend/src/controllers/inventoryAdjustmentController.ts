/**
 * Inventory Adjustment Controller
 * Handles shrinkage, damage, spoilage, count corrections, and other inventory adjustments.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

const r2 = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;

interface CreateAdjustmentBody {
  masterProductId: string | number;
  adjustmentQty: string | number;
  reason: string;
  notes?: string | null;
}

// ── POST /api/inventory/adjustments ───────────────────────────────────────
export const createAdjustment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { masterProductId, adjustmentQty, reason, notes } = req.body as CreateAdjustmentBody;
    if (!masterProductId || adjustmentQty == null || !reason) {
      res.status(400).json({ error: 'masterProductId, adjustmentQty, and reason are required' });
      return;
    }

    const storeId = req.storeId;
    if (!storeId) { res.status(400).json({ error: 'storeId required' }); return; }

    const qty = parseInt(String(adjustmentQty));

    // Get current quantity
    const sp = await prisma.storeProduct.findUnique({
      where: { storeId_masterProductId: { storeId, masterProductId: parseInt(String(masterProductId)) } },
    });
    const previousQty = parseInt(String(sp?.quantityOnHand ?? 0));
    const newQty = previousQty + qty;

    // Create adjustment record
    const adjustment = await prisma.inventoryAdjustment.create({
      data: {
        orgId: req.orgId as string,
        storeId,
        masterProductId: parseInt(String(masterProductId)),
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
      where: { storeId_masterProductId: { storeId, masterProductId: parseInt(String(masterProductId)) } },
      update: {
        quantityOnHand: newQty,
        lastStockUpdate: new Date(),
      },
      create: {
        orgId: req.orgId as string,
        storeId,
        masterProductId: parseInt(String(masterProductId)),
        quantityOnHand: newQty,
        lastStockUpdate: new Date(),
      },
    });

    res.status(201).json(adjustment);
  } catch (err) { next(err); }
};

// ── GET /api/inventory/adjustments ────────────────────────────────────────
export const listAdjustments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { reason, masterProductId, from, to, page = 1, limit = 50 } = req.query as {
      reason?: string;
      masterProductId?: string;
      from?: string;
      to?: string;
      page?: string | number;
      limit?: string | number;
    };
    const where: Prisma.InventoryAdjustmentWhereInput = { orgId: req.orgId as string };
    if (req.storeId) where.storeId = req.storeId;
    if (reason) where.reason = reason;
    if (masterProductId) where.masterProductId = parseInt(masterProductId);
    if (from || to) {
      const range: Prisma.DateTimeFilter = {};
      if (from) range.gte = new Date(from);
      if (to) range.lte = new Date(to + 'T23:59:59');
      where.createdAt = range;
    }

    const [adjustments, total] = await Promise.all([
      prisma.inventoryAdjustment.findMany({
        where,
        include: { product: { select: { id: true, name: true, upc: true, defaultRetailPrice: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(String(page)) - 1) * parseInt(String(limit)),
        take: parseInt(String(limit)),
      }),
      prisma.inventoryAdjustment.count({ where }),
    ]);

    res.json({
      adjustments,
      total,
      page: parseInt(String(page)),
      totalPages: Math.ceil(total / parseInt(String(limit))),
    });
  } catch (err) { next(err); }
};

interface ReasonRow { reason: string; units: number; value: number; count: number }

// ── GET /api/inventory/adjustments/summary ────────────────────────────────
export const getAdjustmentSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const where: Prisma.InventoryAdjustmentWhereInput = {
      orgId: req.orgId as string,
      adjustmentQty: { lt: 0 },
    }; // shrinkage = negative
    if (req.storeId) where.storeId = req.storeId;
    if (from || to) {
      const range: Prisma.DateTimeFilter = {};
      if (from) range.gte = new Date(from);
      if (to) range.lte = new Date(to + 'T23:59:59');
      where.createdAt = range;
    }

    const adjustments = await prisma.inventoryAdjustment.findMany({
      where,
      include: { product: { select: { name: true, defaultRetailPrice: true } } },
    });

    // Group by reason
    const byReason: Record<string, ReasonRow> = {};
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
      byReason: Object.values(byReason).sort((a: ReasonRow, b: ReasonRow) => b.value - a.value),
    });
  } catch (err) { next(err); }
};
