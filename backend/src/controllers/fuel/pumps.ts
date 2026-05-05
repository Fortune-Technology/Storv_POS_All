/**
 * fuel/pumps.ts
 *
 * Per-pump dispenser CRUD (Session 43 V1.5 + S79b alphanumeric pumpNumber).
 *   normalizePumpNumber  — validator + coercer (1-16 alphanumeric chars)
 *   listFuelPumps        — list active pumps for the store
 *   createFuelPump       — uniqueness check on (storeId, pumpNumber); rejects 409
 *   updateFuelPump       — partial update; same uniqueness re-check on rename
 *   deleteFuelPump       — soft delete (preserves FuelTransaction.pumpId history)
 *
 * Pumps optionally carry tankOverrides JSON: { fuelTypeId → tankId } so a
 * single fuel grade with multiple independent tanks can pin which tank a
 * particular pump draws from. Resolved at sale time by services/fuelInventory.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { getOrgId, getStore } from './helpers.js';

// S79b (F27) — pumpNumber validator. Allows alphanumeric pump labels like
// "1", "A1", "Diesel-1", "Out_front". Rules:
//   • length 1–16
//   • [A-Za-z0-9 _-] (no spaces, no slashes, no quotes)
//   • input is trimmed first; legacy integer inputs are coerced to string
//     (e.g. existing UI sending pumpNumber: 5 → "5") so back-compat holds
const PUMP_NUMBER_RE = /^[A-Za-z0-9_-]{1,16}$/;
function normalizePumpNumber(input: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (input === null || input === undefined || input === '') {
    return { ok: false, error: 'pumpNumber required' };
  }
  // Coerce numbers from legacy callers ("5" / 5 both end up as "5").
  const raw = typeof input === 'number' ? String(input) : String(input).trim();
  if (!PUMP_NUMBER_RE.test(raw)) {
    return { ok: false, error: 'pumpNumber must be 1–16 alphanumeric chars (letters, digits, dash, underscore)' };
  }
  return { ok: true, value: raw };
}

export const listFuelPumps = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const pumps = await prisma.fuelPump.findMany({
      where:   { orgId: orgId ?? undefined, storeId, deleted: false },
      orderBy: [{ sortOrder: 'asc' }, { pumpNumber: 'asc' }],
    });
    res.json({ success: true, data: pumps });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

interface CreatePumpBody {
  pumpNumber?: number | string;
  label?: string | null;
  color?: string | null;
  tankOverrides?: Record<string, unknown>;
  sortOrder?: number | string;
}

export const createFuelPump = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const body = (req.body || {}) as CreatePumpBody;
    const { label, color, tankOverrides, sortOrder } = body;

    const norm = normalizePumpNumber(body.pumpNumber);
    if (!norm.ok) { res.status(400).json({ success: false, error: norm.error }); return; }
    const pumpNumber = norm.value;

    const existing = await prisma.fuelPump.findFirst({
      where: { orgId: orgId ?? undefined, storeId, pumpNumber, deleted: false },
    });
    if (existing) {
      res.status(409).json({ success: false, error: `Pump "${pumpNumber}" already exists at this store.` });
      return;
    }
    const pump = await prisma.fuelPump.create({
      data: {
        orgId: orgId as string,
        storeId,
        pumpNumber,
        label:      label ? String(label).trim() : null,
        color:      color || null,
        tankOverrides: (tankOverrides && typeof tankOverrides === 'object' ? tankOverrides : {}) as Prisma.InputJsonValue,
        sortOrder:  Number(sortOrder) || 0,
      },
    });
    res.json({ success: true, data: pump });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const updateFuelPump = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    const pump = await prisma.fuelPump.findFirst({ where: { id, orgId: orgId ?? undefined, storeId } });
    if (!pump) { res.status(404).json({ success: false, error: 'Pump not found' }); return; }

    const body = (req.body || {}) as CreatePumpBody & { active?: boolean };
    const data: Record<string, unknown> = {};
    if (body.pumpNumber !== undefined) {
      const norm = normalizePumpNumber(body.pumpNumber);
      if (!norm.ok) { res.status(400).json({ success: false, error: norm.error }); return; }
      const newNumber = norm.value;
      if (newNumber !== pump.pumpNumber) {
        const dup = await prisma.fuelPump.findFirst({ where: { orgId: orgId ?? undefined, storeId, pumpNumber: newNumber, deleted: false, NOT: { id } } });
        if (dup) { res.status(409).json({ success: false, error: `Pump "${newNumber}" already exists at this store.` }); return; }
      }
      data.pumpNumber = newNumber;
    }
    if (body.label          !== undefined) data.label = body.label ? String(body.label).trim() : null;
    if (body.color          !== undefined) data.color = body.color || null;
    if (body.tankOverrides  !== undefined) data.tankOverrides = (body.tankOverrides && typeof body.tankOverrides === 'object' ? body.tankOverrides : {}) as Prisma.InputJsonValue;
    if (body.sortOrder      !== undefined) data.sortOrder = Number(body.sortOrder) || 0;
    if (body.active         !== undefined) data.active = Boolean(body.active);

    const updated = await prisma.fuelPump.update({ where: { id }, data: data as Prisma.FuelPumpUpdateInput });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const deleteFuelPump = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    const { id }  = req.params;
    const pump = await prisma.fuelPump.findFirst({ where: { id, orgId: orgId ?? undefined, storeId } });
    if (!pump) { res.status(404).json({ success: false, error: 'Pump not found' }); return; }
    // Soft-delete — preserves historical attribution on FuelTransaction.pumpId
    await prisma.fuelPump.update({ where: { id }, data: { deleted: true, active: false } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
