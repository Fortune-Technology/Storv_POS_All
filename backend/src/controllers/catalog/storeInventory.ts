/**
 * Catalog — Store-level products + Stock adjustment + Ecom stock check.
 * Split from `catalogController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (4):
 *   - getStoreProducts    GET  /catalog/store-products?storeId=
 *                              (per-store overrides for retail/cost/sale price + QOH + reorder)
 *   - upsertStoreProduct  POST /catalog/store-products
 *                              (creates or updates the per-store row;
 *                              fires inventory sync to ecom)
 *   - adjustStoreStock    POST /catalog/store-products/:id/adjust
 *                              (delta or absolute, audit logged)
 *   - ecomStockCheck      POST /catalog/ecom-stock-check
 *                              (NO auth — internal service-to-service call.
 *                              Mounted BEFORE protect middleware in routes.
 *                              Requires X-Internal-Api-Key header.)
 *
 * Sale-price label: when admin sets a sale price + window on a StoreProduct,
 * `queueLabelForSale` queues a shelf-tag print job at the configured window
 * boundaries. Same hook fires when sale ends.
 *
 * Ecom stock check: ecom-backend posts a list of UPCs with requested quantities;
 * this returns per-line `available: bool` so checkout can show out-of-stock
 * messaging in real time without granting cross-DB access.
 */

import type { Request, Response } from 'express';
import prisma from '../../config/postgres.js';
import { errMsg } from '../../utils/typeHelpers.js';
import { logAudit } from '../../services/auditService.js';
import { queueLabelForSale, queueLabelForPriceChange } from '../../services/labelQueueService.js';
import { tryParseDate } from '../../utils/safeDate.js';
import {
  getOrgId,
  getStoreId,
  toPrice,
  emitInventorySync,
  paginationParams,
} from './helpers.js';

// STORE PRODUCTS
// ═══════════════════════════════════════════════════════

