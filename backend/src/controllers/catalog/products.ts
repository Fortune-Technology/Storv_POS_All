/**
 * Catalog — Master Products (the largest sub-domain).
 * Split from `catalogController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers (13):
 *   Reads:
 *     - getMasterProducts      GET /catalog/products      (paginated list)
 *     - exportMasterProducts   GET /catalog/products/export (CSV/XLSX)
 *     - searchMasterProducts   GET /catalog/products/search (cashier-app: barcode + fuzzy)
 *     - getMasterProduct       GET /catalog/products/:id
 *
 *   Mutations:
 *     - createMasterProduct    POST /catalog/products
 *     - duplicateMasterProduct POST /catalog/products/:id/duplicate
 *     - updateMasterProduct    PUT  /catalog/products/:id
 *     - deleteMasterProduct    DELETE /catalog/products/:id
 *     - bulkUpdateMasterProducts  POST /catalog/products/bulk-update
 *     - bulkDeleteMasterProducts  POST /catalog/products/bulk-delete
 *     - bulkSetDepartment      POST /catalog/products/bulk-set-department
 *     - bulkToggleActive       POST /catalog/products/bulk-toggle-active
 *     - deleteAllProducts      DELETE /catalog/products/all (nuclear option)
 *
 * Internal helpers:
 *   - syncPrimaryUpc — keeps the ProductUpc table in sync with the legacy
 *     MasterProduct.upc field (the "primary" barcode). Throws P2002-flavoured
 *     error on cross-product UPC collision so handlers can return 409.
 *
 * UPC uniqueness: every create/update path runs `assertUpcUnique` from
 * helpers.ts — checks both legacy MasterProduct.upc and the multi-UPC
 * ProductUpc table. Returns 409 with the conflicting product name+id.
 *
 * Sync emitters: every mutation fires `emitProductSync` (no-op when @storeveu/queue
 * isn't installed) so e-commerce mirror picks up changes.
 *
 * Label queue: price changes + new products + sale flips queue label-print
 * jobs via `labelQueueService` (S64).
 *
 * Audit: every mutation calls `logAudit` with field-level diff via
 * `auditDiff` (S51 audit logging refactor).
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import prisma from '../../config/postgres.js';
import { errMsg, errCode, errStatus } from '../../utils/typeHelpers.js';
import { logAudit } from '../../services/auditService.js';
import { computeDiff } from '../../services/auditDiff.js';
import { normalizeUPC, upcVariants } from '../../utils/upc.js';
import { batchResolveProductImages } from '../../services/globalImageService.js';
import {
  queueLabelForPriceChange,
  queueLabelForNewProduct,
  queueLabelForSale,
} from '../../services/labelQueueService.js';
import { tryParseDate } from '../../utils/safeDate.js';
import {
  getOrgId,
  toPrice,
  emitProductSync,
  paginationParams,
  flattenDeposit,
  assertUpcUnique,
  type CatalogStatusError,
  type ProductRowLite,
  type TaxRuleRow,
  type ProductUpcRow,
  type ProductPackSizeRow,
} from './helpers.js';

export const getMasterProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { skip, take, page, limit } = paginationParams(req.query as Record<string, unknown>);
    const includeDeleted = req.query.includeDeleted === 'true';
    // When a storeId is supplied (X-Store-Id header or ?storeId param), include
    // that store's StoreProduct row so the catalog list can show On-Hand etc.
    const storeIdRaw =
      (req.query.storeId as string | undefined) ||
      (req.headers['x-store-id'] as string | undefined) ||
      req.storeId ||
      null;
    const storeId = storeIdRaw || null;

    const where: Record<string, unknown> = {
      orgId,
      deleted: includeDeleted ? undefined : false,
      ...(req.query.departmentId && {
        departmentId: parseInt(req.query.departmentId as string),
      }),
      ...(req.query.vendorId && { vendorId: parseInt(req.query.vendorId as string) }),
      ...(req.query.active !== undefined && { active: req.query.active === 'true' }),
    };

    const sortDir: 'asc' | 'desc' = req.query.sortDir === 'desc' ? 'desc' : 'asc';
    const PRODUCT_SORT_MAP: Record<string, unknown> = {
      name: { name: sortDir },
      brand: { brand: sortDir },
      upc: { upc: sortDir },
      sku: { sku: sortDir },
      pack: { casePacks: sortDir },
      cost: { defaultCostPrice: sortDir },
      retail: { defaultRetailPrice: sortDir },
      department: { department: { name: sortDir } },
      vendor: { vendor: { name: sortDir } },
      active: { active: sortDir },
      createdAt: { createdAt: sortDir },
      updatedAt: { updatedAt: sortDir },
    };
    const orderBy = PRODUCT_SORT_MAP[req.query.sortBy as string] || { name: 'asc' };

    const [productsRaw, total] = await Promise.all([
      prisma.masterProduct.findMany({
        where,
        include: {
          department: { select: { id: true, name: true, code: true, taxClass: true } },
          vendor: { select: { id: true, name: true, code: true } },
          depositRule: { select: { id: true, name: true, depositAmount: true } },
          ...(storeId && {
            storeProducts: {
              where: { storeId },
              select: {
                quantityOnHand: true,
                retailPrice: true,
                costPrice: true,
                inStock: true,
              },
              take: 1,
            },
          }),
        },
        orderBy,
        skip,
        take,
      }),
      prisma.masterProduct.count({ where }),
    ]);
    const products = productsRaw as ProductRowLite[];

    // Resolve images from global cache for products missing imageUrl
    const imageMap = await batchResolveProductImages(products);

    // Flatten per-store fields + resolve images + deposit
    const enriched = products.map((p) => {
      const sp = storeId ? p.storeProducts?.[0] : null;
      return flattenDeposit({
        ...p,
        imageUrl: p.imageUrl || imageMap.get(p.id) || null,
        ...(sp
          ? {
              quantityOnHand: sp.quantityOnHand != null ? Number(sp.quantityOnHand) : null,
              storeRetailPrice: sp.retailPrice != null ? Number(sp.retailPrice) : null,
              storeCostPrice: sp.costPrice != null ? Number(sp.costPrice) : null,
              inStock: sp.inStock ?? null,
            }
          : {}),
      });
    });

    res.json({
      success: true,
      data: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const exportMasterProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId =
      (req.query.storeId as string | undefined) ||
      (req.headers['x-store-id'] as string | undefined) ||
      req.storeId ||
      null;
    const includeDeleted = req.query.includeDeleted === 'true';
    const activeOnly = req.query.activeOnly === 'true';

    const where = {
      orgId,
      ...(includeDeleted ? {} : { deleted: false }),
      ...(activeOnly && { active: true }),
    };

    const [productsRaw, alternateUpcsRaw, packSizesRaw, store] = await Promise.all([
      prisma.masterProduct.findMany({
        where,
        include: {
          department: { select: { id: true, name: true, code: true } },
          vendor: { select: { id: true, name: true, code: true } },
          productGroup: { select: { id: true, name: true } },
          ...(storeId && {
            storeProducts: {
              where: { storeId },
              select: {
                quantityOnHand: true,
                retailPrice: true,
                costPrice: true,
                inStock: true,
              },
              take: 1,
            },
          }),
        },
        orderBy: [{ name: 'asc' }],
      }),
      prisma.productUpc.findMany({
        where: { orgId, isDefault: false },
        select: { masterProductId: true, upc: true, label: true },
        orderBy: [{ masterProductId: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.productPackSize.findMany({
        where: { orgId },
        select: {
          masterProductId: true,
          label: true,
          unitCount: true,
          retailPrice: true,
          isDefault: true,
          sortOrder: true,
        },
        orderBy: [{ masterProductId: 'asc' }, { sortOrder: 'asc' }],
      }),
      storeId
        ? prisma.store.findUnique({ where: { id: storeId }, select: { name: true } })
        : null,
    ]);
    const products = productsRaw as ProductRowLite[];
    const alternateUpcs = alternateUpcsRaw as ProductUpcRow[];
    const packSizes = packSizesRaw as ProductPackSizeRow[];

    const altByProduct = new Map<number, string[]>();
    for (const a of alternateUpcs) {
      const list = altByProduct.get(a.masterProductId) || [];
      list.push(a.upc);
      altByProduct.set(a.masterProductId, list);
    }
    const packsByProduct = new Map<number, ProductPackSizeRow[]>();
    for (const p of packSizes) {
      const list = packsByProduct.get(p.masterProductId) || [];
      list.push(p);
      packsByProduct.set(p.masterProductId, list);
    }

    const rows = products.map((p) => {
      const sp = storeId ? p.storeProducts?.[0] : null;
      const alts = altByProduct.get(p.id) || [];
      const packs = packsByProduct.get(p.id) || [];
      const packOptions = packs
        .map((pk) => {
          const price = pk.retailPrice != null ? Number(pk.retailPrice) : '';
          return `${pk.label || ''}@${pk.unitCount || 1}@${price}${pk.isDefault ? '*' : ''}`;
        })
        .join(';');

      // Use index access to avoid every-field type assertion noise
      const pp = p as Record<string, unknown> & ProductRowLite;
      return {
        id: p.id,
        upc: p.upc || '',
        additional_upcs: alts.join('|'),
        sku: pp.sku || '',
        item_code: pp.itemCode || '',
        name: p.name,
        brand: p.brand || '',
        size: pp.size || '',
        size_unit: pp.sizeUnit || '',
        description: pp.description || '',
        image_url: p.imageUrl || '',

        department_id: pp.departmentId ?? '',
        department_name: (pp.department as { name?: string } | null)?.name || '',
        vendor_id: pp.vendorId ?? '',
        vendor_name: (pp.vendor as { name?: string } | null)?.name || '',
        product_group: (pp.productGroup as { name?: string } | null)?.name || '',
        tax_class: pp.taxClass || '',

        unit_pack: pp.unitPack != null ? pp.unitPack : '',
        packs_per_case: pp.packInCase != null ? pp.packInCase : '',
        pack_options: packOptions,

        default_cost_price:
          pp.defaultCostPrice != null ? Number(pp.defaultCostPrice as unknown as number) : '',
        default_retail_price:
          pp.defaultRetailPrice != null ? Number(pp.defaultRetailPrice as unknown as number) : '',
        default_case_price:
          pp.defaultCasePrice != null ? Number(pp.defaultCasePrice as unknown as number) : '',

        store_cost_price:
          sp?.costPrice != null ? Number(sp.costPrice) : '',
        store_retail_price:
          sp?.retailPrice != null ? Number(sp.retailPrice) : '',

        deposit_per_unit:
          pp.depositPerUnit != null ? Number(pp.depositPerUnit as unknown as number) : '',
        case_deposit:
          pp.caseDeposit != null ? Number(pp.caseDeposit as unknown as number) : '',

        ebt_eligible: pp.ebtEligible ? 'true' : 'false',
        age_required: pp.ageRequired ?? '',
        taxable: pp.taxable ? 'true' : 'false',
        discount_eligible: pp.discountEligible ? 'true' : 'false',

        quantity_on_hand:
          sp?.quantityOnHand != null ? Number(sp.quantityOnHand) : '',
        reorder_point: pp.reorderPoint ?? '',
        reorder_qty: pp.reorderQty ?? '',
        track_inventory: pp.trackInventory ? 'true' : 'false',

        hide_from_ecom: pp.hideFromEcom ? 'true' : 'false',
        ecom_description: pp.ecomDescription || '',

        active: pp.active ? 'true' : 'false',
        created_at: pp.createdAt
          ? new Date(pp.createdAt as Date).toISOString()
          : '',
        updated_at: pp.updatedAt
          ? new Date(pp.updatedAt as Date).toISOString()
          : '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows, {
      header: rows[0]
        ? Object.keys(rows[0])
        : [
            'id',
            'upc',
            'additional_upcs',
            'sku',
            'item_code',
            'name',
            'brand',
            'size',
            'size_unit',
            'description',
            'image_url',
            'department_id',
            'department_name',
            'vendor_id',
            'vendor_name',
            'product_group',
            'tax_class',
            'unit_pack',
            'packs_per_case',
            'pack_options',
            'default_cost_price',
            'default_retail_price',
            'default_case_price',
            'store_cost_price',
            'store_retail_price',
            'deposit_per_unit',
            'case_deposit',
            'ebt_eligible',
            'age_required',
            'taxable',
            'discount_eligible',
            'quantity_on_hand',
            'reorder_point',
            'reorder_qty',
            'track_inventory',
            'hide_from_ecom',
            'ecom_description',
            'active',
            'created_at',
            'updated_at',
          ],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'csv' });

    const storeSlug = store?.name
      ? store.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 30)
      : 'all-stores';
    const date = new Date().toISOString().slice(0, 10);
    const filename = `products-${storeSlug}-${date}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('X-Row-Count', String(rows.length));
    res.send(buffer);
  } catch (err) {
    console.error('[exportMasterProducts] failed:', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const searchMasterProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const rawQuery = ((req.query.q as string) || '').trim() || '';
    const storeId = (req.query.storeId as string | null) || null;
    const { skip, take, page, limit } = paginationParams(req.query as Record<string, unknown>);

    if (!rawQuery) {
      res.status(400).json({ success: false, error: 'Search query (q) is required' });
      return;
    }

    const digitsOnlyQuery = rawQuery.replace(/[\s\-\.]/g, '').replace(/\D/g, '');
    const isUpcLike   = digitsOnlyQuery.length >= 6 && digitsOnlyQuery.length <= 14;
    // Short codes (1-5 digits) — store-assigned product identifiers like
    // `299`. Treated as exact-match on `upc`, NOT contains-match — typing
    // `299` should never surface a product whose UPC is `1299` or `2993...`.
    const isShortCode = digitsOnlyQuery.length >= 1 && digitsOnlyQuery.length < 6;

    const storeProductsInclude = storeId
      ? {
          where: { storeId, active: true },
          select: { quantityOnHand: true, retailPrice: true, inStock: true },
          take: 1,
        }
      : false;

    if (isUpcLike) {
      const variants = upcVariants(digitsOnlyQuery);

      const upcRow = await prisma.productUpc.findFirst({
        where: { orgId, upc: { in: variants } },
        select: { masterProductId: true },
      });

      const exactWhere = upcRow
        ? { id: upcRow.masterProductId, orgId, deleted: false }
        : { orgId, deleted: false, upc: { in: variants } };

      const exact = (await prisma.masterProduct.findFirst({
        where: exactWhere,
        include: {
          department: {
            select: { id: true, name: true, code: true, taxClass: true, ageRequired: true },
          },
          vendor: { select: { id: true, name: true } },
          depositRule: { select: { id: true, depositAmount: true } },
          upcs: { select: { id: true, upc: true, label: true, isDefault: true } },
          packSizes: { orderBy: { sortOrder: 'asc' } },
          ...(storeProductsInclude ? { storeProducts: storeProductsInclude } : {}),
        },
      })) as ProductRowLite | null;
      if (exact) {
        if (storeId && exact.storeProducts?.[0]?.quantityOnHand != null) {
          (exact as Record<string, unknown>).quantityOnHand = Number(
            exact.storeProducts[0].quantityOnHand,
          );
        }
        if (!exact.imageUrl && exact.upc) {
          const imgMap = await batchResolveProductImages([exact]);
          if (imgMap.has(exact.id)) exact.imageUrl = imgMap.get(exact.id) || null;
        }
        res.json({
          success: true,
          data: [flattenDeposit(exact)],
          pagination: { page: 1, limit: 1, total: 1, pages: 1 },
        });
        return;
      }
    }

    const query = rawQuery;
    const digitVariants = isUpcLike ? upcVariants(digitsOnlyQuery) : null;

    const where = {
      orgId,
      deleted: false,
      OR: [
        { name: { contains: query, mode: 'insensitive' as const } },
        ...(isUpcLike && digitVariants
          ? [{ upc: { in: digitVariants } }]
          : isShortCode
            ? [{ upc: digitsOnlyQuery }]
            : [{ upc: { contains: query } }]),
        { sku: { contains: query, mode: 'insensitive' as const } },
        { itemCode: { contains: query, mode: 'insensitive' as const } },
        { brand: { contains: query, mode: 'insensitive' as const } },
      ],
    };

    const [productsRaw, total] = await Promise.all([
      prisma.masterProduct.findMany({
        where,
        include: {
          department: {
            select: { id: true, name: true, code: true, taxClass: true, ageRequired: true },
          },
          vendor: { select: { id: true, name: true } },
          depositRule: { select: { id: true, depositAmount: true } },
          upcs: { select: { id: true, upc: true, label: true, isDefault: true } },
          packSizes: { orderBy: { sortOrder: 'asc' } },
        },
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      prisma.masterProduct.count({ where }),
    ]);
    const products = productsRaw as ProductRowLite[];

    const imageMap = await batchResolveProductImages(products);
    const enriched = products.map((p) =>
      flattenDeposit({
        ...p,
        imageUrl: p.imageUrl || imageMap.get(p.id) || null,
      }),
    );

    res.json({
      success: true,
      data: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const getMasterProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const product = (await prisma.masterProduct.findFirst({
      where: { id, orgId },
      include: {
        department: true,
        vendor: true,
        depositRule: true,
        taxRule: {
          select: { id: true, name: true, rate: true, active: true },
        },
        storeProducts: {
          select: {
            id: true,
            storeId: true,
            retailPrice: true,
            quantityOnHand: true,
            active: true,
          },
        },
        upcs: {
          select: { id: true, upc: true, label: true, isDefault: true },
          orderBy: { isDefault: 'desc' },
        },
        packSizes: { orderBy: { sortOrder: 'asc' } },
        vendorMappings: {
          include: { vendor: { select: { id: true, name: true, code: true } } },
          orderBy: [{ isPrimary: 'desc' }, { lastReceivedAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
    })) as ProductRowLite | null;

    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    if (!product.imageUrl && product.upc) {
      const imgMap = await batchResolveProductImages([product]);
      if (imgMap.has(product.id)) product.imageUrl = imgMap.get(product.id) || null;
    }

    res.json({ success: true, data: flattenDeposit(product) });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// Keep ProductUpc table in sync with MasterProduct.upc (the primary barcode).
async function syncPrimaryUpc(
  orgId: string,
  productId: number,
  newUpc: string | null | undefined,
): Promise<void> {
  const normalized = newUpc ? normalizeUPC(newUpc) : null;
  if (!normalized) {
    await prisma.productUpc.updateMany({
      where: { orgId, masterProductId: productId, isDefault: true },
      data: { isDefault: false },
    });
    return;
  }
  const existing = await prisma.productUpc.findUnique({
    where: { orgId_upc: { orgId, upc: normalized } },
  });
  if (existing && existing.masterProductId !== productId) {
    const err = new Error(
      `UPC ${normalized} is already used by another product (id ${existing.masterProductId})`,
    ) as CatalogStatusError;
    err.code = 'P2002';
    throw err;
  }
  await prisma.productUpc.updateMany({
    where: {
      orgId,
      masterProductId: productId,
      isDefault: true,
      NOT: { upc: normalized },
    },
    data: { isDefault: false },
  });
  await prisma.productUpc.upsert({
    where: { orgId_upc: { orgId, upc: normalized } },
    update: { masterProductId: productId, isDefault: true },
    create: {
      orgId,
      masterProductId: productId,
      upc: normalized,
      isDefault: true,
      label: 'Primary',
    },
  });
}

export const createMasterProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const {
      upc,
      plu,
      sku,
      itemCode,
      name,
      description,
      brand,
      imageUrl,
      size,
      sizeUnit,
      pack,
      casePacks,
      sellUnitSize,
      sellUnit,
      innerPack,
      unitsPerPack,
      weight,
      shipLengthIn,
      shipWidthIn,
      shipHeightIn,
      unitPack,
      packInCase,
      depositPerUnit,
      departmentId,
      vendorId,
      depositRuleId,
      containerType,
      containerVolumeOz,
      taxRuleId,
      defaultCostPrice,
      defaultRetailPrice,
      defaultCasePrice,
      lockManualCaseCost,
      byWeight,
      byUnit,
      ebtEligible,
      ageRequired,
      taxable,
      discountEligible,
      foodstamp,
      trackInventory,
      reorderPoint,
      reorderQty,
      hideFromEcom,
      ecomDescription,
      ecomTags,
      ecomExternalId,
      ecomPackWeight,
      ecomPrice,
      ecomSalePrice,
      ecomOnSale,
      ecomSummary,
      attributes,
      active,
    } = req.body;
    let { taxClass } = req.body;

    if (!name) {
      res.status(400).json({ success: false, error: 'name is required' });
      return;
    }

    const normalizedUpcForCheck = normalizeUPC(upc);
    if (normalizedUpcForCheck) {
      try {
        await assertUpcUnique(prisma, orgId, normalizedUpcForCheck);
      } catch (err) {
        if (errStatus(err) === 409) {
          const conflict = (err as CatalogStatusError).conflict;
          res.status(409).json({ success: false, error: errMsg(err), conflict });
          return;
        }
        throw err;
      }
    }

    let resolvedTaxRuleId: number | null = null;
    if (taxRuleId != null && taxRuleId !== '') {
      const rule = await prisma.taxRule.findFirst({
        where: { id: parseInt(taxRuleId), orgId },
        select: { id: true },
      });
      if (!rule) {
        res
          .status(400)
          .json({ success: false, error: `taxRuleId ${taxRuleId} not found for this org` });
        return;
      }
      resolvedTaxRuleId = rule.id;
      // Session 56b — no longer mirroring `rule.appliesTo` into `product.taxClass`
      // because rules don't have appliesTo anymore. taxClass on products is now
      // an age-policy hint only (tobacco/alcohol). It comes from either user
      // input OR the department's taxClass (handled below).
    }

    let deptDefaults: {
      taxClass?: string | null;
      ageRequired?: number | null;
      ebtEligible?: boolean | null;
    } = {};
    if (departmentId) {
      const dept = await prisma.department.findFirst({
        where: { id: parseInt(departmentId), orgId },
        select: {
          taxClass: true,
          ageRequired: true,
          ebtEligible: true,
          bottleDeposit: true,
        },
      });
      if (dept) {
        deptDefaults = {
          taxClass: taxClass == null ? dept.taxClass : taxClass,
          ageRequired: ageRequired == null ? dept.ageRequired : ageRequired,
          ebtEligible: ebtEligible == null ? dept.ebtEligible : ebtEligible,
        };
      }
    }

    const product = await prisma.masterProduct.create({
      data: {
        orgId,
        upc: normalizeUPC(upc) || null,
        plu: plu || null,
        sku: sku || null,
        itemCode: itemCode || null,
        name,
        description: description || null,
        brand: brand || null,
        imageUrl: imageUrl || null,
        size: size || null,
        sizeUnit: sizeUnit || null,
        pack: pack ? parseInt(pack) : null,
        casePacks: casePacks != null ? parseInt(casePacks) : null,
        sellUnitSize: sellUnitSize != null ? parseInt(sellUnitSize) : null,
        sellUnit: sellUnit || null,
        innerPack: innerPack ? parseInt(innerPack) : null,
        unitsPerPack: unitsPerPack ? parseInt(unitsPerPack) : null,
        unitPack: unitPack ? parseInt(unitPack) : null,
        packInCase: packInCase ? parseInt(packInCase) : null,
        depositPerUnit: toPrice(depositPerUnit, 'depositPerUnit'),
        caseDeposit: toPrice(req.body.caseDeposit, 'caseDeposit'),
        weight: weight ? parseFloat(weight) : null,
        departmentId: departmentId ? parseInt(departmentId) : null,
        vendorId: vendorId ? parseInt(vendorId) : null,
        depositRuleId: depositRuleId ? parseInt(depositRuleId) : null,
        containerType: containerType || null,
        containerVolumeOz: containerVolumeOz ? parseFloat(containerVolumeOz) : null,
        taxRuleId: resolvedTaxRuleId,
        taxClass: (taxClass ?? deptDefaults.taxClass) || null,
        defaultCostPrice: toPrice(defaultCostPrice, 'defaultCostPrice'),
        defaultRetailPrice: toPrice(defaultRetailPrice, 'defaultRetailPrice'),
        defaultCasePrice: toPrice(defaultCasePrice, 'defaultCasePrice'),
        byWeight: Boolean(byWeight),
        byUnit: byUnit !== false,
        ebtEligible:
          ebtEligible != null ? Boolean(ebtEligible) : Boolean(deptDefaults.ebtEligible),
        ageRequired:
          (ageRequired ?? deptDefaults.ageRequired)
            ? parseInt(String(ageRequired ?? deptDefaults.ageRequired))
            : null,
        taxable: taxable !== false,
        discountEligible: discountEligible !== false,
        foodstamp: Boolean(foodstamp),
        trackInventory: trackInventory !== false,
        lockManualCaseCost: Boolean(lockManualCaseCost),
        reorderPoint: reorderPoint ? parseInt(reorderPoint) : null,
        reorderQty: reorderQty ? parseInt(reorderQty) : null,
        hideFromEcom: Boolean(hideFromEcom),
        ecomDescription: ecomDescription || null,
        ecomTags: Array.isArray(ecomTags) ? ecomTags : [],
        ecomExternalId: ecomExternalId || null,
        ecomPackWeight: ecomPackWeight ? parseFloat(ecomPackWeight) : null,
        ecomPrice: toPrice(ecomPrice, 'ecomPrice'),
        ecomSalePrice: toPrice(ecomSalePrice, 'ecomSalePrice'),
        ecomOnSale: Boolean(ecomOnSale),
        ecomSummary: ecomSummary || null,
        shipLengthIn:
          shipLengthIn != null && shipLengthIn !== '' ? parseFloat(shipLengthIn) : null,
        shipWidthIn:
          shipWidthIn != null && shipWidthIn !== '' ? parseFloat(shipWidthIn) : null,
        shipHeightIn:
          shipHeightIn != null && shipHeightIn !== '' ? parseFloat(shipHeightIn) : null,
        attributes:
          attributes && typeof attributes === 'object' && !Array.isArray(attributes)
            ? attributes
            : {},
        active: active !== false,
      },
      include: {
        department: { select: { id: true, name: true, code: true } },
        vendor: { select: { id: true, name: true } },
      },
    });

    if (product.upc) {
      try {
        await syncPrimaryUpc(orgId, product.id, product.upc);
      } catch (e) {
        if (errCode(e) === 'P2002') {
          await prisma.masterProduct.delete({ where: { id: product.id } }).catch(() => {});
          res.status(409).json({ success: false, error: errMsg(e) });
          return;
        }
        throw e;
      }
    }

    emitProductSync(orgId, product.id, 'create', {
      name: product.name,
      description: product.description,
      brand: product.brand,
      imageUrl: product.imageUrl,
      defaultRetailPrice: product.defaultRetailPrice,
      defaultCostPrice: product.defaultCostPrice,
      taxable: product.taxable,
      taxClass: product.taxClass,
      ebtEligible: product.ebtEligible,
      ageRequired: product.ageRequired,
      trackInventory: product.trackInventory,
      hideFromEcom: product.hideFromEcom,
      ecomDescription: product.ecomDescription,
      ecomTags: product.ecomTags,
      size: product.size,
      weight: product.weight,
      departmentName: product.department?.name,
    });

    try {
      await queueLabelForNewProduct(orgId, product.id, product.defaultRetailPrice);
    } catch {}

    logAudit(req, 'create', 'product', product.id, {
      name: product.name,
      upc: product.upc,
      retailPrice: product.defaultRetailPrice,
      departmentId: product.departmentId,
    });

    if (product.upc && product.imageUrl) {
      const { upsertGlobalImage } = await import('../../services/globalImageService.js');
      upsertGlobalImage({
        upc: product.upc,
        imageUrl: product.imageUrl,
        source: 'manual',
        productName: product.name,
        brand: product.brand,
      }).catch(() => {});
    }

    res.status(201).json({ success: true, data: product });
  } catch (err) {
    if (errStatus(err) === 400) {
      res.status(400).json({ success: false, error: errMsg(err) });
      return;
    }
    if (errCode(err) === 'P2002') {
      res
        .status(409)
        .json({ success: false, error: 'A product with this UPC already exists' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const duplicateMasterProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const source = await prisma.masterProduct.findFirst({
      where: { id, orgId },
      include: {
        department: { select: { id: true, name: true, code: true } },
        vendor: { select: { id: true, name: true } },
        depositRule: { select: { id: true, name: true } },
      },
    });

    if (!source) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    const {
      id: _id,
      createdAt: _c,
      updatedAt: _u,
      upc: _upc,
      sku: _sku,
      plu: _plu,
      deleted: _d,
      orgId: _o,
      ...templateRaw
    } = source as Record<string, unknown>;
    const template = templateRaw as Record<string, unknown>;
    void _id;
    void _c;
    void _u;
    void _upc;
    void _sku;
    void _plu;
    void _d;
    void _o;

    template.name = `${source.name} (Copy)`;

    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateMasterProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const id = parseInt(req.params.id);

    const updates: Record<string, unknown> = {};
    const body = req.body;

    if (body.upc !== undefined) {
      const normalizedUpc = normalizeUPC(body.upc);
      if (normalizedUpc) {
        try {
          await assertUpcUnique(prisma, orgId, normalizedUpc, id);
        } catch (err) {
          if (errStatus(err) === 409) {
            const conflict = (err as CatalogStatusError).conflict;
            res.status(409).json({ success: false, error: errMsg(err), conflict });
            return;
          }
          throw err;
        }
      }
    }

    if (body.name !== undefined) updates.name = body.name;
    if (body.upc !== undefined) updates.upc = normalizeUPC(body.upc) || null;
    if (body.plu !== undefined) updates.plu = body.plu || null;
    if (body.sku !== undefined) updates.sku = body.sku || null;
    if (body.itemCode !== undefined) updates.itemCode = body.itemCode || null;
    if (body.description !== undefined) updates.description = body.description || null;
    if (body.brand !== undefined) updates.brand = body.brand || null;
    if (body.size !== undefined) updates.size = body.size || null;
    if (body.sizeUnit !== undefined) updates.sizeUnit = body.sizeUnit || null;
    if (body.pack !== undefined) updates.pack = body.pack ? parseInt(body.pack) : null;
    if (body.casePacks !== undefined)
      updates.casePacks = body.casePacks ? parseInt(body.casePacks) : null;
    if (body.sellUnitSize !== undefined)
      updates.sellUnitSize = body.sellUnitSize ? parseInt(body.sellUnitSize) : null;
    if (body.sellUnit !== undefined) updates.sellUnit = body.sellUnit || null;
    if (body.innerPack !== undefined)
      updates.innerPack = body.innerPack ? parseInt(body.innerPack) : null;
    if (body.unitsPerPack !== undefined)
      updates.unitsPerPack = body.unitsPerPack ? parseInt(body.unitsPerPack) : null;
    if (body.departmentId !== undefined)
      updates.departmentId = body.departmentId ? parseInt(body.departmentId) : null;
    if (body.vendorId !== undefined)
      updates.vendorId = body.vendorId ? parseInt(body.vendorId) : null;
    if (body.depositRuleId !== undefined)
      updates.depositRuleId = body.depositRuleId ? parseInt(body.depositRuleId) : null;
    if (body.containerType !== undefined)
      updates.containerType = body.containerType || null;
    if (body.containerVolumeOz !== undefined)
      updates.containerVolumeOz = body.containerVolumeOz
        ? parseFloat(body.containerVolumeOz)
        : null;
    if (body.taxRuleId !== undefined) {
      if (body.taxRuleId === null || body.taxRuleId === '') {
        updates.taxRuleId = null;
      } else {
        const rule = await prisma.taxRule.findFirst({
          where: { id: parseInt(body.taxRuleId), orgId },
          select: { id: true },
        });
        if (!rule) {
          res.status(400).json({
            success: false,
            error: `taxRuleId ${body.taxRuleId} not found for this org`,
          });
          return;
        }
        updates.taxRuleId = rule.id;
        // Session 56b — no longer mirroring rule.appliesTo into product.taxClass
        // (rule.appliesTo is gone). taxClass is now age-policy-only and is set
        // independently via body.taxClass or department default.
      }
    }
    if (body.taxClass !== undefined) updates.taxClass = body.taxClass || null;
    if (body.defaultCostPrice !== undefined)
      updates.defaultCostPrice = toPrice(body.defaultCostPrice, 'defaultCostPrice');
    if (body.defaultRetailPrice !== undefined)
      updates.defaultRetailPrice = toPrice(body.defaultRetailPrice, 'defaultRetailPrice');
    if (body.defaultCasePrice !== undefined)
      updates.defaultCasePrice = toPrice(body.defaultCasePrice, 'defaultCasePrice');
    if (body.ebtEligible !== undefined) updates.ebtEligible = Boolean(body.ebtEligible);
    if (body.ageRequired !== undefined)
      updates.ageRequired = body.ageRequired ? parseInt(body.ageRequired) : null;
    if (body.taxable !== undefined) updates.taxable = Boolean(body.taxable);
    if (body.discountEligible !== undefined)
      updates.discountEligible = Boolean(body.discountEligible);
    if (body.byWeight !== undefined) updates.byWeight = Boolean(body.byWeight);
    if (body.byUnit !== undefined) updates.byUnit = Boolean(body.byUnit);
    if (body.trackInventory !== undefined)
      updates.trackInventory = Boolean(body.trackInventory);
    if (body.lockManualCaseCost !== undefined)
      updates.lockManualCaseCost = Boolean(body.lockManualCaseCost);
    if (body.reorderPoint !== undefined)
      updates.reorderPoint = body.reorderPoint ? parseInt(body.reorderPoint) : null;
    if (body.reorderQty !== undefined)
      updates.reorderQty = body.reorderQty ? parseInt(body.reorderQty) : null;
    if (body.active !== undefined) updates.active = Boolean(body.active);
    if (body.hideFromEcom !== undefined) updates.hideFromEcom = Boolean(body.hideFromEcom);
    if (body.ecomDescription !== undefined)
      updates.ecomDescription = body.ecomDescription || null;
    if (body.ecomTags !== undefined)
      updates.ecomTags = Array.isArray(body.ecomTags) ? body.ecomTags : [];
    if (body.ecomExternalId !== undefined)
      updates.ecomExternalId = body.ecomExternalId || null;
    if (body.ecomPackWeight !== undefined)
      updates.ecomPackWeight = body.ecomPackWeight ? parseFloat(body.ecomPackWeight) : null;
    if (body.ecomPrice !== undefined) updates.ecomPrice = toPrice(body.ecomPrice, 'ecomPrice');
    if (body.ecomSalePrice !== undefined)
      updates.ecomSalePrice = toPrice(body.ecomSalePrice, 'ecomSalePrice');
    if (body.ecomOnSale !== undefined) updates.ecomOnSale = Boolean(body.ecomOnSale);
    if (body.ecomSummary !== undefined) updates.ecomSummary = body.ecomSummary || null;
    if (body.shipLengthIn !== undefined)
      updates.shipLengthIn =
        body.shipLengthIn != null && body.shipLengthIn !== ''
          ? parseFloat(body.shipLengthIn)
          : null;
    if (body.shipWidthIn !== undefined)
      updates.shipWidthIn =
        body.shipWidthIn != null && body.shipWidthIn !== ''
          ? parseFloat(body.shipWidthIn)
          : null;
    if (body.shipHeightIn !== undefined)
      updates.shipHeightIn =
        body.shipHeightIn != null && body.shipHeightIn !== ''
          ? parseFloat(body.shipHeightIn)
          : null;
    if (body.imageUrl !== undefined) updates.imageUrl = body.imageUrl || null;
    if (body.weight !== undefined)
      updates.weight = body.weight ? parseFloat(body.weight) : null;
    if (body.attributes !== undefined)
      updates.attributes =
        body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes)
          ? body.attributes
          : {};
    if (body.unitPack !== undefined)
      updates.unitPack = body.unitPack ? parseInt(body.unitPack) : null;
    if (body.packInCase !== undefined)
      updates.packInCase = body.packInCase ? parseInt(body.packInCase) : null;
    if (body.depositPerUnit !== undefined)
      updates.depositPerUnit = toPrice(body.depositPerUnit, 'depositPerUnit');
    if (body.caseDeposit !== undefined)
      updates.caseDeposit = toPrice(body.caseDeposit, 'caseDeposit');

    const existing = await prisma.masterProduct.findUnique({
      where: { id: parseInt(String(id)) },
      select: {
        name: true,
        upc: true,
        defaultRetailPrice: true,
        defaultCostPrice: true,
        taxClass: true,
        active: true,
        departmentId: true,
        vendorId: true,
      },
    });

    const product = await prisma.masterProduct.update({
      where: { id, orgId },
      data: updates,
      include: {
        department: { select: { id: true, name: true, code: true } },
        vendor: { select: { id: true, name: true } },
      },
    });

    try {
      const diff: Record<string, { before: unknown; after: unknown }> = {};
      for (const k of Object.keys(updates)) {
        const before = (existing as Record<string, unknown> | null)?.[k];
        const after = updates[k];
        const same =
          (before == null && after == null) || String(before ?? '') === String(after ?? '');
        if (!same) diff[k] = { before, after };
      }
      if (Object.keys(diff).length > 0) {
        logAudit(req, 'update', 'product', product.id, { name: product.name, changes: diff });
      }
    } catch {}

    if (body.upc !== undefined) {
      try {
        await syncPrimaryUpc(orgId, product.id, product.upc);
      } catch (e) {
        if (errCode(e) === 'P2002') {
          res.status(409).json({ success: false, error: errMsg(e) });
          return;
        }
        throw e;
      }
    }

    try {
      if (
        body.defaultRetailPrice !== undefined &&
        existing?.defaultRetailPrice != null
      ) {
        await queueLabelForPriceChange(
          orgId,
          null,
          String(id),
          existing.defaultRetailPrice,
          body.defaultRetailPrice,
        );
      }
    } catch {}

    emitProductSync(orgId, product.id, 'update', {
      name: product.name,
      description: product.description,
      brand: product.brand,
      imageUrl: product.imageUrl,
      defaultRetailPrice: product.defaultRetailPrice,
      defaultCostPrice: product.defaultCostPrice,
      taxable: product.taxable,
      taxClass: product.taxClass,
      ebtEligible: product.ebtEligible,
      ageRequired: product.ageRequired,
      trackInventory: product.trackInventory,
      hideFromEcom: product.hideFromEcom,
      ecomDescription: product.ecomDescription,
      ecomTags: product.ecomTags,
      size: product.size,
      weight: product.weight,
      departmentName: product.department?.name,
    });

    if (product.upc && product.imageUrl) {
      const { upsertGlobalImage } = await import('../../services/globalImageService.js');
      upsertGlobalImage({
        upc: product.upc,
        imageUrl: product.imageUrl,
        source: 'manual',
        productName: product.name,
        brand: product.brand,
      }).catch(() => {});
    }

    res.json({ success: true, data: product });
  } catch (err) {
    if (errStatus(err) === 400) {
      res.status(400).json({ success: false, error: errMsg(err) });
      return;
    }
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }
    if (errCode(err) === 'P2002') {
      res
        .status(409)
        .json({ success: false, error: 'UPC already in use by another product' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deleteMasterProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const id = parseInt(req.params.id);

    const snapshot = await prisma.masterProduct.findUnique({
      where: { id },
      select: { name: true, upc: true, defaultRetailPrice: true },
    });

    await prisma.masterProduct.update({
      where: { id, orgId },
      data: { deleted: true, active: false },
    });

    emitProductSync(orgId, id, 'delete');
    logAudit(req, 'delete', 'product', id, snapshot || { id });
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

interface BulkUpdateInput {
  id: number | string;
  defaultRetailPrice?: number | string;
  defaultCostPrice?: number | string;
  defaultCasePrice?: number | string;
  active?: boolean;
}

/**
 * Bulk update retail prices for multiple master products.
 */
