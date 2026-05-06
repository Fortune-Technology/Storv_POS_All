/**
 * Catalog — Vendors + Product-Vendor mappings + Vendor Payouts/Stats + Rebates.
 * Split from `catalogController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers + helpers grouped by sub-domain:
 *
 * Vendors (5):
 *   - getVendors      GET    /catalog/vendors
 *   - getVendor       GET    /catalog/vendors/:id        (incl. balance + last payout)
 *   - createVendor    POST   /catalog/vendors
 *   - updateVendor    PUT    /catalog/vendors/:id
 *   - deleteVendor    DELETE /catalog/vendors/:id
 *
 * Per-vendor analytics (3):
 *   - getVendorProducts GET /catalog/vendors/:id/products
 *   - getVendorPayouts  GET /catalog/vendors/:id/payouts (CashPayout + VendorPayment)
 *   - getVendorStats    GET /catalog/vendors/:id/stats   (last 30/90/YTD)
 *
 * Product-Vendor mappings (5 + 1 helper):
 *   - upsertProductVendor       (helper, also called by invoiceController)
 *   - listProductVendors        GET    /products/:id/vendors
 *   - createProductVendor       POST   /products/:id/vendors
 *   - updateProductVendor       PUT    /products/:id/vendors/:mappingId
 *   - deleteProductVendor       DELETE /products/:id/vendors/:mappingId
 *   - makeProductVendorPrimary  POST   /products/:id/vendors/:mappingId/make-primary
 *
 * Rebate Programs (3):
 *   - getRebatePrograms    GET  /catalog/rebates
 *   - createRebateProgram  POST /catalog/rebates
 *   - updateRebateProgram  PUT  /catalog/rebates/:id
 *
 * Internal: `_reconcilePrimary` ensures exactly one ProductVendor row per
 * product carries `isPrimary=true`, and writes that vendor's `vendorItemCode`
 * onto the parent MasterProduct so legacy `Product.itemCode` consumers
 * continue to read the primary vendor's code.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { errMsg, errCode, errStatus } from '../../utils/typeHelpers.js';
import { logAudit } from '../../services/auditService.js';
import { tryParseDate } from '../../utils/safeDate.js';
import {
  getOrgId,
  paginationParams,
  type CatalogStatusError,
  type ProductMappingRow,
  type CashPayoutRow,
} from './helpers.js';

// ═══════════════════════════════════════════════════════
// VENDORS
// ═══════════════════════════════════════════════════════

export const getVendors = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const showInactive = req.query.includeInactive === 'true';

    const vendors = await prisma.vendor.findMany({
      where: { orgId, ...(showInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: vendors });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const createVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const {
      name,
      code,
      contactName,
      email,
      phone,
      address,
      website,
      terms,
      accountNo,
      aliases,
      autoSyncCostFromInvoice,
      targetCoverageDays,
    } = req.body;

    if (!name) {
      res.status(400).json({ success: false, error: 'name is required' });
      return;
    }

    // Sanity-bound the coverage window: 1-180 days. The orderEngine multiplies
    // this by avg daily demand to size the order — outside that range users
    // are almost certainly typing wrong (zero or year-plus stockpile).
    let cov: number | null = null;
    if (targetCoverageDays != null && targetCoverageDays !== '') {
      const n = parseInt(String(targetCoverageDays), 10);
      if (!Number.isFinite(n) || n < 1 || n > 180) {
        res.status(400).json({ success: false, error: 'targetCoverageDays must be 1-180' });
        return;
      }
      cov = n;
    }

    const vendor = await prisma.vendor.create({
      data: {
        orgId,
        name,
        code: code || null,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
        address: address || null,
        website: website || null,
        terms: terms || null,
        accountNo: accountNo || null,
        aliases: Array.isArray(aliases) ? aliases : [],
        autoSyncCostFromInvoice: autoSyncCostFromInvoice === false ? false : true,
        targetCoverageDays: cov,
      },
    });

    res.status(201).json({ success: true, data: vendor });
  } catch (err) {
    if (errCode(err) === 'P2002') {
      res.status(409).json({ success: false, error: 'Vendor with this name already exists' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const body = req.body || {};
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.code !== undefined) updates.code = body.code || null;
    if (body.contactName !== undefined) updates.contactName = body.contactName || null;
    if (body.email !== undefined) updates.email = body.email || null;
    if (body.phone !== undefined) updates.phone = body.phone || null;
    if (body.address !== undefined) updates.address = body.address || null;
    if (body.website !== undefined) updates.website = body.website || null;
    if (body.terms !== undefined) updates.terms = body.terms || null;
    if (body.accountNo !== undefined) updates.accountNo = body.accountNo || null;
    if (body.aliases !== undefined)
      updates.aliases = Array.isArray(body.aliases) ? body.aliases : [];
    if (body.active !== undefined) updates.active = Boolean(body.active);
    if (body.autoSyncCostFromInvoice !== undefined)
      updates.autoSyncCostFromInvoice = Boolean(body.autoSyncCostFromInvoice);
    if (body.targetCoverageDays !== undefined) {
      // null / '' / 0 → clear back to "use review-period default". 1-180 → set.
      // Anything else is a typo and gets bounced.
      const raw = body.targetCoverageDays;
      if (raw == null || raw === '') {
        updates.targetCoverageDays = null;
      } else {
        const n = parseInt(String(raw), 10);
        if (!Number.isFinite(n) || n < 1 || n > 180) {
          res.status(400).json({ success: false, error: 'targetCoverageDays must be 1-180' });
          return;
        }
        updates.targetCoverageDays = n;
      }
    }

    const vendor = await prisma.vendor.update({
      where: { id, orgId },
      data: updates,
    });

    res.json({ success: true, data: vendor });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Vendor not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deleteVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const force = req.query.force === 'true';

    const usageCount = await prisma.masterProduct.count({
      where: { orgId, vendorId: id, deleted: false },
    });
    if (usageCount > 0 && !force) {
      res.status(409).json({
        success: false,
        code: 'IN_USE',
        error:
          `Cannot delete: ${usageCount} product(s) are assigned to this vendor. ` +
          `Reassign them first, or retry with ?force=true to detach them.`,
        usageCount,
      });
      return;
    }
    if (force && usageCount > 0) {
      await prisma.masterProduct.updateMany({
        where: { orgId, vendorId: id },
        data: { vendorId: null },
      });
    }

    await prisma.vendor.update({ where: { id, orgId }, data: { active: false } });
    res.json({
      success: true,
      message:
        force && usageCount > 0
          ? `Vendor deactivated; ${usageCount} product(s) detached`
          : 'Vendor deactivated',
      detachedCount: force ? usageCount : 0,
    });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Vendor not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ─── Vendor Detail Endpoints ─────────────────────────────────────────────────

export const getVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const vendor = await prisma.vendor.findFirst({
      where: { id, orgId },
      include: {
        products: {
          select: {
            id: true,
            name: true,
            sku: true,
            upc: true,
            defaultRetailPrice: true,
            active: true,
            departmentId: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!vendor) {
      res.status(404).json({ success: false, error: 'Vendor not found' });
      return;
    }
    res.json({ success: true, data: vendor });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCT-VENDOR MAPPINGS
// ═══════════════════════════════════════════════════════════════════════════

// Use a permissive transaction client type; Prisma's `$transaction` callback
// param is `Prisma.TransactionClient` but the JS-typed prisma default makes
// that opaque, so we allow `any` via this loose interface.
type TxClient = typeof prisma;

async function _reconcilePrimary(
  tx: TxClient,
  orgId: string,
  masterProductId: number,
): Promise<void> {
  const mappings = (await tx.productVendor.findMany({
    where: { orgId, masterProductId },
    orderBy: [{ isPrimary: 'desc' }, { lastReceivedAt: 'desc' }, { createdAt: 'desc' }],
  })) as ProductMappingRow[];
  if (mappings.length === 0) {
    await tx.masterProduct
      .update({
        where: { id: masterProductId, orgId },
        data: { itemCode: null },
      })
      .catch(() => {});
    return;
  }
  const primaries = mappings.filter((m) => m.isPrimary);
  let primary: ProductMappingRow;
  if (primaries.length === 1) {
    primary = primaries[0];
  } else if (primaries.length === 0) {
    primary = mappings[0];
    await tx.productVendor.update({
      where: { id: primary.id },
      data: { isPrimary: true },
    });
  } else {
    primary = primaries[0];
    await tx.productVendor.updateMany({
      where: { orgId, masterProductId, isPrimary: true, NOT: { id: primary.id } },
      data: { isPrimary: false },
    });
  }
  await tx.masterProduct
    .update({
      where: { id: masterProductId, orgId },
      data: { itemCode: primary.vendorItemCode || null },
    })
    .catch(() => {});
}

interface ProductVendorUpsertData {
  vendorItemCode?: string | null;
  description?: string | null;
  priceCost?: number | string | null;
  caseCost?: number | string | null;
  packInCase?: number | string | null;
  lastReceivedAt?: Date | string | null;
}

export async function upsertProductVendor(
  orgId: string,
  masterProductId: number,
  vendorId: number,
  data: ProductVendorUpsertData = {},
  opts: { tx?: TxClient } = {},
): Promise<unknown> {
  const db = opts.tx || prisma;
  const { vendorItemCode, description, priceCost, caseCost, packInCase, lastReceivedAt } = data;

  const existing = await db.productVendor.findUnique({
    where: { orgId_masterProductId_vendorId: { orgId, masterProductId, vendorId } },
  });

  let shouldBecomePrimary = false;
  if (!existing) {
    const anyMapping = await db.productVendor.findFirst({
      where: { orgId, masterProductId },
      select: { id: true },
    });
    if (!anyMapping) shouldBecomePrimary = true;
  }

  const upsertData: Record<string, unknown> = {
    ...(vendorItemCode !== undefined && { vendorItemCode: vendorItemCode || null }),
    ...(description !== undefined && { description: description || null }),
    ...(priceCost !== undefined && {
      priceCost: priceCost != null && priceCost !== '' ? parseFloat(String(priceCost)) : null,
    }),
    ...(caseCost !== undefined && {
      caseCost: caseCost != null && caseCost !== '' ? parseFloat(String(caseCost)) : null,
    }),
    ...(packInCase !== undefined && {
      packInCase: packInCase != null && packInCase !== '' ? parseInt(String(packInCase)) : null,
    }),
    ...(lastReceivedAt !== undefined && {
      lastReceivedAt: lastReceivedAt ? new Date(lastReceivedAt) : null,
    }),
  };

  const row = await db.productVendor.upsert({
    where: { orgId_masterProductId_vendorId: { orgId, masterProductId, vendorId } },
    create: {
      orgId,
      masterProductId,
      vendorId,
      ...upsertData,
      isPrimary: shouldBecomePrimary,
    },
    update: upsertData,
  });

  if (shouldBecomePrimary && row.vendorItemCode) {
    await db.masterProduct
      .update({
        where: { id: masterProductId, orgId },
        data: { itemCode: row.vendorItemCode },
      })
      .catch(() => {});
  }

  return row;
}

/** GET /api/catalog/products/:id/vendor-mappings */
export const listProductVendors = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const mappings = await prisma.productVendor.findMany({
      where: { orgId, masterProductId },
      include: { vendor: { select: { id: true, name: true, code: true } } },
      orderBy: [{ isPrimary: 'desc' }, { lastReceivedAt: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ success: true, data: mappings });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/** POST /api/catalog/products/:id/vendor-mappings */
export const createProductVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const masterProductId = parseInt(req.params.id);
    const {
      vendorId,
      vendorItemCode,
      description,
      priceCost,
      caseCost,
      packInCase,
      notes,
      isPrimary,
    } = req.body;

    if (!vendorId) {
      res.status(400).json({ success: false, error: 'vendorId is required' });
      return;
    }

    const product = await prisma.masterProduct.findFirst({
      where: { id: masterProductId, orgId },
      select: { id: true },
    });
    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    const vendor = await prisma.vendor.findFirst({
      where: { id: parseInt(vendorId), orgId },
      select: { id: true },
    });
    if (!vendor) {
      res.status(404).json({ success: false, error: 'Vendor not found' });
      return;
    }

    const row = await prisma.$transaction(async (tx: TxClient) => {
      const anyExisting = await tx.productVendor.findFirst({
        where: { orgId, masterProductId },
        select: { id: true },
      });

      const created = await tx.productVendor.create({
        data: {
          orgId,
          masterProductId,
          vendorId: parseInt(vendorId),
          vendorItemCode: vendorItemCode || null,
          description: description || null,
          priceCost:
            priceCost != null && priceCost !== '' ? parseFloat(String(priceCost)) : null,
          caseCost: caseCost != null && caseCost !== '' ? parseFloat(String(caseCost)) : null,
          packInCase:
            packInCase != null && packInCase !== '' ? parseInt(String(packInCase)) : null,
          notes: notes || null,
          isPrimary: anyExisting ? Boolean(isPrimary) : true,
        },
        include: { vendor: { select: { id: true, name: true, code: true } } },
      });

      await _reconcilePrimary(tx, orgId, masterProductId);
      return created;
    });

    res.status(201).json({ success: true, data: row });
  } catch (err) {
    if (errCode(err) === 'P2002') {
      res
        .status(409)
        .json({ success: false, error: 'This vendor already has a mapping for this product' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/** PUT /api/catalog/products/:id/vendor-mappings/:mappingId */
export const updateProductVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const masterProductId = parseInt(req.params.id);
    const mappingId = parseInt(req.params.mappingId);
    const body = req.body || {};

    const updates: Record<string, unknown> = {};
    if (body.vendorItemCode !== undefined) updates.vendorItemCode = body.vendorItemCode || null;
    if (body.description !== undefined) updates.description = body.description || null;
    if (body.priceCost !== undefined)
      updates.priceCost =
        body.priceCost != null && body.priceCost !== '' ? parseFloat(body.priceCost) : null;
    if (body.caseCost !== undefined)
      updates.caseCost =
        body.caseCost != null && body.caseCost !== '' ? parseFloat(body.caseCost) : null;
    if (body.packInCase !== undefined)
      updates.packInCase =
        body.packInCase != null && body.packInCase !== '' ? parseInt(body.packInCase) : null;
    if (body.notes !== undefined) updates.notes = body.notes || null;

    const row = await prisma.$transaction(async (tx: TxClient) => {
      const found = await tx.productVendor.findFirst({
        where: { id: mappingId, orgId, masterProductId },
        select: { id: true, isPrimary: true },
      });
      if (!found) {
        const e = new Error('Mapping not found') as CatalogStatusError;
        e.status = 404;
        throw e;
      }

      const updated = await tx.productVendor.update({
        where: { id: mappingId },
        data: updates,
        include: { vendor: { select: { id: true, name: true, code: true } } },
      });

      if (found.isPrimary && updates.vendorItemCode !== undefined) {
        await tx.masterProduct.update({
          where: { id: masterProductId, orgId },
          data: { itemCode: updated.vendorItemCode || null },
        });
      }

      return updated;
    });

    res.json({ success: true, data: row });
  } catch (err) {
    if (errStatus(err) === 404) {
      res.status(404).json({ success: false, error: errMsg(err) });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/** DELETE /api/catalog/products/:id/vendor-mappings/:mappingId */
export const deleteProductVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const masterProductId = parseInt(req.params.id);
    const mappingId = parseInt(req.params.mappingId);

    await prisma.$transaction(async (tx: TxClient) => {
      const found = await tx.productVendor.findFirst({
        where: { id: mappingId, orgId, masterProductId },
        select: { id: true },
      });
      if (!found) {
        const e = new Error('Mapping not found') as CatalogStatusError;
        e.status = 404;
        throw e;
      }

      await tx.productVendor.delete({ where: { id: mappingId } });
      await _reconcilePrimary(tx, orgId, masterProductId);
    });

    res.json({ success: true });
  } catch (err) {
    if (errStatus(err) === 404) {
      res.status(404).json({ success: false, error: errMsg(err) });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

/** POST /api/catalog/products/:id/vendor-mappings/:mappingId/make-primary */
export const makeProductVendorPrimary = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const masterProductId = parseInt(req.params.id);
    const mappingId = parseInt(req.params.mappingId);

    const row = await prisma.$transaction(async (tx: TxClient) => {
      const target = await tx.productVendor.findFirst({
        where: { id: mappingId, orgId, masterProductId },
        select: { id: true },
      });
      if (!target) {
        const e = new Error('Mapping not found') as CatalogStatusError;
        e.status = 404;
        throw e;
      }

      await tx.productVendor.updateMany({
        where: { orgId, masterProductId, NOT: { id: mappingId } },
        data: { isPrimary: false },
      });
      await tx.productVendor.update({
        where: { id: mappingId },
        data: { isPrimary: true },
      });
      await _reconcilePrimary(tx, orgId, masterProductId);
      return tx.productVendor.findUnique({
        where: { id: mappingId },
        include: { vendor: { select: { id: true, name: true, code: true } } },
      });
    });

    res.json({ success: true, data: row });
  } catch (err) {
    if (errStatus(err) === 404) {
      res.status(404).json({ success: false, error: errMsg(err) });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const getVendorProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const { skip, take } = paginationParams(req.query as Record<string, unknown>);
    const [products, total] = await Promise.all([
      prisma.masterProduct.findMany({
        where: { orgId, vendorId: id },
        orderBy: { name: 'asc' },
        skip,
        take,
        include: { department: { select: { name: true, color: true } } },
      }),
      prisma.masterProduct.count({ where: { orgId, vendorId: id } }),
    ]);
    res.json({ success: true, data: products, total });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const getVendorPayouts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const { skip, take } = paginationParams(req.query as Record<string, unknown>);
    const [payouts, total] = await Promise.all([
      prisma.cashPayout.findMany({
        where: { orgId, vendorId: id },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          shift: { select: { id: true, openedAt: true, closedAt: true, status: true } },
        },
      }),
      prisma.cashPayout.count({ where: { orgId, vendorId: id } }),
    ]);
    const agg = await prisma.cashPayout.aggregate({
      where: { orgId, vendorId: id },
      _sum: { amount: true },
      _count: { id: true },
    });
    res.json({
      success: true,
      data: payouts,
      total,
      totalPaid: agg._sum.amount ?? 0,
      payoutCount: agg._count.id,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const getVendorStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const [productCount, payoutAgg, recentPayoutsRaw] = await Promise.all([
      prisma.masterProduct.count({ where: { orgId, vendorId: id } }),
      prisma.cashPayout.aggregate({
        where: { orgId, vendorId: id },
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.cashPayout.findMany({
        where: { orgId, vendorId: id },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { amount: true, createdAt: true, payoutType: true },
      }),
    ]);
    const recentPayouts = recentPayoutsRaw as CashPayoutRow[];

    const monthlyMap: Record<string, number> = {};
    recentPayouts.forEach((p) => {
      const key = new Date(p.createdAt).toISOString().slice(0, 7); // YYYY-MM
      monthlyMap[key] = (monthlyMap[key] || 0) + parseFloat(String(p.amount || 0));
    });

    res.json({
      success: true,
      data: {
        productCount,
        totalPaid: parseFloat(String(payoutAgg._sum.amount ?? 0)),
        payoutCount: payoutAgg._count.id,
        monthlySpend: monthlyMap,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ═══════════════════════════════════════════════════════
// REBATE PROGRAMS
// ═══════════════════════════════════════════════════════

export const getRebatePrograms = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const programs = await prisma.rebateProgram.findMany({
      where: { orgId, active: true },
      orderBy: { manufacturer: 'asc' },
    });
    res.json({ success: true, data: programs });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const createRebateProgram = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const {
      name,
      manufacturer,
      description,
      qualifyingUpcs,
      rebateType,
      rebateAmount,
      minQtyPerMonth,
      maxQtyPerMonth,
      startDate,
      endDate,
    } = req.body;

    if (!name || !manufacturer || !rebateType || rebateAmount == null) {
      res.status(400).json({
        success: false,
        error: 'name, manufacturer, rebateType, rebateAmount are required',
      });
      return;
    }

    const sd = tryParseDate(res, startDate, 'startDate');
    if (!sd.ok) return;
    const ed = tryParseDate(res, endDate, 'endDate');
    if (!ed.ok) return;

    const program = await prisma.rebateProgram.create({
      data: {
        orgId,
        name,
        manufacturer,
        description: description || null,
        qualifyingUpcs: Array.isArray(qualifyingUpcs) ? qualifyingUpcs : [],
        rebateType,
        rebateAmount,
        minQtyPerMonth: minQtyPerMonth ? parseInt(minQtyPerMonth) : null,
        maxQtyPerMonth: maxQtyPerMonth ? parseInt(maxQtyPerMonth) : null,
        startDate: sd.value,
        endDate: ed.value,
      },
    });

    res.status(201).json({ success: true, data: program });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateRebateProgram = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const program = await prisma.rebateProgram.update({
      where: { id, orgId },
      data: req.body,
    });
    res.json({ success: true, data: program });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Rebate program not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

