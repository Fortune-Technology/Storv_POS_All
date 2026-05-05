/**
 * fuel/settings.ts
 *
 * Per-store fuel module settings — enable flag, default entry mode,
 * cash-only, reconciliation cadence, variance alert threshold, blend +
 * pump tracking flags.
 *
 *   getFuelSettings    — returns saved row or DEFAULT_SETTINGS scaffold
 *   updateFuelSettings — upsert; partial update with field-level coercion
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { getOrgId, getStore } from './helpers.js';

const DEFAULT_SETTINGS = {
  enabled:           false,
  cashOnly:          false,
  allowRefunds:      true,
  defaultEntryMode:  'amount',
  defaultFuelTypeId: null as string | null,
};

export const getFuelSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const s = await prisma.fuelSettings.findUnique({ where: { storeId } });
    res.json({ success: true, data: s || { ...DEFAULT_SETTINGS, orgId, storeId } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

interface UpdateFuelSettingsBody {
  enabled?: boolean;
  cashOnly?: boolean;
  allowRefunds?: boolean;
  defaultEntryMode?: string;
  defaultFuelTypeId?: string | null;
  reconciliationCadence?: string;
  varianceAlertThreshold?: number | string;
  blendingEnabled?: boolean;
  pumpTrackingEnabled?: boolean;
  deliveryCostVarianceThreshold?: number | string;
}

export const updateFuelSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }
    const body = (req.body || {}) as UpdateFuelSettingsBody;
    const {
      enabled, cashOnly, allowRefunds, defaultEntryMode, defaultFuelTypeId,
      reconciliationCadence, varianceAlertThreshold, blendingEnabled,
      pumpTrackingEnabled, deliveryCostVarianceThreshold,
    } = body;
    const data: Record<string, unknown> = {
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
      update: data as Prisma.FuelSettingsUpdateInput,
      create: { orgId: orgId as string, storeId, ...DEFAULT_SETTINGS, ...data } as unknown as Prisma.FuelSettingsCreateInput,
    });
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
