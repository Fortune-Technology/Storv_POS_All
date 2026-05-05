/**
 * fuel/types.ts
 *
 * Fuel type (grade) CRUD — name + per-gallon price (3-decimal precision).
 *   getFuelTypes    — list active grades for the active store
 *   createFuelType  — add a new grade; clears any other isDefault if requested
 *   updateFuelType  — partial update; same isDefault clear-other rule
 *   deleteFuelType  — soft delete + clear from FuelSettings.defaultFuelTypeId
 */

import type { Request, Response } from 'express';
import prisma from '../../config/postgres.js';
import { getOrgId, getStore } from './helpers.js';

export const getFuelTypes = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const types = await prisma.fuelType.findMany({
      where:   { orgId: orgId ?? undefined, storeId, deleted: false },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: types });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

interface CreateFuelTypeBody {
  name?: string;
  gradeLabel?: string | null;
  pricePerGallon?: number | string;
  color?: string | null;
  isDefault?: boolean;
  isTaxable?: boolean;
  taxRate?: number | string | null;
  sortOrder?: number | string;
}

export const createFuelType = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const body = (req.body || {}) as CreateFuelTypeBody;
    const { name, gradeLabel, pricePerGallon, color, isDefault, isTaxable, taxRate, sortOrder } = body;
    if (!name || pricePerGallon == null) {
      res.status(400).json({ success: false, error: 'name and pricePerGallon are required' });
      return;
    }
    const price = Number(pricePerGallon);
    if (!Number.isFinite(price) || price < 0) {
      res.status(400).json({ success: false, error: 'pricePerGallon must be a positive number' });
      return;
    }
    // If isDefault=true, clear any existing default in this store
    if (isDefault) {
      await prisma.fuelType.updateMany({
        where: { orgId: orgId ?? undefined, storeId, isDefault: true },
        data:  { isDefault: false },
      });
    }
    const t = await prisma.fuelType.create({
      data: {
        orgId: orgId as string,
        storeId,
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
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const updateFuelType = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    const t = await prisma.fuelType.findFirst({ where: { id, orgId: orgId ?? undefined, storeId } });
    if (!t) { res.status(404).json({ success: false, error: 'Fuel type not found' }); return; }

    const body = (req.body || {}) as CreateFuelTypeBody & { active?: boolean };
    const { name, gradeLabel, pricePerGallon, color, isDefault, isTaxable, taxRate, sortOrder, active } = body;

    if (pricePerGallon != null) {
      const price = Number(pricePerGallon);
      if (!Number.isFinite(price) || price < 0) {
        res.status(400).json({ success: false, error: 'pricePerGallon must be a positive number' });
        return;
      }
    }

    if (isDefault === true) {
      await prisma.fuelType.updateMany({
        where: { orgId: orgId ?? undefined, storeId, isDefault: true, NOT: { id } },
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
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const deleteFuelType = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    await prisma.fuelType.updateMany({
      where: { id, orgId: orgId ?? undefined, storeId },
      data:  { deleted: true, active: false, isDefault: false },
    });
    // Also clear it from FuelSettings.defaultFuelTypeId if set
    await prisma.fuelSettings.updateMany({
      where: { orgId: orgId ?? undefined, storeId, defaultFuelTypeId: id },
      data:  { defaultFuelTypeId: null },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
