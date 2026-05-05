/**
 * fuel/deliveries.ts
 *
 * BOL deliveries that create FIFO cost layers (Session 42 Inventory).
 * One BOL can split across multiple tanks (multi-tank delivery).
 *   listDeliveries  — paginated date-range query with full item + tank join
 *   createDelivery  — validates every line; calls services/fuelInventory.recordDelivery
 *                     to create FIFO layers; runs S43 V1.5 cost-variance check vs
 *                     last-3-delivery avg per tank (flags > store threshold)
 *   deleteDelivery  — hard-delete only when NO sale has consumed any layer yet;
 *                     otherwise insists on a corrective delivery / stick reading
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { recordDelivery, checkDeliveryCostVariance } from '../../services/fuelInventory.js';
import { getOrgId, getStore } from './helpers.js';

export const listDeliveries = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const q = req.query as { from?: string; to?: string; limit?: string };
    const { from, to, limit } = q;
    const where: Prisma.FuelDeliveryWhereInput = { orgId: orgId ?? undefined, storeId };
    if (from || to) {
      const range: Prisma.DateTimeFilter = {};
      if (from) range.gte = new Date(from + 'T00:00:00');
      if (to)   range.lte = new Date(to   + 'T23:59:59');
      where.deliveryDate = range;
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
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

interface DeliveryItemIn {
  tankId?: string;
  gallonsReceived?: number | string;
  pricePerGallon?: number | string;
}

interface CreateDeliveryBody {
  deliveryDate?: string | Date;
  supplier?: string | null;
  bolNumber?: string | null;
  notes?: string | null;
  items?: DeliveryItemIn[];
}

export const createDelivery = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const body = (req.body || {}) as CreateDeliveryBody;
    const { deliveryDate, supplier, bolNumber, notes, items } = body;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, error: 'At least one delivery item (tank + gallons + price) is required.' });
      return;
    }
    // Validate every item
    for (const it of items) {
      if (!it.tankId || !Number.isFinite(Number(it.gallonsReceived)) || !Number.isFinite(Number(it.pricePerGallon))) {
        res.status(400).json({ success: false, error: 'Each delivery item requires tankId, gallonsReceived, pricePerGallon.' });
        return;
      }
      if (Number(it.gallonsReceived) <= 0 || Number(it.pricePerGallon) < 0) {
        res.status(400).json({ success: false, error: 'gallonsReceived must be > 0 and pricePerGallon >= 0.' });
        return;
      }
      // Ownership check — tank must belong to this store
      const tank = await prisma.fuelTank.findFirst({ where: { id: it.tankId, orgId: orgId ?? undefined, storeId } });
      if (!tank) { res.status(400).json({ success: false, error: `Tank ${it.tankId} not found in this store.` }); return; }
    }
    const delivery = await recordDelivery({
      orgId: orgId as string, storeId, deliveryDate, supplier, bolNumber, notes,
      createdById: req.user?.id || null,
      items,
    } as Parameters<typeof recordDelivery>[0]);

    // V1.5: compute delivery cost variance per line vs last-3-delivery avg
    // for the same fuel type. Flag anything exceeding the store threshold.
    const settings = await prisma.fuelSettings.findUnique({ where: { storeId } });
    const thresholdPct = Number(settings?.deliveryCostVarianceThreshold || 5);
    interface VarianceWarning {
      tankId: string;
      tankName: string;
      newPricePerGallon: number;
      avgPricePerGallon: number;
      variancePct: number;
      thresholdPct: number;
    }
    const varianceWarnings: VarianceWarning[] = [];
    for (const it of items) {
      if (!it.tankId) continue;
      const tank = await prisma.fuelTank.findUnique({ where: { id: it.tankId }, select: { fuelTypeId: true, name: true } });
      if (!tank) continue;
      const variance = await checkDeliveryCostVariance({
        orgId: orgId as string, storeId,
        fuelTypeId: tank.fuelTypeId,
        newPricePerGallon: Number(it.pricePerGallon),
      } as Parameters<typeof checkDeliveryCostVariance>[0]);
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
      where: { id: (delivery as { id: string }).id },
      include: { items: { include: { tank: { select: { id: true, name: true } } } } },
    });
    res.json({ success: true, data: full, varianceWarnings });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const deleteDelivery = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const d = await prisma.fuelDelivery.findFirst({ where: { id, orgId: orgId ?? undefined, storeId } });
    if (!d) { res.status(404).json({ success: false, error: 'Delivery not found' }); return; }
    // Hard-delete is safer than soft-delete here: FIFO layers must go too.
    // Only allow delete if NO sales have consumed any of the layers yet.
    const items = await prisma.fuelDeliveryItem.findMany({ where: { deliveryId: id } });
    type DelivItemRow = (typeof items)[number];
    const anyConsumed = (items as DelivItemRow[]).some((i) => Number(i.remainingGallons) < Number(i.gallonsReceived));
    if (anyConsumed) {
      res.status(400).json({ success: false, error: 'Cannot delete: some layers have already been consumed by sales. Record a negative delivery or stick-reading adjustment instead.' });
      return;
    }
    await prisma.fuelDelivery.delete({ where: { id } }); // cascades items
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
