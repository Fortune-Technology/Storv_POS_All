/**
 * fuel/blendConfigs.ts
 *
 * Dispenser blending — middle-grade fuel produced by mixing base + premium
 * tanks at the pump (e.g. 87+93 → 89). Session 42 Inventory.
 *   listBlendConfigs   — all blend configs with the 3 fuel-type joins
 *   upsertBlendConfig  — create OR update by middleFuelTypeId; baseRatio in [0,1]
 *                        with premiumRatio derived as 1 - baseRatio
 *   deleteBlendConfig  — hard-delete (no historical sale uses this row directly;
 *                        FuelTransaction.fifoLayers carries the actual draw)
 */

import type { Request, Response } from 'express';
import prisma from '../../config/postgres.js';
import { getOrgId, getStore } from './helpers.js';

export const listBlendConfigs = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const rows = await prisma.fuelBlendConfig.findMany({
      where: { orgId: orgId ?? undefined, storeId },
      include: {
        middleFuelType:  { select: { id: true, name: true, gradeLabel: true, color: true } },
        baseFuelType:    { select: { id: true, name: true, gradeLabel: true, color: true } },
        premiumFuelType: { select: { id: true, name: true, gradeLabel: true, color: true } },
      },
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const upsertBlendConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const body = (req.body || {}) as {
      middleFuelTypeId?: string;
      baseFuelTypeId?: string;
      premiumFuelTypeId?: string;
      baseRatio?: number | string;
      active?: boolean;
    };
    const { middleFuelTypeId, baseFuelTypeId, premiumFuelTypeId, baseRatio, active } = body;
    if (!middleFuelTypeId || !baseFuelTypeId || !premiumFuelTypeId || baseRatio == null) {
      res.status(400).json({ success: false, error: 'middleFuelTypeId, baseFuelTypeId, premiumFuelTypeId, baseRatio required' });
      return;
    }
    const ratio = Number(baseRatio);
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      res.status(400).json({ success: false, error: 'baseRatio must be between 0 and 1' });
      return;
    }
    const data = {
      orgId: orgId as string, storeId,
      middleFuelTypeId, baseFuelTypeId, premiumFuelTypeId,
      baseRatio: ratio,
      premiumRatio: 1 - ratio,
      active: active !== false,
    };
    const existing = await prisma.fuelBlendConfig.findFirst({ where: { orgId: orgId ?? undefined, storeId, middleFuelTypeId } });
    const saved = existing
      ? await prisma.fuelBlendConfig.update({ where: { id: existing.id }, data })
      : await prisma.fuelBlendConfig.create({ data });
    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const deleteBlendConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const b = await prisma.fuelBlendConfig.findFirst({ where: { id, orgId: orgId ?? undefined, storeId } });
    if (!b) { res.status(404).json({ success: false, error: 'Blend config not found' }); return; }
    await prisma.fuelBlendConfig.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
