/**
 * fuel/tanks.ts
 *
 * Physical underground storage tank CRUD (Session 42 Inventory).
 *   listFuelTanks   — list active tanks for the store + attach FIFO levels
 *   createFuelTank  — add a tank; clears other isPrimary in same grade if requested
 *   updateFuelTank  — partial update; same isPrimary clear-other rule
 *   deleteFuelTank  — soft delete (preserves FIFO history for reporting)
 *
 * FIFO level computation lives in services/fuel/inventory.ts (getAllTankLevels)
 * — this module only renders.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { getAllTankLevels } from '../../services/fuelInventory.js';
import { getOrgId, getStore, num } from './helpers.js';

export const listFuelTanks = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }

    const tanks = await prisma.fuelTank.findMany({
      where:   { orgId: orgId ?? undefined, storeId, deleted: false },
      orderBy: [{ fuelTypeId: 'asc' }, { name: 'asc' }],
      include: {
        fuelType:      { select: { id: true, name: true, gradeLabel: true, color: true, pricePerGallon: true } },
        manifoldGroup: { select: { id: true, name: true, drainMode: true } },
      },
    });
    type TankRow = (typeof tanks)[number];

    // Attach current level to each tank from FIFO layers
    const levels = await getAllTankLevels(storeId);
    const rows = (tanks as TankRow[]).map((t) => ({
      ...t,
      currentLevelGal: levels.get(t.id) || 0,
      fillPct: Number(t.capacityGal) > 0
        ? Math.max(0, Math.min(100, ((levels.get(t.id) || 0) / Number(t.capacityGal)) * 100))
        : 0,
    }));

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

interface CreateTankBody {
  name?: string;
  tankCode?: string | null;
  fuelTypeId?: string;
  capacityGal?: number | string;
  diameterInches?: number | string | null;
  lengthInches?: number | string | null;
  topology?: string;
  manifoldGroupId?: string | null;
  isPrimary?: boolean;
}

export const createFuelTank = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const body = (req.body || {}) as CreateTankBody;
    const {
      name, tankCode, fuelTypeId, capacityGal,
      diameterInches, lengthInches,
      topology, manifoldGroupId, isPrimary,
    } = body;
    if (!name || !fuelTypeId || capacityGal == null) {
      res.status(400).json({ success: false, error: 'name, fuelTypeId, capacityGal required' });
      return;
    }
    const cap = Number(capacityGal);
    if (!Number.isFinite(cap) || cap <= 0) {
      res.status(400).json({ success: false, error: 'capacityGal must be > 0' });
      return;
    }
    // If this tank is marked primary, clear any other primary for the same grade
    if (isPrimary) {
      await prisma.fuelTank.updateMany({
        where: { orgId: orgId ?? undefined, storeId, fuelTypeId, isPrimary: true },
        data:  { isPrimary: false },
      });
    }
    const t = await prisma.fuelTank.create({
      data: {
        orgId: orgId as string,
        storeId,
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
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const updateFuelTank = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const tank = await prisma.fuelTank.findFirst({ where: { id, orgId: orgId ?? undefined, storeId } });
    if (!tank) { res.status(404).json({ success: false, error: 'Tank not found' }); return; }

    const allowed = ['name', 'tankCode', 'capacityGal', 'diameterInches', 'lengthInches',
                     'topology', 'manifoldGroupId', 'isPrimary', 'active'] as const;
    const data: Record<string, unknown> = {};
    const body = (req.body || {}) as Record<string, unknown>;
    for (const k of allowed) {
      if (body[k] === undefined) continue;
      if ((['capacityGal', 'diameterInches', 'lengthInches'] as const).includes(k as 'capacityGal')) {
        data[k] = num(body[k]);
      } else {
        data[k] = body[k];
      }
    }
    // If becoming primary, clear other primaries in the same grade
    if (data.isPrimary === true) {
      await prisma.fuelTank.updateMany({
        where: { orgId: orgId ?? undefined, storeId, fuelTypeId: tank.fuelTypeId, isPrimary: true, id: { not: id } },
        data:  { isPrimary: false },
      });
    }
    const updated = await prisma.fuelTank.update({ where: { id }, data: data as Prisma.FuelTankUpdateInput });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const deleteFuelTank = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const tank = await prisma.fuelTank.findFirst({ where: { id, orgId: orgId ?? undefined, storeId } });
    if (!tank) { res.status(404).json({ success: false, error: 'Tank not found' }); return; }
    // Soft delete — keep for historical reporting
    await prisma.fuelTank.update({ where: { id }, data: { deleted: true, active: false } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
