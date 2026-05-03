/**
 * Reports Hub Controller — survivors after Session 64 ReportsHub frontend cleanup.
 *
 * Originally housed 8 report endpoints. The portal-side ReportsHub page was
 * deleted in S64 and 5 of those endpoints became orphaned (no callers across
 * any frontend app — verified via grep in S65). Those 5 handlers + routes
 * were dropped here for the same B10 cleanup pass.
 *
 * Surviving endpoints (still in active use):
 *   - GET /api/reports/hub/inventory  → InventoryStatus tab in InventoryCount
 *   - GET /api/reports/hub/compare    → PeriodCompare tab in AnalyticsHub
 *   - GET /api/reports/hub/notes      → TxNotes tab in POSReports
 *
 * Removed in S65 (gone, do not restore without active callers):
 *   getSummaryReport / getTaxReport / getEventsReport /
 *   getReceiveReport / getHouseAccountReport
 *   (Their portal duplicates: AnalyticsHub→Sales, EndOfDayReport tax section,
 *   AuditLogPage, VendorOrders/InvoiceImport, Customers page respectively.)
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';

const r2 = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n: unknown): number => Math.round((Number(n) || 0) * 10000) / 10000;

interface TenderLine {
  method?: string | null;
  amount?: number | string | null;
}

interface LineItem {
  isLottery?: boolean;
  isBottleReturn?: boolean;
  productId?: string | number | null;
  qty?: number | string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/hub/inventory — Stock levels + dead/over/low stock
// ═══════════════════════════════════════════════════════════════════════════

export const getInventoryReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const storeId = req.storeId;
    const q = req.query as { type?: string };
    const type = q.type || 'all';

    const products = await prisma.masterProduct.findMany({
      where: { orgId, active: true, deleted: false, trackInventory: true },
      select: {
        id: true, name: true, upc: true, brand: true,
        defaultRetailPrice: true, defaultCostPrice: true,
        reorderPoint: true, reorderQty: true,
        department: { select: { name: true } },
        storeProducts: storeId
          ? { where: { storeId }, select: { quantityOnHand: true, quantityOnOrder: true, lastReceivedAt: true, lastStockUpdate: true } }
          : { select: { quantityOnHand: true, quantityOnOrder: true, lastReceivedAt: true, lastStockUpdate: true } },
      },
    });
    type ProductRow = (typeof products)[number];

    // Get 30-day sales for velocity
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const txWhere: Prisma.TransactionWhereInput = { orgId, status: 'complete', createdAt: { gte: thirtyDaysAgo } };
    if (storeId) txWhere.storeId = storeId;
    const recentTxns = await prisma.transaction.findMany({ where: txWhere, select: { lineItems: true } });

    const salesMap: Record<string, number> = {};
    for (const tx of recentTxns) {
      const items: LineItem[] = Array.isArray(tx.lineItems) ? (tx.lineItems as unknown as LineItem[]) : [];
      for (const li of items) {
        if (!li.productId || li.isLottery || li.isBottleReturn) continue;
        const key = String(li.productId);
        salesMap[key] = (salesMap[key] || 0) + (Number(li.qty) || 1);
      }
    }

    const inventory = (products as ProductRow[]).map((p) => {
      const sp = p.storeProducts[0];
      const onHand = Number(sp?.quantityOnHand) || 0;
      const onOrder = Number(sp?.quantityOnOrder) || 0;
      const sold30d = salesMap[String(p.id)] || 0;
      const avgDaily = r4(sold30d / 30);
      const daysOfSupply = avgDaily > 0 ? r2(onHand / avgDaily) : onHand > 0 ? 999 : 0;
      const retailValue = r2(onHand * (Number(p.defaultRetailPrice) || 0));
      const costValue = r2(onHand * (Number(p.defaultCostPrice) || (Number(p.defaultRetailPrice) || 0) * 0.65 || 0));

      let stockStatus: 'ok' | 'out' | 'low' | 'dead' | 'over' = 'ok';
      if (onHand <= 0 && sold30d > 0) stockStatus = 'out';
      else if (daysOfSupply < 7 && sold30d > 0) stockStatus = 'low';
      else if (sold30d === 0 && onHand > 0) stockStatus = 'dead';
      else if (daysOfSupply > 90 && onHand > 20) stockStatus = 'over';

      return {
        id: p.id, name: p.name, upc: p.upc, brand: p.brand,
        department: p.department?.name || '',
        onHand, onOrder, sold30d, avgDaily, daysOfSupply,
        retailValue, costValue,
        reorderPoint: p.reorderPoint, reorderQty: p.reorderQty,
        stockStatus,
        lastReceived: sp?.lastReceivedAt || null,
      };
    }).filter((p) => {
      if (type === 'low') return p.stockStatus === 'low' || p.stockStatus === 'out';
      if (type === 'dead') return p.stockStatus === 'dead';
      if (type === 'over') return p.stockStatus === 'over';
      return true;
    }).sort((a, b) => a.daysOfSupply - b.daysOfSupply);

    const stats = {
      totalProducts: inventory.length,
      outOfStock: inventory.filter((p) => p.stockStatus === 'out').length,
      lowStock: inventory.filter((p) => p.stockStatus === 'low').length,
      deadStock: inventory.filter((p) => p.stockStatus === 'dead').length,
      overStock: inventory.filter((p) => p.stockStatus === 'over').length,
      totalRetailValue: r2(inventory.reduce((s, p) => s + p.retailValue, 0)),
      totalCostValue: r2(inventory.reduce((s, p) => s + p.costValue, 0)),
    };

    res.json({ inventory, stats });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/hub/compare — Period comparison
// ═══════════════════════════════════════════════════════════════════════════

interface PeriodAgg {
  netSales: number;
  grossSales: number;
  taxTotal: number;
  txCount: number;
  avgTx: number;
  cash: number;
  card: number;
  ebt: number;
}

export const getCompareReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const storeId = req.storeId;
    const q = req.query as { from1?: string; to1?: string; from2?: string; to2?: string };
    const { from1, to1, from2, to2 } = q;
    if (!from1 || !to1 || !from2 || !to2) { res.status(400).json({ error: 'from1, to1, from2, to2 required' }); return; }

    const aggregate = async (from: string, to: string): Promise<PeriodAgg> => {
      const where: Prisma.TransactionWhereInput = { orgId, status: 'complete', createdAt: { gte: new Date(`${from}T00:00:00`), lte: new Date(`${to}T23:59:59.999`) } };
      if (storeId) where.storeId = storeId;
      const txns = await prisma.transaction.findMany({ where, select: { grandTotal: true, subtotal: true, taxTotal: true, tenderLines: true } });

      let net = 0, gross = 0, tax = 0, cash = 0, card = 0, ebt = 0;
      for (const tx of txns) {
        net += Number(tx.grandTotal) || 0;
        gross += Number(tx.subtotal) || 0;
        tax += Number(tx.taxTotal) || 0;
        const tenders: TenderLine[] = Array.isArray(tx.tenderLines) ? (tx.tenderLines as unknown as TenderLine[]) : [];
        for (const t of tenders) {
          const m = String(t.method || '').toLowerCase();
          const a = Number(t.amount) || 0;
          if (m === 'cash') cash += a;
          else if (['card', 'credit', 'debit'].includes(m)) card += a;
          else if (m === 'ebt') ebt += a;
        }
      }
      return { netSales: r2(net), grossSales: r2(gross), taxTotal: r2(tax), txCount: txns.length, avgTx: txns.length ? r2(net / txns.length) : 0, cash: r2(cash), card: r2(card), ebt: r2(ebt) };
    };

    const [period1, period2] = await Promise.all([aggregate(from1, to1), aggregate(from2, to2)]);

    const pctChange = (a: number, b: number): number => b !== 0 ? r2(((a - b) / b) * 100) : a > 0 ? 100 : 0;

    res.json({
      period1: { ...period1, from: from1, to: to1 },
      period2: { ...period2, from: from2, to: to2 },
      changes: {
        netSales: pctChange(period1.netSales, period2.netSales),
        txCount: pctChange(period1.txCount, period2.txCount),
        avgTx: pctChange(period1.avgTx, period2.avgTx),
        cash: pctChange(period1.cash, period2.cash),
        card: pctChange(period1.card, period2.card),
      },
    });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/hub/notes — Transaction notes
// ═══════════════════════════════════════════════════════════════════════════

export const getNotesReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { from?: string; to?: string };
    const { from, to } = q;
    if (!from || !to) { res.status(400).json({ error: 'from and to required' }); return; }

    const where: Prisma.TransactionWhereInput = {
      orgId: req.orgId as string, status: 'complete',
      notes: { not: null },
      createdAt: { gte: new Date(`${from}T00:00:00`), lte: new Date(`${to}T23:59:59.999`) },
    };
    if (req.storeId) where.storeId = req.storeId;

    const txns = await prisma.transaction.findMany({
      where,
      select: { id: true, txNumber: true, notes: true, grandTotal: true, cashierId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    // Filter out empty strings
    type NoteRow = (typeof txns)[number];
    const notes = (txns as NoteRow[]).filter((t) => t.notes && t.notes.trim().length > 0).map((t) => ({
      txNumber: t.txNumber,
      notes: t.notes,
      total: r2(t.grandTotal),
      cashierId: t.cashierId,
      date: t.createdAt,
    }));

    res.json({ notes, total: notes.length, period: { from, to } });
  } catch (err) { next(err); }
};
