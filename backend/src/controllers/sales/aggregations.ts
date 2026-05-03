/**
 * Sales aggregations — daily / weekly / monthly / dept / products handlers.
 *
 * All endpoints return the same `{ value: [...], '@odata.aggregation': {...} }`
 * envelope produced by `salesService`. Handlers are thin: parse query params,
 * supply default date ranges, delegate to the service, send JSON.
 */

import type { Request, Response } from 'express';

import {
  getDailySales,
  getWeeklySales,
  getMonthlySales,
  getMonthlySalesComparison,
  getDepartmentSales,
  getDepartmentComparison,
  getTopProducts,
  getProductsGrouped,
  getProductMovement,
  getDailyProductMovement,
  getProduct52WeekStats,
} from '../../services/salesService.js';

import {
  daysAgo,
  weeksAgo,
  monthsAgo,
  today,
  userFor,
  detailedErrorMessage,
  type ErrorWithResponse,
} from './helpers.js';

// ─── Sales Summary ────────────────────────────────────────────────────────

export const daily = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as { from?: string; to?: string };
    const from = q.from || daysAgo(30);
    const to = q.to || today();
    const data = await getDailySales(userFor(req), req.storeId, from, to);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};

export const weekly = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as { from?: string; to?: string };
    const from = q.from || weeksAgo(12);
    const to = q.to || today();
    const data = await getWeeklySales(userFor(req), req.storeId, from, to);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};

export const monthly = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as { from?: string; to?: string };
    const from = q.from || monthsAgo(24);
    const to = q.to || today();
    const data = await getMonthlySales(userFor(req), req.storeId, from, to);
    res.json(data);
  } catch (err) {
    console.error('❌ Sales Controller Error [monthly]:', (err as ErrorWithResponse).response?.data || (err as Error).message);
    res.status(500).json({ error: 'Failed to fetch monthly sales data' });
  }
};

export const monthlyComparison = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await getMonthlySalesComparison(userFor(req), req.storeId);
    res.json(data);
  } catch (err) {
    console.error('❌ Sales Controller Error [monthlyComparison]:', (err as ErrorWithResponse).response?.data || (err as Error).message);
    res.status(500).json({ error: 'Failed to fetch monthly comparison data' });
  }
};

// ─── Departments ──────────────────────────────────────────────────────────

export const departments = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as { from?: string; to?: string };
    const from = q.from || daysAgo(30);
    const to = q.to || today();
    const data = await getDepartmentSales(userFor(req), req.storeId, from, to);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};

export const departmentComparison = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as { from?: string; to?: string; from2?: string; to2?: string };
    const from = q.from || daysAgo(30);
    const to = q.to || today();
    const from2 = q.from2 || daysAgo(60);
    const to2 = q.to2 || daysAgo(31);
    const data = await getDepartmentComparison(userFor(req), req.storeId, from, to, from2, to2);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};

// ─── Products ─────────────────────────────────────────────────────────────

export const topProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    // B8 fix: default to today, not yesterday. If today has no data,
    // callers can pass ?date=... explicitly.
    const q = req.query as { date?: string };
    const date = q.date || today();
    const data = await getTopProducts(userFor(req), req.storeId, date);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};

export const productsGrouped = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as {
      from?: string; to?: string; orderBy?: string;
      pageSize?: string; skip?: string;
    };
    const from = q.from || daysAgo(30);
    const to = q.to || today();
    const orderBy = q.orderBy || 'NetSales';
    const pageSize = Number(q.pageSize) || 20;
    const skip = Number(q.skip) || 0;
    const data = await getProductsGrouped(userFor(req), req.storeId, from, to, orderBy, pageSize, skip);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};

export const productMovement = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as { upc?: string; dateStart?: string; dateFinish?: string; weekly?: string };
    const upc = q.upc;
    const dateStart = q.dateStart || daysAgo(365);
    const dateFinish = q.dateFinish || today();
    const weekly = q.weekly;
    if (!upc) { res.status(400).json({ error: 'upc is required' }); return; }
    const data = await getProductMovement(userFor(req), req.storeId, upc, dateStart, dateFinish, weekly === 'true');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};

export const dailyProductMovement = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as { startDate?: string; endDate?: string };
    const startDate = q.startDate || daysAgo(30);
    const endDate = q.endDate || today();
    const data = await getDailyProductMovement(userFor(req), req.storeId, startDate, endDate);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: detailedErrorMessage(err) });
  }
};

export const product52WeekStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as { upc?: string };
    const { upc } = q;
    if (!upc) { res.status(400).json({ error: 'upc is required' }); return; }
    const data = await getProduct52WeekStats(userFor(req), req.storeId, upc);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};
