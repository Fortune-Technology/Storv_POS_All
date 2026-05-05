/**
 * fuel/pnlReport.ts
 *
 * Time-granular FIFO P&L (hourly / daily / weekly / monthly / yearly).
 * Reads cogs from FuelTransaction.fifoLayers JSON populated at sale time
 * by services/fuelInventory.applySale.
 *   getFuelPnlReport — per-bucket gallons / revenue / cogs / profit + per-grade
 *                      breakdown inside each bucket; totals + marginPct +
 *                      avgPrice. Refunds add back to cogs (signed reversal).
 *
 * Live aggregate-by-grade view lives in reports.ts (different shape).
 */

import type { Request, Response } from 'express';
import prisma from '../../config/postgres.js';
import { getOrgId, getStore, type FifoLayer } from './helpers.js';

const bucketKey = (date: Date | string | number, granularity: string): string => {
  const d = new Date(date);
  const pad = (n: number): string => String(n).padStart(2, '0');
  switch (granularity) {
    case 'hourly':  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`;
    case 'daily':   return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    case 'weekly': {
      // ISO week start (Mon)
      const dd = new Date(d); const day = dd.getDay() || 7;
      dd.setDate(dd.getDate() - day + 1);
      return `${dd.getFullYear()}-W${pad(Math.floor((dd.getDate() + new Date(dd.getFullYear(), 0, 1).getDay()) / 7))}-${pad(dd.getMonth()+1)}-${pad(dd.getDate())}`;
    }
    case 'monthly': return `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
    case 'yearly':  return `${d.getFullYear()}`;
    default:        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
};

interface PnlBucket {
  bucket: string;
  gallons: number;
  revenue: number;
  cogs: number;
  profit: number;
  txCount: number;
  byGrade: Map<string, PnlGrade>;
}

interface PnlGrade {
  fuelTypeId: string;
  name: string | null | undefined;
  color: string | null;
  gallons: number;
  revenue: number;
  cogs: number;
  profit: number;
}

export const getFuelPnlReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId   = getOrgId(req);
    const storeId = getStore(req);
    if (!storeId) { res.status(400).json({ success: false, error: 'storeId required' }); return; }

    const q = req.query as { from?: string; to?: string; granularity?: string };
    const { from, to } = q;
    const granularity = q.granularity || 'daily';
    const fromDate = from ? new Date(from + 'T00:00:00') : new Date(new Date().setDate(new Date().getDate() - 30));
    const toDate   = to   ? new Date(to   + 'T23:59:59') : new Date();

    const txs = await prisma.fuelTransaction.findMany({
      where: { orgId: orgId ?? undefined, storeId, createdAt: { gte: fromDate, lte: toDate } },
      include: { fuelType: { select: { id: true, name: true, gradeLabel: true, color: true } } },
      orderBy: { createdAt: 'asc' },
    });
    type FuelTxRow = (typeof txs)[number] & { fuelTypeName?: string | null };

    // Per-bucket + per-grade accumulator
    const buckets = new Map<string, PnlBucket>();

    for (const t of txs as FuelTxRow[]) {
      const sign = t.type === 'refund' ? -1 : 1;
      const gal = sign * Number(t.gallons);
      const amt = sign * Number(t.amount);
      // COGS from stored FIFO trace — signed (refunds add back)
      let cogs = 0;
      if (Array.isArray(t.fifoLayers)) {
        cogs = sign * (t.fifoLayers as FifoLayer[]).reduce((s, l) => s + Number(l.cost || 0), 0);
      }
      const profit = amt - cogs;

      const key = bucketKey(t.createdAt, granularity);
      if (!buckets.has(key)) {
        buckets.set(key, {
          bucket: key,
          gallons: 0, revenue: 0, cogs: 0, profit: 0, txCount: 0,
          byGrade: new Map(),
        });
      }
      const b = buckets.get(key) as PnlBucket;
      b.gallons += gal;
      b.revenue += amt;
      b.cogs    += cogs;
      b.profit  += profit;
      b.txCount += 1;

      const gradeKey = t.fuelTypeId || 'unknown';
      if (!b.byGrade.has(gradeKey)) {
        b.byGrade.set(gradeKey, {
          fuelTypeId: gradeKey,
          name:  t.fuelType?.name || t.fuelTypeName,
          color: t.fuelType?.color || null,
          gallons: 0, revenue: 0, cogs: 0, profit: 0,
        });
      }
      const g = b.byGrade.get(gradeKey) as PnlGrade;
      g.gallons += gal;
      g.revenue += amt;
      g.cogs    += cogs;
      g.profit  += profit;
    }

    const rows = Array.from(buckets.values())
      .map((b) => ({
        ...b,
        byGrade: Array.from(b.byGrade.values()),
        marginPct: b.revenue > 0 ? (b.profit / b.revenue) * 100 : 0,
        avgPrice:  b.gallons > 0 ? b.revenue / b.gallons : 0,
      }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));

    // Aggregate totals
    interface Totals {
      gallons: number;
      revenue: number;
      cogs: number;
      profit: number;
      txCount: number;
      marginPct?: number;
      avgPrice?: number;
    }
    const totals: Totals = rows.reduce<Totals>((acc, r) => ({
      gallons: acc.gallons + r.gallons,
      revenue: acc.revenue + r.revenue,
      cogs:    acc.cogs    + r.cogs,
      profit:  acc.profit  + r.profit,
      txCount: acc.txCount + r.txCount,
    }), { gallons: 0, revenue: 0, cogs: 0, profit: 0, txCount: 0 });
    totals.marginPct = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;
    totals.avgPrice  = totals.gallons > 0 ? totals.revenue / totals.gallons : 0;

    res.json({
      success: true,
      data: {
        from: fromDate.toISOString(),
        to:   toDate.toISOString(),
        granularity,
        rows,
        totals,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