export const getStoreProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId =
      getStoreId(req) ||
      req.params.storeId ||
      (req.query.storeId as string | undefined) ||
      null;
    const { skip, take, page, limit } = paginationParams(req.query as Record<string, unknown>);

    if (!storeId) {
      res.status(400).json({ success: false, error: 'storeId is required' });
      return;
    }

    const where: Record<string, unknown> = {
      storeId,
      orgId,
      ...(req.query.active !== undefined && { active: req.query.active === 'true' }),
      ...(req.query.inStock !== undefined && { inStock: req.query.inStock === 'true' }),
      ...(req.query.masterProductId && {
        masterProductId: parseInt(req.query.masterProductId as string),
      }),
    };

    const [products, total] = await Promise.all([
      prisma.storeProduct.findMany({
        where,
        include: {
          masterProduct: {
            include: {
              department: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  taxClass: true,
                  ageRequired: true,
                },
              },
              vendor: { select: { id: true, name: true } },
              depositRule: { select: { id: true, depositAmount: true } },
            },
          },
        },
        orderBy: { masterProduct: { name: 'asc' } },
        skip,
        take,
      }),
      prisma.storeProduct.count({ where }),
    ]);

    res.json({
      success: true,
      data: products,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const upsertStoreProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStoreId(req) || req.body.storeId;
    const {
      masterProductId,
      retailPrice,
      costPrice,
      casePrice,
      salePrice,
      saleStart,
      saleEnd,
      quantityOnHand,
      quantityOnOrder,
      active,
      inStock,
      aisle,
      shelfLocation,
      bin,
    } = req.body;

    if (!storeId) {
      res.status(400).json({ success: false, error: 'storeId is required' });
      return;
    }
    if (!masterProductId) {
      res.status(400).json({ success: false, error: 'masterProductId is required' });
      return;
    }

    const existingSP = await prisma.storeProduct.findFirst({
      where: { masterProductId: parseInt(masterProductId), storeId },
      // quantityOnHand is needed downstream to write an InventoryAdjustment row
      // when the manual qty changes — without that snapshot the Adjustments &
      // Shrinkage report stays empty even after edits.
      select: { retailPrice: true, salePrice: true, quantityOnHand: true },
    });

    let saleStartParsed: Date | null | undefined;
    let saleEndParsed: Date | null | undefined;
    if (saleStart != null) {
      const r = tryParseDate(res, saleStart, 'saleStart');
      if (!r.ok) return;
      saleStartParsed = r.value;
    }
    if (saleEnd != null) {
      const r = tryParseDate(res, saleEnd, 'saleEnd');
      if (!r.ok) return;
      saleEndParsed = r.value;
    }

    const data: Record<string, unknown> = {
      orgId,
      ...(retailPrice != null && { retailPrice: parseFloat(retailPrice) }),
      ...(costPrice != null && { costPrice: parseFloat(costPrice) }),
      ...(casePrice != null && { casePrice: parseFloat(casePrice) }),
      ...(salePrice != null && { salePrice: parseFloat(salePrice) }),
      ...(saleStart != null && { saleStart: saleStartParsed }),
      ...(saleEnd != null && { saleEnd: saleEndParsed }),
      ...(quantityOnHand != null && {
        quantityOnHand: parseFloat(quantityOnHand),
        lastStockUpdate: new Date(),
      }),
      ...(quantityOnOrder != null && { quantityOnOrder: parseFloat(quantityOnOrder) }),
      ...(active != null && { active: Boolean(active) }),
      ...(inStock != null && { inStock: Boolean(inStock) }),
      ...(aisle != null && { aisle }),
      ...(shelfLocation != null && { shelfLocation }),
      ...(bin != null && { bin }),
    };

    const storeProduct = await prisma.storeProduct.upsert({
      where: {
        storeId_masterProductId: { storeId, masterProductId: parseInt(masterProductId) },
      },
      update: data,
      create: {
        storeId,
        orgId,
        masterProductId: parseInt(masterProductId),
        ...data,
      },
      include: {
        masterProduct: { select: { id: true, name: true, upc: true } },
      },
    });

    emitInventorySync(orgId, storeId, parseInt(masterProductId), 'update', {
      quantityOnHand: storeProduct.quantityOnHand,
      inStock: storeProduct.inStock,
      retailPrice: storeProduct.retailPrice,
      salePrice: storeProduct.salePrice,
    });

    // When the manual qty edit moves the count, record an InventoryAdjustment
    // so the Adjustments & Shrinkage report reflects every off-system change.
    // Marked as `count_correction` (already a recognised reason). Failures are
    // best-effort — a logging gap shouldn't block the inventory write.
    if (quantityOnHand != null && req.user?.id) {
      const previousQty = Math.round(Number(existingSP?.quantityOnHand ?? 0));
      const newQty      = Math.round(Number(storeProduct.quantityOnHand ?? 0));
      if (previousQty !== newQty) {
        try {
          await prisma.inventoryAdjustment.create({
            data: {
              orgId,
              storeId,
              masterProductId: parseInt(masterProductId),
              adjustmentQty: newQty - previousQty,
              previousQty,
              newQty,
              reason: 'count_correction',
              notes: 'Manual quantity edit',
              createdById: req.user.id,
            },
          });
        } catch { /* best-effort */ }
      }
    }

    try {
      const pid = String(parseInt(masterProductId));
      const b = req.body;
      if (
        b.retailPrice !== undefined &&
        existingSP?.retailPrice != null &&
        parseFloat(b.retailPrice) !== parseFloat(String(existingSP.retailPrice))
      ) {
        await queueLabelForPriceChange(orgId, storeId, pid, existingSP.retailPrice, b.retailPrice);
      }
      if (b.salePrice && (!existingSP?.salePrice || parseFloat(String(existingSP.salePrice)) === 0)) {
        await queueLabelForSale(
          orgId,
          storeId,
          pid,
          b.retailPrice || existingSP?.retailPrice,
          b.salePrice,
          false,
        );
      }
      if (
        !b.salePrice &&
        existingSP?.salePrice &&
        parseFloat(String(existingSP.salePrice)) > 0
      ) {
        await queueLabelForSale(
          orgId,
          storeId,
          pid,
          b.retailPrice || existingSP?.retailPrice,
          existingSP.salePrice,
          true,
        );
      }
    } catch {}

    res.json({ success: true, data: storeProduct });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const adjustStoreStock = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const storeId = getStoreId(req);
    const { masterProductId, adjustment, reason } = req.body;

    if (!storeId) {
      res.status(400).json({ success: false, error: 'storeId is required' });
      return;
    }
    if (!masterProductId) {
      res.status(400).json({ success: false, error: 'masterProductId is required' });
      return;
    }
    if (adjustment == null) {
      res.status(400).json({ success: false, error: 'adjustment is required' });
      return;
    }

    const existing = await prisma.storeProduct.findUnique({
      where: {
        storeId_masterProductId: { storeId, masterProductId: parseInt(masterProductId) },
      },
    });

    const currentQty = parseFloat(String(existing?.quantityOnHand ?? 0));
    const newQty = currentQty + parseFloat(adjustment);

    const positivReceive = parseFloat(adjustment) > 0;
    const updated = await prisma.storeProduct.upsert({
      where: {
        storeId_masterProductId: { storeId, masterProductId: parseInt(masterProductId) },
      },
      update: {
        quantityOnHand: newQty,
        lastStockUpdate: new Date(),
        lastReceivedAt: positivReceive ? new Date() : undefined,
        posSyncSource: reason?.includes('Invoice') ? 'invoice' : 'manual',
        inStock: newQty > 0 ? true : (existing?.inStock ?? false),
      },
      create: {
        storeId,
        orgId,
        masterProductId: parseInt(masterProductId),
        quantityOnHand: newQty,
        lastStockUpdate: new Date(),
        lastReceivedAt: positivReceive ? new Date() : undefined,
        posSyncSource: reason?.includes('Invoice') ? 'invoice' : 'manual',
        inStock: newQty > 0,
      },
    });

    emitInventorySync(orgId, storeId, parseInt(masterProductId), 'update', {
      quantityOnHand: newQty,
      inStock: updated.inStock,
    });
    res.json({
      success: true,
      data: updated,
      previousQty: currentQty,
      newQty,
      adjustment: parseFloat(adjustment),
      reason: reason || 'manual',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ─────────────────────────────────────────────────
// E-COMMERCE STOCK CHECK
// ─────────────────────────────────────────────────

interface EcomStockItem {
  posProductId: number | string;
  requestedQty: number | string;
}

export const ecomStockCheck = async (req: Request, res: Response): Promise<void> => {
  try {
    const provided =
      req.get('x-internal-api-key') || req.get('X-Internal-Api-Key') || undefined;
    const expected = process.env.INTERNAL_API_KEY;
    if (!expected || provided !== expected) {
      res.status(401).json({ available: false, error: 'Unauthorized' });
      return;
    }

    const { storeId, items } = req.body as { storeId?: string; items?: EcomStockItem[] };

    if (!storeId || !Array.isArray(items)) {
      res.status(400).json({ available: false, error: 'storeId and items[] required' });
      return;
    }

    const productIds = items
      .map((i) => parseInt(String(i.posProductId)))
      .filter((id) => !isNaN(id) && id > 0);

    if (productIds.length === 0) {
      res.json({
        available: true,
        items: items.map((i) => ({
          posProductId: i.posProductId,
          requestedQty: i.requestedQty,
          quantityOnHand: null,
          available: true,
        })),
      });
      return;
    }

    type SPRow = {
      masterProductId: number;
      quantityOnHand: number | string | null;
      inStock: boolean;
      retailPrice: number | string | null;
    };
    const storeProductsRaw = await prisma.storeProduct.findMany({
      where: {
        storeId,
        masterProductId: { in: productIds },
      },
      select: {
        masterProductId: true,
        quantityOnHand: true,
        inStock: true,
        retailPrice: true,
      },
    });
    const storeProducts = storeProductsRaw as SPRow[];

    const spMap: Record<number, SPRow> = {};
    for (const sp of storeProducts) {
      spMap[sp.masterProductId] = sp;
    }

    let allAvailable = true;
    const result = items.map((item) => {
      const sp = spMap[parseInt(String(item.posProductId))];
      const qty = sp ? parseFloat(String(sp.quantityOnHand ?? 0)) : 0;
      const requested = parseFloat(String(item.requestedQty));
      const available = !sp || qty >= requested || !sp.inStock === false;

      if (!available) allAvailable = false;

      return {
        posProductId: parseInt(String(item.posProductId)),
        requestedQty: requested,
        quantityOnHand: qty,
        available,
      };
    });

    res.json({ available: allAvailable, items: result });
  } catch (err) {
    res.status(500).json({ available: false, error: errMsg(err) });
  }
};

// ─────────────────────────────────────────────────
// PROMOTIONS
// ─────────────────────────────────────────────────

