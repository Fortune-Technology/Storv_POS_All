/**
 * Catalog — Per-product UPCs + Pack Sizes (cashier picker variants).
 * Split from `catalogController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (8):
 *   Product UPCs (3) — multiple barcodes per product:
 *     - getProductUpcs    GET    /catalog/products/:id/upcs
 *     - addProductUpc     POST   /catalog/products/:id/upcs
 *     - deleteProductUpc  DELETE /catalog/products/:id/upcs/:upcId
 *
 *   Product Pack Sizes (5) — cashier picker at scan time:
 *     - getProductPackSizes      GET    /catalog/products/:id/pack-sizes
 *     - addProductPackSize       POST   /catalog/products/:id/pack-sizes
 *     - updateProductPackSize    PUT    /catalog/products/:id/pack-sizes/:sizeId
 *     - deleteProductPackSize    DELETE /catalog/products/:id/pack-sizes/:sizeId
 *     - bulkReplacePackSizes     POST   /catalog/products/:id/pack-sizes/bulk-replace
 *
 * Pack sizes drive the multi-pack picker modal that opens when a cashier scans
 * a product with `packSizes.length > 1`. The `isDefault: true` row is the
 * pre-selected option. unitCount is the multiplier applied to the cart line's
 * `qty` (e.g. a 6-pack with unitCount=6 adds 6 units to the cart).
 *
 * On every mutation, `touchMasterProduct` bumps the parent's `updatedAt`
 * timestamp so the cashier-app's incremental sync picks up the change. Without
 * the bump, freshly-configured pack sizes never reach IndexedDB and the
 * cashier never sees the picker on scan. (See helpers.touchMasterProduct.)
 *
 * UPC uniqueness: addProductUpc runs `assertUpcUnique` checking BOTH the
 * legacy MasterProduct.upc field AND the ProductUpc multi-UPC table —
 * prevents the conflict where a barcode resolved to multiple candidate
 * products.
 */

import type { Request, Response } from 'express';
import prisma from '../../config/postgres.js';
import { errMsg, errCode, errStatus } from '../../utils/typeHelpers.js';
import { normalizeUPC } from '../../utils/upc.js';
import {
  getOrgId,
  toPrice,
  assertUpcUnique,
  touchMasterProduct,
  type CatalogStatusError,
} from './helpers.js';

// ═══════════════════════════════════════════════════════
// PRODUCT UPCs  (multiple barcodes per product)
// ═══════════════════════════════════════════════════════