export const bulkUpdateMasterProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { updates } = req.body as { updates?: BulkUpdateInput[] };

    if (!Array.isArray(updates) || updates.length === 0) {
      res.status(400).json({ success: false, error: 'updates array is required' });
      return;
    }

    const oldProductsRaw = await prisma.masterProduct.findMany({
      where: { id: { in: updates.map((u) => parseInt(String(u.id))) }, orgId },
      select: { id: true, defaultRetailPrice: true },
    });
    type OldProductRow = { id: number; defaultRetailPrice: number | string | null };
    const oldProducts = oldProductsRaw as OldProductRow[];
    const oldPriceMap: Record<number, number | string | null> = {};
    for (const p of oldProducts) oldPriceMap[p.id] = p.defaultRetailPrice;

    const results = await prisma.$transaction(
      updates.map(({ id, ...data }) =>
        prisma.masterProduct.update({
          where: { id: parseInt(String(id)), orgId },
          data: {
            ...(data.defaultRetailPrice != null && {
              defaultRetailPrice: parseFloat(String(data.defaultRetailPrice)),
            }),
            ...(data.defaultCostPrice != null && {
              defaultCostPrice: parseFloat(String(data.defaultCostPrice)),
            }),
            ...(data.defaultCasePrice != null && {
              defaultCasePrice: parseFloat(String(data.defaultCasePrice)),
            }),
            ...(data.active != null && { active: Boolean(data.active) }),
          },
        }),
      ),
    );

    try {
      for (const u of updates) {
        if (u.defaultRetailPrice !== undefined && oldPriceMap[Number(u.id)] != null) {
          await queueLabelForPriceChange(
            orgId as string,
            null,
            String(u.id),
            oldPriceMap[Number(u.id)],
            u.defaultRetailPrice,
          );
        }
      }
    } catch {}

    res.json({ success: true, updated: results.length });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ── Bulk delete (soft — sets active=false and deleted=true) ───────────────────
