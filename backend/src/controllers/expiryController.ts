/**
 * Expiry Tracking — S73
 *
 * Per-store product expiry-date tracking. Backs the new ExpiryTracker portal
 * page (similar UX to InventoryCount: scan a product, set a date) and feeds
 * F28 AI promo suggestions ("This dairy expires in 3 days, suggest 25% off").
 *
 * Endpoints:
 *   GET    /catalog/expiry                   — list with filters
 *   GET    /catalog/expiry/summary           — counts per status bucket
 *   PUT    /catalog/expiry/:productId        — set/update expiry date
 *   DELETE /catalog/expiry/:productId        — clear expiry tracking
 *   GET    /catalog/dead-stock               — products with stock but no recent sales
 *
 * All endpoints require an active storeId (from X-Store-Id header) since
 * expiry is per-store. Endpoint returns 400 if no storeId in scope.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { tryParseDate } from '../utils/safeDate.js';

function getOrgId(req: Request): string {
  return (req.orgId || req.user?.orgId) as string;
}

function getStoreId(req: Request, res: Response): string | null {
  const storeId = req.storeId
    || (req.headers['x-store-id'] as string | undefined)
    || (req.query.storeId as string | undefined)
    || null;
  if (!storeId) {
    res.status(400).json({
      success: false,
      error: 'storeId required (X-Store-Id header or ?storeId=). Expiry tracking is per-store.',
    });
    return null;
  }
  return storeId;
}

// Status bucket helper. Mirrors the frontend buckets so backend + UI agree.
function classify(expiryDate: Date | null, today: Date): 'expired' | 'today' | 'soon' | 'approaching' | 'fresh' | 'untracked' {
  if (!expiryDate) return 'untracked';
  const ms = expiryDate.getTime() - today.getTime();
  const days = ms / (1000 * 60 * 60 * 24);
  if (days < 0)   return 'expired';
  if (days < 1)   return 'today';
  if (days < 4)   return 'soon';        // expires in 1-3 days
  if (days < 8)   return 'approaching'; // expires in 4-7 days
  return 'fresh';
}

interface StoreProductWithProduct {
  storeId: string;
  masterProductId: number;
  quantityOnHand: Prisma.Decimal | null;
  expiryDate: Date | null;
  expiryUpdatedAt: Date | null;
  expiryNotes: string | null;
  masterProduct: {
    id: number;
    name: string;
    upc: string | null;
    brand: string | null;
    defaultRetailPrice: Prisma.Decimal | null;
    defaultCostPrice: Prisma.Decimal | null;
    departmentId: number | null;
    department: { id: number; name: string; color: string | null } | null;
    productGroupId: number | null;
    active: boolean;
    deleted: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────
// GET /catalog/expiry  — list products with expiry status
// ─────────────────────────────────────────────────────────────────────
//
// Query params:
//   window=N        — only show products expiring within N days (and any
//                     already expired). Default: 14. Pass `0` for "any".
//   status=BUCKET   — restrict to a status bucket (expired | today | soon |
//                     approaching | fresh | untracked | tracked).
//                     "tracked" = anything except untracked.
//   departmentId=X  — restrict to one dept
//   q=text          — search by product name / UPC
//   includeUntracked=true — when set + status not given, also include
//                     products with no expiryDate (everything in stock)
export const listExpiry = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStoreId(req, res);
    if (!storeId) return;

    const window = req.query.window != null ? parseInt(String(req.query.window)) : 14;
    const status = req.query.status as string | undefined;
    const departmentId = req.query.departmentId ? parseInt(String(req.query.departmentId)) : null;
    const q = (req.query.q as string | undefined)?.trim() || '';
    const includeUntracked = req.query.includeUntracked === 'true';

    const where: Prisma.StoreProductWhereInput = {
      storeId,
      masterProduct: {
        orgId,
        active: true,
        deleted: false,
        ...(departmentId ? { departmentId } : {}),
        ...(q ? { OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { upc: { contains: q } },
          { brand: { contains: q, mode: 'insensitive' } },
        ] } : {}),
      },
    };

    // Only include rows the admin actually cares about. Default = anything
    // with an expiryDate (regardless of how soon). Window narrows it.
    if (!includeUntracked && status !== 'untracked') {
      (where as Record<string, unknown>).expiryDate = { not: null };
    }

    if (window > 0 && !includeUntracked) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + window);
      // Include already-expired (date < now) AND anything expiring within the window
      (where as Record<string, unknown>).expiryDate = { not: null, lte: cutoff };
    }

    const rows = await prisma.storeProduct.findMany({
      where,
      take: 500,
      include: {
        masterProduct: {
          select: {
            id: true, name: true, upc: true, brand: true,
            defaultRetailPrice: true, defaultCostPrice: true,
            departmentId: true,
            department: { select: { id: true, name: true, color: true } },
            productGroupId: true,
            active: true, deleted: true,
          },
        },
      },
    }) as unknown as StoreProductWithProduct[];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const items = rows.map((r) => {
      const bucket = classify(r.expiryDate, today);
      const onHand = Number(r.quantityOnHand) || 0;
      const retailValue = onHand * (Number(r.masterProduct.defaultRetailPrice) || 0);
      const daysUntilExpiry = r.expiryDate
        ? Math.floor((r.expiryDate.getTime() - today.getTime()) / (86_400_000))
        : null;
      return {
        productId: r.masterProductId,
        name: r.masterProduct.name,
        upc: r.masterProduct.upc,
        brand: r.masterProduct.brand,
        department: r.masterProduct.department,
        productGroupId: r.masterProduct.productGroupId,
        retailPrice: r.masterProduct.defaultRetailPrice ? Number(r.masterProduct.defaultRetailPrice) : null,
        onHand,
        retailValue: Math.round(retailValue * 100) / 100,
        expiryDate: r.expiryDate,
        expiryUpdatedAt: r.expiryUpdatedAt,
        expiryNotes: r.expiryNotes,
        daysUntilExpiry,
        status: bucket,
      };
    });

    const filtered = status && status !== 'all'
      ? items.filter((it) => {
          if (status === 'tracked') return it.status !== 'untracked';
          return it.status === status;
        })
      : items;

    // Sort: most-urgent (expired) first, then by date asc, untracked last
    const ORDER: Record<string, number> = { expired: 0, today: 1, soon: 2, approaching: 3, fresh: 4, untracked: 5 };
    filtered.sort((a, b) => {
      const oa = ORDER[a.status] ?? 9;
      const ob = ORDER[b.status] ?? 9;
      if (oa !== ob) return oa - ob;
      if (a.daysUntilExpiry == null && b.daysUntilExpiry == null) return 0;
      if (a.daysUntilExpiry == null) return 1;
      if (b.daysUntilExpiry == null) return -1;
      return a.daysUntilExpiry - b.daysUntilExpiry;
    });

    res.json({ success: true, data: filtered, total: filtered.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
};

// ─────────────────────────────────────────────────────────────────────
// GET /catalog/expiry/summary — quick counts per bucket
// ─────────────────────────────────────────────────────────────────────
export const getExpirySummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStoreId(req, res);
    if (!storeId) return;

    const rows = await prisma.storeProduct.findMany({
      where: {
        storeId,
        masterProduct: { orgId, active: true, deleted: false },
      },
      select: { expiryDate: true, quantityOnHand: true, masterProduct: { select: { defaultRetailPrice: true } } },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const buckets: Record<string, { count: number; valueAtRisk: number }> = {
      expired:     { count: 0, valueAtRisk: 0 },
      today:       { count: 0, valueAtRisk: 0 },
      soon:        { count: 0, valueAtRisk: 0 },
      approaching: { count: 0, valueAtRisk: 0 },
      fresh:       { count: 0, valueAtRisk: 0 },
      untracked:   { count: 0, valueAtRisk: 0 },
    };

    for (const r of rows) {
      const b = classify(r.expiryDate as Date | null, today);
      buckets[b].count++;
      if (b !== 'untracked' && b !== 'fresh') {
        const onHand = Number((r as { quantityOnHand: unknown }).quantityOnHand) || 0;
        const price = Number((r as { masterProduct: { defaultRetailPrice: unknown } }).masterProduct.defaultRetailPrice) || 0;
        buckets[b].valueAtRisk += onHand * price;
      }
    }

    for (const k of Object.keys(buckets)) {
      buckets[k].valueAtRisk = Math.round(buckets[k].valueAtRisk * 100) / 100;
    }

    res.json({ success: true, data: buckets });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
};

// ─────────────────────────────────────────────────────────────────────
// PUT /catalog/expiry/:productId — set/update expiry date
// ─────────────────────────────────────────────────────────────────────
export const setExpiry = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStoreId(req, res);
    if (!storeId) return;

    const productId = parseInt(req.params.productId);
    if (!productId || Number.isNaN(productId)) {
      res.status(400).json({ success: false, error: 'productId required.' });
      return;
    }

    // Verify product belongs to this org
    const product = await prisma.masterProduct.findFirst({
      where: { id: productId, orgId, deleted: false },
      select: { id: true, name: true },
    });
    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found in this organization.' });
      return;
    }

    const dateRes = tryParseDate(res, req.body?.expiryDate, 'expiryDate');
    if (!dateRes.ok) return;

    const notes: string | null = req.body?.expiryNotes != null
      ? String(req.body.expiryNotes).slice(0, 500)
      : null;

    // Upsert StoreProduct row — create if it doesn't exist yet for this store
    const updated = await prisma.storeProduct.upsert({
      where: { storeId_masterProductId: { storeId, masterProductId: productId } },
      create: {
        orgId,
        storeId,
        masterProductId: productId,
        expiryDate: dateRes.value,
        expiryUpdatedAt: new Date(),
        expiryNotes: notes,
      },
      update: {
        expiryDate: dateRes.value,
        expiryUpdatedAt: new Date(),
        expiryNotes: notes,
      },
      select: {
        masterProductId: true,
        expiryDate: true,
        expiryUpdatedAt: true,
        expiryNotes: true,
      },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
};

// ─────────────────────────────────────────────────────────────────────
// DELETE /catalog/expiry/:productId — clear expiry tracking
// ─────────────────────────────────────────────────────────────────────
export const clearExpiry = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStoreId(req, res);
    if (!storeId) return;

    const productId = parseInt(req.params.productId);
    if (!productId || Number.isNaN(productId)) {
      res.status(400).json({ success: false, error: 'productId required.' });
      return;
    }

    // Verify product belongs to this org (defensive — also blocks cross-tenant clears)
    const product = await prisma.masterProduct.findFirst({
      where: { id: productId, orgId },
      select: { id: true },
    });
    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found in this organization.' });
      return;
    }

    const sp = await prisma.storeProduct.findUnique({
      where: { storeId_masterProductId: { storeId, masterProductId: productId } },
      select: { storeId: true },
    });
    if (!sp) {
      // Nothing to clear — treat as no-op
      res.json({ success: true, data: { cleared: false } });
      return;
    }

    await prisma.storeProduct.update({
      where: { storeId_masterProductId: { storeId, masterProductId: productId } },
      data: { expiryDate: null, expiryUpdatedAt: new Date(), expiryNotes: null },
    });

    res.json({ success: true, data: { cleared: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
};

// ─────────────────────────────────────────────────────────────────────
// GET /catalog/dead-stock — products with stock but no recent sales
// ─────────────────────────────────────────────────────────────────────
//
// Complements the existing /reports/hub/inventory dead-stock classifier,
// which uses a fixed 30-day window. This endpoint accepts ?days=N so the
// AI Assistant + admins can ask "what hasn't moved in 60 days" or
// "in 90 days". Returns onHand × retailPrice as `valueAtRisk` so admins
// can prioritise by $ stuck on the shelf.
//
// Query: days=30 (default) | minOnHand=1 | departmentId=X
interface ProductRowWithStore {
  id: number;
  name: string;
  upc: string | null;
  brand: string | null;
  defaultRetailPrice: Prisma.Decimal | null;
  defaultCostPrice: Prisma.Decimal | null;
  department: { id: number; name: string } | null;
  productGroupId: number | null;
  storeProducts: Array<{
    quantityOnHand: Prisma.Decimal | null;
    expiryDate: Date | null;
    lastReceivedAt: Date | null;
  }>;
}
interface LineItemMin { productId?: number | string; qty?: number; isLottery?: boolean; isBottleReturn?: boolean }

export const getDeadStock = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = getStoreId(req, res);
    if (!storeId) return;

    const days = req.query.days ? Math.max(1, parseInt(String(req.query.days))) : 30;
    const minOnHand = req.query.minOnHand ? Math.max(0, parseFloat(String(req.query.minOnHand))) : 1;
    const departmentId = req.query.departmentId ? parseInt(String(req.query.departmentId)) : null;

    // Pull every active product with a positive on-hand at this store
    const productsRaw = await prisma.masterProduct.findMany({
      where: {
        orgId, active: true, deleted: false, trackInventory: true,
        ...(departmentId ? { departmentId } : {}),
      },
      select: {
        id: true, name: true, upc: true, brand: true,
        defaultRetailPrice: true, defaultCostPrice: true,
        department: { select: { id: true, name: true } },
        productGroupId: true,
        storeProducts: {
          where: { storeId },
          select: { quantityOnHand: true, expiryDate: true, lastReceivedAt: true },
          take: 1,
        },
      },
    });
    const products = productsRaw as unknown as ProductRowWithStore[];

    // Pull qty sold per product across the window
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const txns = await prisma.transaction.findMany({
      where: { orgId, storeId, status: 'complete', createdAt: { gte: cutoff } },
      select: { lineItems: true, createdAt: true },
    });

    // Map product → sold qty + most recent sale date
    const sold: Record<string, { qty: number; lastSold: Date | null }> = {};
    for (const tx of txns) {
      const items: LineItemMin[] = Array.isArray(tx.lineItems)
        ? (tx.lineItems as unknown as LineItemMin[])
        : [];
      for (const li of items) {
        if (!li.productId || li.isLottery || li.isBottleReturn) continue;
        const k = String(li.productId);
        const cur = sold[k] || { qty: 0, lastSold: null };
        cur.qty += Number(li.qty) || 1;
        if (!cur.lastSold || tx.createdAt > cur.lastSold) cur.lastSold = tx.createdAt;
        sold[k] = cur;
      }
    }

    // Also need to look back further for "lastSoldAt" — not just the window —
    // since admin wants to see "this hasn't sold in 6 months" not "no sales
    // in last 30 days but had one yesterday". One extra query, far broader window.
    const wayBack = new Date();
    wayBack.setDate(wayBack.getDate() - 365);
    const olderTxns = await prisma.transaction.findMany({
      where: { orgId, storeId, status: 'complete', createdAt: { gte: wayBack, lt: cutoff } },
      select: { lineItems: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const lastSoldHistory: Record<string, Date> = {};
    for (const tx of olderTxns) {
      const items: LineItemMin[] = Array.isArray(tx.lineItems)
        ? (tx.lineItems as unknown as LineItemMin[])
        : [];
      for (const li of items) {
        if (!li.productId || li.isLottery || li.isBottleReturn) continue;
        const k = String(li.productId);
        if (!lastSoldHistory[k]) lastSoldHistory[k] = tx.createdAt;
      }
    }

    const today = new Date();
    const deadStock = products
      .map((p) => {
        const sp = p.storeProducts[0];
        const onHand = Number(sp?.quantityOnHand) || 0;
        const soldEntry = sold[String(p.id)];
        const soldInWindow = soldEntry?.qty || 0;
        const lastSold = soldEntry?.lastSold || lastSoldHistory[String(p.id)] || null;
        const daysSinceSold = lastSold
          ? Math.floor((today.getTime() - lastSold.getTime()) / 86_400_000)
          : null;
        return {
          id: p.id,
          name: p.name,
          upc: p.upc,
          brand: p.brand,
          department: p.department,
          productGroupId: p.productGroupId,
          retailPrice: p.defaultRetailPrice ? Number(p.defaultRetailPrice) : null,
          costPrice: p.defaultCostPrice ? Number(p.defaultCostPrice) : null,
          onHand,
          soldInWindow,
          lastSoldAt: lastSold,
          daysSinceSold,
          expiryDate: sp?.expiryDate || null,
          lastReceivedAt: sp?.lastReceivedAt || null,
          retailValueAtRisk: Math.round(onHand * (Number(p.defaultRetailPrice) || 0) * 100) / 100,
          costValueAtRisk: Math.round(onHand * (Number(p.defaultCostPrice) || 0) * 100) / 100,
        };
      })
      .filter((p) => p.onHand >= minOnHand && p.soldInWindow === 0)
      .sort((a, b) => b.retailValueAtRisk - a.retailValueAtRisk); // biggest value-at-risk first

    const totalRetailValueAtRisk = Math.round(
      deadStock.reduce((s, p) => s + p.retailValueAtRisk, 0) * 100,
    ) / 100;
    const totalCostValueAtRisk = Math.round(
      deadStock.reduce((s, p) => s + p.costValueAtRisk, 0) * 100,
    ) / 100;

    res.json({
      success: true,
      data: deadStock,
      meta: {
        days,
        storeId,
        productsScanned: products.length,
        deadStockCount: deadStock.length,
        totalRetailValueAtRisk,
        totalCostValueAtRisk,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
};