export const getProductUpcs = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const upcs = await prisma.productUpc.findMany({
      where: { orgId, masterProductId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({ success: true, data: upcs });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const addProductUpc = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const masterProductId = parseInt(req.params.id);
    const { upc, label, isDefault } = req.body;

    if (!upc) {
      res.status(400).json({ success: false, error: 'upc is required' });
      return;
    }

    const normalizedUpc = normalizeUPC(upc) || String(upc).replace(/[\s\-\.]/g, '');

    const product = await prisma.masterProduct.findFirst({
      where: { id: masterProductId, orgId },
    });
    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    try {
      await assertUpcUnique(prisma, orgId, normalizedUpc, masterProductId);
    } catch (err) {
      if (errStatus(err) === 409) {
        const conflict = (err as CatalogStatusError).conflict;
        res.status(409).json({ success: false, error: errMsg(err), conflict });
        return;
      }
      throw err;
    }

    if (isDefault) {
      await prisma.productUpc.updateMany({
        where: { orgId, masterProductId },
        data: { isDefault: false },
      });
    }

    const row = await prisma.productUpc.create({
      data: {
        orgId,
        masterProductId,
        upc: normalizedUpc,
        label: label || null,
        isDefault: Boolean(isDefault),
      },
    });
    await touchMasterProduct(orgId, masterProductId);
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    if (errCode(err) === 'P2002') {
      res
        .status(409)
        .json({ success: false, error: 'This UPC is already registered to another product' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deleteProductUpc = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const upcId = req.params.upcId;
    await prisma.productUpc.deleteMany({ where: { id: upcId, orgId, masterProductId } });
    await touchMasterProduct(orgId, masterProductId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ═══════════════════════════════════════════════════════
// PRODUCT PACK SIZES  (cashier picker at scan time)
// ═══════════════════════════════════════════════════════

export const getProductPackSizes = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const sizes = await prisma.productPackSize.findMany({
      where: { orgId, masterProductId },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: sizes });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const addProductPackSize = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const masterProductId = parseInt(req.params.id);
    const {
      label,
      unitCount,
      packsPerCase,
      retailPrice,
      costPrice,
      isDefault,
      sortOrder,
    } = req.body;

    if (!label || retailPrice == null) {
      res.status(400).json({ success: false, error: 'label and retailPrice are required' });
      return;
    }

    const product = await prisma.masterProduct.findFirst({
      where: { id: masterProductId, orgId },
    });
    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    if (isDefault) {
      await prisma.productPackSize.updateMany({
        where: { orgId, masterProductId },
        data: { isDefault: false },
      });
    }

    const row = await prisma.productPackSize.create({
      data: {
        orgId,
        masterProductId,
        label,
        unitCount: unitCount ? parseInt(unitCount) : 1,
        packsPerCase: packsPerCase ? parseInt(packsPerCase) : null,
        retailPrice: parseFloat(retailPrice),
        costPrice: costPrice ? parseFloat(costPrice) : null,
        isDefault: Boolean(isDefault),
        sortOrder: sortOrder ? parseInt(sortOrder) : 0,
      },
    });
    await touchMasterProduct(orgId, masterProductId);
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateProductPackSize = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const sizeId = req.params.sizeId;
    const {
      label,
      unitCount,
      packsPerCase,
      retailPrice,
      costPrice,
      isDefault,
      sortOrder,
    } = req.body;

    if (isDefault) {
      await prisma.productPackSize.updateMany({
        where: { orgId, masterProductId },
        data: { isDefault: false },
      });
    }

    const row = await prisma.productPackSize.update({
      where: { id: sizeId },
      data: {
        ...(label !== undefined && { label }),
        ...(unitCount !== undefined && { unitCount: parseInt(unitCount) }),
        ...(packsPerCase !== undefined && {
          packsPerCase: packsPerCase ? parseInt(packsPerCase) : null,
        }),
        ...(retailPrice !== undefined && { retailPrice: parseFloat(retailPrice) }),
        ...(costPrice !== undefined && { costPrice: costPrice ? parseFloat(costPrice) : null }),
        ...(isDefault !== undefined && { isDefault: Boolean(isDefault) }),
        ...(sortOrder !== undefined && { sortOrder: parseInt(sortOrder) }),
      },
    });
    await touchMasterProduct(orgId, masterProductId);
    res.json({ success: true, data: row });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Pack size not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deleteProductPackSize = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const sizeId = req.params.sizeId;
    await prisma.productPackSize.deleteMany({ where: { id: sizeId, orgId } });
    await touchMasterProduct(orgId, masterProductId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ═══════════════════════════════════════════════════════
// BULK REPLACE PACK SIZES
// ═══════════════════════════════════════════════════════

interface PackSizeInput {
  label?: string;
  unitCount?: number | string;
  packsPerCase?: number | string;
  retailPrice?: number | string;
  costPrice?: number | string;
  isDefault?: boolean;
}

export const bulkReplacePackSizes = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const masterProductId = parseInt(req.params.id);
    const { sizes = [] } = req.body as { sizes?: PackSizeInput[] };

    const product = await prisma.masterProduct.findFirst({
      where: { id: masterProductId, orgId },
    });
    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    await prisma.$transaction([
      prisma.productPackSize.deleteMany({ where: { orgId, masterProductId } }),
      ...(sizes.length > 0
        ? [
            prisma.productPackSize.createMany({
              data: sizes.map((s, idx) => ({
                orgId,
                masterProductId,
                label: s.label || `Pack ${idx + 1}`,
                unitCount: s.unitCount ? parseInt(String(s.unitCount)) : 1,
                packsPerCase: s.packsPerCase ? parseInt(String(s.packsPerCase)) : null,
                retailPrice: parseFloat(String(s.retailPrice || 0)),
                costPrice: s.costPrice ? parseFloat(String(s.costPrice)) : null,
                isDefault: Boolean(s.isDefault),
                sortOrder: idx,
              })),
            }),
          ]
        : []),
    ]);

    const created = await prisma.productPackSize.findMany({
      where: { orgId, masterProductId },
      orderBy: { sortOrder: 'asc' },
    });

    await touchMasterProduct(orgId, masterProductId);

    res.json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

