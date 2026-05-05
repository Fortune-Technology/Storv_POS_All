/**
 * fuel/manifoldGroups.ts
 *
 * FuelManifoldGroup CRUD — tanks that share a level (sales deduct
 * proportionally across members per drainMode setting). Session 42 Inventory.
 *   listManifoldGroups   — all groups + their tank rosters
 *   createManifoldGroup  — drainMode defaults to 'equal'
 *   updateManifoldGroup  — partial update of name / drainMode / active
 *   deleteManifoldGroup  — detaches tanks (back to 'independent') then soft-deletes
 */

import type { Request, Response } from 'express';
import prisma from '../../config/postgres.js';
import { getOrgId, getStore } from './helpers.js';

export const listManifoldGroups = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const groups = await prisma.fuelManifoldGroup.findMany({
      where:   { orgId: orgId ?? undefined, storeId, deleted: false },
      include: { tanks: { where: { deleted: false }, select: { id: true, name: true, fuelTypeId: true, capacityGal: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: groups });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const createManifoldGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const body = (req.body || {}) as { name?: string; drainMode?: string };
    const { name, drainMode } = body;
    if (!name) { res.status(400).json({ success: false, error: 'name required' }); return; }
    const g = await prisma.fuelManifoldGroup.create({
      data: { orgId: orgId as string, storeId, name: String(name).trim(), drainMode: drainMode || 'equal' },
    });
    res.json({ success: true, data: g });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const updateManifoldGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    const group = await prisma.fuelManifoldGroup.findFirst({ where: { id, orgId: orgId ?? undefined, storeId } });
    if (!group) { res.status(404).json({ success: false, error: 'Group not found' }); return; }
    const body = (req.body || {}) as { name?: string; drainMode?: string; active?: boolean };
    const updated = await prisma.fuelManifoldGroup.update({
      where: { id },
      data: {
        name:      body.name ?? group.name,
        drainMode: body.drainMode ?? group.drainMode,
        active:    body.active ?? group.active,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const deleteManifoldGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id } = req.params;
    // Detach tanks first, then soft-delete
    await prisma.fuelTank.updateMany({
      where: { manifoldGroupId: id, orgId: orgId ?? undefined, storeId },
      data:  { manifoldGroupId: null, topology: 'independent' },
    });
    await prisma.fuelManifoldGroup.update({ where: { id }, data: { deleted: true, active: false } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
