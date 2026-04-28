/**
 * Vendor-order suggestions — analyses 60 days of product movement and
 * categorizes each UPC into reorder / ok / overstock based on weekly
 * sales velocity. Used by the Vendor Orders portal page.
 *
 * Note: this is the legacy velocity-only suggestion endpoint. The richer
 * 14-factor algorithm lives in `services/orderEngine.js` and is wired up
 * via `controllers/orderController.ts` instead. This handler is kept for
 * back-compat with the old portal page.
 */

import type { Request, Response } from 'express';

import { getDailyProductMovement } from '../../services/salesService.js';
import { calculateVelocity } from '../../utils/predictions.js';

import {
  daysAgo,
  today,
  userFor,
  detailedErrorMessage,
} from './helpers.js';

interface MovementRow {
  Upc?: string;
  Description?: string;
  Department?: string;
  QuantityOnHand?: number | null;
  QuantitySold?: number;
  Revenue?: number;
}

interface ByUpcEntry {
  upc: string;
  description: string;
  department: string;
  dailyQty: number[];
  dailyRevenue: number[];
  qtyOnHand: number | null;
}

export const vendorOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const startDate = daysAgo(60);
    const endDate = today();

    const rawMovement = (await getDailyProductMovement(userFor(req), req.storeId, startDate, endDate)) as unknown as MovementRow[];

    // Group by UPC
    const byUpc: Record<string, ByUpcEntry> = {};
    for (const row of rawMovement) {
      const upc = row.Upc || '';
      if (!upc) continue;
      if (!byUpc[upc]) {
        byUpc[upc] = {
          upc,
          description: row.Description || upc,
          department: row.Department || '',
          dailyQty: [],
          dailyRevenue: [],
          qtyOnHand: row.QuantityOnHand ?? null,
        };
      }
      byUpc[upc].dailyQty.push(row.QuantitySold || 0);
      byUpc[upc].dailyRevenue.push(row.Revenue || 0);
      // keep most recent QoH
      if (row.QuantityOnHand !== undefined && row.QuantityOnHand !== null) {
        byUpc[upc].qtyOnHand = row.QuantityOnHand;
      }
    }

    interface VelocityResult {
      avgWeekly: number;
      trend: string;
      recommendation: 'reorder' | 'ok' | 'overstock' | string;
    }

    // Aggregate into weekly buckets and compute velocity
    const results = Object.values(byUpc).map((item) => {
      const { dailyQty, dailyRevenue } = item;

      // Sum last 30 days
      const last30days = dailyQty.slice(-30);
      const sales30 = last30days.reduce((a: number, b: number) => a + b, 0);
      const revenue30 = dailyRevenue.slice(-30).reduce((a: number, b: number) => a + b, 0);

      // Build weekly buckets (7-day chunks from the end)
      const weeklyQty: number[] = [];
      for (let w = 0; w < Math.min(8, Math.floor(dailyQty.length / 7)); w++) {
        const start = dailyQty.length - (w + 1) * 7;
        const end = dailyQty.length - w * 7;
        weeklyQty.unshift(dailyQty.slice(start, end).reduce((a: number, b: number) => a + b, 0));
      }

      const velocity = calculateVelocity(weeklyQty) as unknown as VelocityResult;

      return {
        upc: item.upc,
        description: item.description,
        department: item.department,
        qtyOnHand: item.qtyOnHand,
        sales30,
        revenue30: Math.round(revenue30 * 100) / 100,
        avgWeeklySales: velocity.avgWeekly,
        velocityTrend: velocity.trend,
        recommendation: velocity.recommendation,
        weeklyHistory: weeklyQty,
      };
    });

    // Sort: reorder first, then ok, then overstock
    const priority: Record<string, number> = { reorder: 0, ok: 1, overstock: 2 };
    results.sort((a, b) => (priority[a.recommendation] ?? 1) - (priority[b.recommendation] ?? 1));

    res.json({
      analysisWindow: { startDate, endDate },
      products: results,
      summary: {
        total: results.length,
        reorder: results.filter((r) => r.recommendation === 'reorder').length,
        ok: results.filter((r) => r.recommendation === 'ok').length,
        overstock: results.filter((r) => r.recommendation === 'overstock').length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};
