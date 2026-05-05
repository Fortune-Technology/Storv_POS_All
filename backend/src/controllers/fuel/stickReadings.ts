/**
 * fuel/stickReadings.ts
 *
 * Manual stick measurement entries vs software-expected level (Session 42
 * Inventory + S43 V1.5 close-shift prompt).
 *   listStickReadings  — paginated date-range query, filterable by tank
 *   createStickReading — wraps services/fuelInventory.recordStickReading
 *                        which computes variance + variancePct vs current
 *                        FIFO level at write time
 *   deleteStickReading — hard-delete (audit trail of intentional adjustments
 *                        is what matters; one bad entry shouldn't pollute it)
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { recordStickReading } from '../../services/fuelInventory.js';
import { getOrgId, getStore } from './helpers.js';

export const listStickReadings = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const q = req.query as { tankId?: string; from?: string; to?: string; limit?: string };
    const { tankId, from, to, limit } = q;
    const where: Prisma.FuelStickReadingWhereInput = { orgId: orgId ?? undefined, storeId };
    if (tankId) where.tankId = tankId;
    if (from || to) {
      const range: Prisma.DateTimeFilter = {};
      if (from) range.gte = new Date(from + 'T00:00:00');
      if (to)   range.lte = new Date(to   + 'T23:59:59');
      where.readingDate = range;
    }
    const readings = await prisma.fuelStickReading.findMany({
      where,
      orderBy: { readingDate: 'desc' },
      take: Math.min(Number(limit) || 200, 1000),
      include: { tank: { select: { id: true, name: true, fuelType: { select: { name: true, color: true } } } } },
    });
    res.json({ success: true, data: readings });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const createStickReading = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const body = (req.body || {}) as { tankId?: string; actualGallons?: number | string; shiftId?: string | null; notes?: string | null };
    const { tankId, actualGallons, shiftId, notes } = body;
    if (!tankId || actualGallons == null) {
      res.status(400).json({ success: false, error: 'tankId and actualGallons required' });
      return;
    }
    const tank = await prisma.fuelTank.findFirst({ where: { id: tankId, orgId: orgId ?? undefined, storeId } });
    if (!tank) { res.status(404).json({ success: false, error: 'Tank not found' }); return; }
    const reading = await recordStickReading({
      orgId: orgId as string, storeId, tankId,
      actualGallons: Number(actualGallons),
      shiftId, notes,
      createdById: req.user?.id || null,
    } as Parameters<typeof recordStickReading>[0]);
    res.json({ success: true, data: reading });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const deleteStickReading = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const r = await prisma.fuelStickReading.findFirst({ where: { id, orgId: orgId ?? undefined, storeId } });
    if (!r) { res.status(404).json({ success: false, error: 'Reading not found' }); return; }
    await prisma.fuelStickReading.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
