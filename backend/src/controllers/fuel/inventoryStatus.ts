/**
 * fuel/inventoryStatus.ts
 *
 * Current tank levels + variance alert flag — powers the Reconciliation
 * tab's per-tank status dashboard. Joins active tanks with FIFO-derived
 * level + latest stick reading + the store's variance threshold.
 *
 *   getInventoryStatus — { rows: [{ tank, currentLevelGal, fillPct,
 *                          lastReading, alerting }], threshold, cadence }
 */

import type { Request, Response } from 'express';
import prisma from '../../config/postgres.js';
import { getAllTankLevels } from '../../services/fuelInventory.js';
import { getOrgId, getStore } from './helpers.js';

export const getInventoryStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }

    const [tanks, settings, latestReadings] = await Promise.all([
      prisma.fuelTank.findMany({
        where:   { orgId: orgId ?? undefined, storeId, deleted: false, active: true },
        include: { fuelType: { select: { id: true, name: true, gradeLabel: true, color: true } } },
      }),
      prisma.fuelSettings.findUnique({ where: { storeId } }),
      prisma.fuelStickReading.findMany({
        where:   { orgId: orgId ?? undefined, storeId },
        orderBy: { readingDate: 'desc' },
        take:    50,
      }),
    ]);
    type TankRow = (typeof tanks)[number];
    type ReadingRow = (typeof latestReadings)[number];

    const levels = await getAllTankLevels(storeId);
    const threshold = Number(settings?.varianceAlertThreshold || 2.0);

    // Map latest reading per tank for the alert flag
    const latestByTank = new Map<string, ReadingRow>();
    for (const r of latestReadings as ReadingRow[]) if (!latestByTank.has(r.tankId)) latestByTank.set(r.tankId, r);

    const rows = (tanks as TankRow[]).map((t) => {
      const current = levels.get(t.id) || 0;
      const capacity = Number(t.capacityGal);
      const fillPct  = capacity > 0 ? Math.max(0, Math.min(100, (current / capacity) * 100)) : 0;
      const lastReading = latestByTank.get(t.id);
      const alerting = lastReading ? Math.abs(Number(lastReading.variancePct)) > threshold : false;
      return {
        tank:  t,
        currentLevelGal: current,
        fillPct,
        lastReading: lastReading || null,
        alerting,
      };
    });

    res.json({
      success: true,
      data: {
        rows,
        threshold,
        cadence: settings?.reconciliationCadence || 'shift',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