export const bulkDeleteMasterProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, permanent = false } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ success: false, error: 'ids array is required' });
      return;
    }

    const intIds = ids.map((id: string | number) => parseInt(String(id)));

    if (permanent) {
      await prisma.storeProduct.deleteMany({ where: { masterProductId: { in: intIds } } });
      await prisma.productUpc.deleteMany({ where: { masterProductId: { in: intIds } } });
      await prisma.productPackSize.deleteMany({
        where: { masterProductId: { in: intIds } },
      });
      const result = await prisma.masterProduct.deleteMany({
        where: { id: { in: intIds }, orgId },
      });
      res.json({ success: true, deleted: result.count, type: 'permanent' });
    } else {
      const result = await prisma.masterProduct.updateMany({
        where: { id: { in: intIds }, orgId },
        data: { deleted: true, active: false },
      });
      res.json({ success: true, deleted: result.count, type: 'soft' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ── Delete ALL products in org (nuke option) ──────────────────────────────────
export const deleteAllProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { confirmation, permanent = false } = req.body;

    if (confirmation !== 'DELETE ALL') {
      res.status(400).json({
        success: false,
        error: 'Confirmation required — send { confirmation: "DELETE ALL" }',
      });
      return;
    }

    const beforeCount = await prisma.masterProduct.count({
      where: { orgId, ...(permanent ? {} : { deleted: false }) },
    });

    if (beforeCount === 0) {
      res.json({
        success: true,
        deleted: 0,
        type: permanent ? 'permanent' : 'soft',
        message: 'No products to delete',
      });
      return;
    }

    if (permanent) {
      type IdRow = { id: number };
      const idsRaw = (await prisma.masterProduct.findMany({
        where: { orgId },
        select: { id: true },
      })) as IdRow[];
      const idList = idsRaw.map((p) => p.id);

      await prisma.storeProduct.deleteMany({ where: { masterProductId: { in: idList } } });
      await prisma.productUpc.deleteMany({ where: { masterProductId: { in: idList } } });
      await prisma.productPackSize
        .deleteMany({ where: { masterProductId: { in: idList } } })
        .catch(() => {});
      await prisma.inventoryAdjustment
        .deleteMany({ where: { masterProductId: { in: idList } } })
        .catch(() => {});
      await prisma.labelQueue
        .deleteMany({ where: { masterProductId: { in: idList } } })
        .catch(() => {});

      await prisma.purchaseOrderItem
        .deleteMany({ where: { masterProductId: { in: idList } } })
        .catch(() => {});
      type EmptyPORow = { id: number };
      const emptyPOs = (await prisma.purchaseOrder
        .findMany({
          where: { orgId, items: { none: {} } },
          select: { id: true },
        })
        .catch(() => [])) as EmptyPORow[];
      if (emptyPOs.length > 0) {
        await prisma.purchaseOrder
          .deleteMany({
            where: { id: { in: emptyPOs.map((p) => p.id) } },
          })
          .catch(() => {});
      }

      await prisma.vendorProductMap.deleteMany({ where: { orgId } }).catch(() => {});

      const result = await prisma.masterProduct.deleteMany({ where: { orgId } });
      res.json({ success: true, deleted: result.count, type: 'permanent' });
    } else {
      const result = await prisma.masterProduct.updateMany({
        where: { orgId, deleted: false },
        data: { deleted: true, active: false },
      });
      res.json({ success: true, deleted: result.count, type: 'soft' });
    }
  } catch (err) {
    console.error('[deleteAllProducts]', err);
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ── Bulk set department ───────────────────────────────────────────────────────
export const bulkSetDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, departmentId } = req.body;
    if (!Array.isArray(ids) || !departmentId) {
      res.status(400).json({ success: false, error: 'ids and departmentId required' });
      return;
    }
    const result = await prisma.masterProduct.updateMany({
      where: { id: { in: ids.map((id: string | number) => parseInt(String(id))) }, orgId },
      data: { departmentId: parseInt(departmentId) },
    });
    res.json({ success: true, updated: result.count });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ── Bulk toggle active ───────────────────────────────────────────────────────
export const bulkToggleActive = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, active } = req.body;
    if (!Array.isArray(ids) || active == null) {
      res.status(400).json({ success: false, error: 'ids and active required' });
      return;
    }
    const result = await prisma.masterProduct.updateMany({
      where: { id: { in: ids.map((id: string | number) => parseInt(String(id))) }, orgId },
      data: { active: Boolean(active) },
    });
    res.json({ success: true, updated: result.count });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

