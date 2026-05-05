/**
 * fuel/reports.ts
 *
 * Date-range aggregate views over FuelTransaction.
 *   getFuelReport     — by-grade + by-pump breakdown across an arbitrary
 *                       date range. Returns sales / refunds / net per row.
 *                       S79b (F27) added the byPump dimension alongside
 *                       byType in a single query, plus unattributedCount
 *                       for txns without pumpId (legacy data or stations
 *                       with pumpTrackingEnabled=false).
 *   getFuelDashboard  — today + month KPIs plus today-by-type breakdown.
 *                       Refunds subtract from net via signed sumNet().
 *
 * Time-granular FIFO P&L lives in pnlReport.ts (separate module — different
 * shape, separate accumulator, different consumer).
 */

import type { Request, Response } from 'express';
import prisma from '../../config/postgres.js';
import { getOrgId, getStore } from './helpers.js';

interface ReportRow {
  fuelTypeId: string;
  name: string;
  gradeLabel: string | null;
  color: string | null;
  salesGallons: number;
  salesAmount: number;
  salesCount: number;
  refundsGallons: number;
  refundsAmount: number;
  refundsCount: number;
  netGallons: number;
  netAmount: number;
  avgPrice: number;
}

export const getFuelReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }

    const q = req.query as { from?: string; to?: string };
    const { from, to } = q;
    const fromDate = from ? new Date(from + 'T00:00:00') : new Date(new Date().setDate(new Date().getDate() - 30));
    const toDate   = to   ? new Date(to   + 'T23:59:59') : new Date();

    const txs = await prisma.fuelTransaction.findMany({
      where: { orgId: orgId ?? undefined, storeId, createdAt: { gte: fromDate, lte: toDate } },
      include: {
        fuelType: { select: { id: true, name: true, gradeLabel: true, color: true } },
        // S79b (F27) — pump join for per-pump breakdown. Returned alongside
        // byType so the portal can render both views from a single fetch.
        pump:     { select: { id: true, pumpNumber: true, label: true, color: true } },
      },
    });

    // Group by fuelType + sale/refund
    const byType = new Map<string, ReportRow>();
    // S79b (F27) — Group by pump too. Same shape, different key dimension.
    interface PumpRow {
      pumpId:        string;
      pumpNumber:    string | null;
      label:         string | null;
      color:         string | null;
      salesGallons:  number; salesAmount:  number; salesCount:  number;
      refundsGallons:number; refundsAmount:number; refundsCount:number;
      netGallons:    number; netAmount:    number;
      avgPrice:      number;
    }
    const byPump = new Map<string, PumpRow>();
    let totalGallons = 0, totalAmount = 0, totalSalesGallons = 0, totalSalesAmount = 0, totalRefundsGallons = 0, totalRefundsAmount = 0;
    let txCount = 0, salesCount = 0, refundsCount = 0;
    // Tracks how many txns had pumpId=null (legacy data before S43 pump
    // tracking, or stations with pumpTrackingEnabled=false). Surfaced in
    // totals so the portal can show "X transactions weren't pump-tagged".
    let unattributedCount = 0;

    type FuelTxRow = (typeof txs)[number] & { fuelTypeName?: string | null };
    for (const t of txs as FuelTxRow[]) {
      const id = t.fuelTypeId || 'unknown';
      if (!byType.has(id)) {
        byType.set(id, {
          fuelTypeId: id,
          name:       t.fuelType?.name || t.fuelTypeName || 'Unknown',
          gradeLabel: t.fuelType?.gradeLabel || null,
          color:      t.fuelType?.color || null,
          salesGallons: 0, salesAmount: 0, salesCount: 0,
          refundsGallons: 0, refundsAmount: 0, refundsCount: 0,
          netGallons: 0,    netAmount: 0,
          avgPrice:   0,
        });
      }
      // Per-pump bucket. Skip null pumpId (counted in unattributedCount but
      // not bucketed; the portal renders an "Unassigned" footer line if > 0).
      let pumpRow: PumpRow | null = null;
      if (t.pumpId) {
        if (!byPump.has(t.pumpId)) {
          byPump.set(t.pumpId, {
            pumpId:     t.pumpId,
            pumpNumber: t.pump?.pumpNumber ?? null,
            label:      t.pump?.label ?? null,
            color:      t.pump?.color ?? null,
            salesGallons: 0, salesAmount: 0, salesCount: 0,
            refundsGallons: 0, refundsAmount: 0, refundsCount: 0,
            netGallons: 0, netAmount: 0,
            avgPrice: 0,
          });
        }
        pumpRow = byPump.get(t.pumpId) as PumpRow;
      } else {
        unattributedCount += 1;
      }

      const row = byType.get(id) as ReportRow;
      const gal = Number(t.gallons);
      const amt = Number(t.amount);
      if (t.type === 'refund') {
        row.refundsGallons += gal;
        row.refundsAmount  += amt;
        row.refundsCount   += 1;
        if (pumpRow) {
          pumpRow.refundsGallons += gal;
          pumpRow.refundsAmount  += amt;
          pumpRow.refundsCount   += 1;
        }
        totalRefundsGallons += gal; totalRefundsAmount += amt; refundsCount += 1;
      } else {
        row.salesGallons   += gal;
        row.salesAmount    += amt;
        row.salesCount     += 1;
        if (pumpRow) {
          pumpRow.salesGallons += gal;
          pumpRow.salesAmount  += amt;
          pumpRow.salesCount   += 1;
        }
        totalSalesGallons  += gal; totalSalesAmount  += amt; salesCount  += 1;
      }
      txCount += 1;
    }

    const rows = Array.from(byType.values()).map((r) => {
      r.netGallons = r.salesGallons - r.refundsGallons;
      r.netAmount  = r.salesAmount  - r.refundsAmount;
      r.avgPrice   = r.netGallons > 0 ? r.netAmount / r.netGallons : 0;
      return r;
    }).sort((a, b) => b.netAmount - a.netAmount);

    // S79b (F27) — finalise per-pump rows. Sort by netAmount desc same as
    // byType so the busiest pumps land at the top.
    const pumpRows = Array.from(byPump.values()).map((r) => {
      r.netGallons = r.salesGallons - r.refundsGallons;
      r.netAmount  = r.salesAmount  - r.refundsAmount;
      r.avgPrice   = r.netGallons > 0 ? r.netAmount / r.netGallons : 0;
      return r;
    }).sort((a, b) => b.netAmount - a.netAmount);

    totalGallons = totalSalesGallons - totalRefundsGallons;
    totalAmount  = totalSalesAmount  - totalRefundsAmount;

    res.json({
      success: true,
      data: {
        from:   fromDate.toISOString(),
        to:     toDate.toISOString(),
        byType: rows,
        // S79b (F27) — per-pump breakdown. Empty array when no pumps are
        // configured OR when every transaction in the window has pumpId=null.
        byPump: pumpRows,
        totals: {
          gallons:        totalGallons,
          amount:         totalAmount,
          salesGallons:   totalSalesGallons,
          salesAmount:    totalSalesAmount,
          refundsGallons: totalRefundsGallons,
          refundsAmount:  totalRefundsAmount,
          txCount,
          salesCount,
          refundsCount,
          unattributedCount,  // F27 — txs without pumpId
          avgPrice:       totalGallons > 0 ? totalAmount / totalGallons : 0,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

interface DashByType {
  fuelTypeId: string;
  name: string | null | undefined;
  color: string | null;
  gallons: number;
  amount: number;
}

export const getFuelDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }

    const now      = new Date();
    const startOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayTxs, monthTxs, types] = await Promise.all([
      prisma.fuelTransaction.findMany({
        where: { orgId: orgId ?? undefined, storeId, createdAt: { gte: startOfDay } },
        include: { fuelType: { select: { id: true, name: true, color: true } } },
      }),
      prisma.fuelTransaction.findMany({
        where: { orgId: orgId ?? undefined, storeId, createdAt: { gte: startOfMonth } },
        select: { type: true, gallons: true, amount: true },
      }),
      prisma.fuelType.count({ where: { orgId: orgId ?? undefined, storeId, deleted: false, active: true } }),
    ]);

    interface TxLikeForSum { type: string; gallons: unknown; amount: unknown }
    const sumNet = (txs: TxLikeForSum[]): { gallons: number; amount: number } => {
      let g = 0, a = 0;
      for (const t of txs) {
        const sign = t.type === 'refund' ? -1 : 1;
        g += sign * Number(t.gallons);
        a += sign * Number(t.amount);
      }
      return { gallons: g, amount: a };
    };

    // Today by type breakdown
    const todayByType = new Map<string, DashByType>();
    type TodayTxRow = (typeof todayTxs)[number] & { fuelTypeName?: string | null };
    for (const t of todayTxs as TodayTxRow[]) {
      const id = t.fuelTypeId || 'unknown';
      if (!todayByType.has(id)) {
        todayByType.set(id, {
          fuelTypeId: id,
          name:       t.fuelType?.name || t.fuelTypeName,
          color:      t.fuelType?.color || null,
          gallons:    0, amount: 0,
        });
      }
      const r = todayByType.get(id) as DashByType;
      const sign = t.type === 'refund' ? -1 : 1;
      r.gallons += sign * Number(t.gallons);
      r.amount  += sign * Number(t.amount);
    }

    res.json({
      success: true,
      data: {
        today:      sumNet(todayTxs as TxLikeForSum[]),
        month:      sumNet(monthTxs as TxLikeForSum[]),
        todayByType: Array.from(todayByType.values()),
        activeTypes: types,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
