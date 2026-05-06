/**
 * Tobacco product mapping — links a MasterProduct to a manufacturer feed +
 * brand family + funding type. Drives which products appear on each daily
 * submission file. Split from `scanDataController.ts` (S80).
 *
 * Permissions:
 *   scan_data.view       — list, listTobaccoProducts
 *   scan_data.configure  — upsert, bulkUpsert, delete
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { getOrgId } from './helpers.js';

// ══════════════════════════════════════════════════════════════════════════
// TOBACCO PRODUCT MAPPINGS
// ══════════════════════════════════════════════════════════════════════════

export const listProductMappings = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as { manufacturerId?: string; brandFamily?: string; search?: string };
    const { manufacturerId, brandFamily, search } = q;

    const where: Prisma.TobaccoProductMapWhereInput = { orgId: orgId ?? undefined };
    if (manufacturerId) where.manufacturerId = String(manufacturerId);
    if (brandFamily) where.brandFamily = String(brandFamily);

    const rows = await prisma.tobaccoProductMap.findMany({
      where,
      include: {
        masterProduct: {
          select: {
            id: true, name: true, brand: true, upc: true, sku: true,
            departmentId: true, defaultRetailPrice: true,
          },
        },
        manufacturer: {
          select: {
            id: true, code: true, parentMfrCode: true, name: true,
            shortName: true, brandFamilies: true,
          },
        },
      },
      orderBy: [{ brandFamily: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
    type MappingRow = (typeof rows)[number];

    let filtered: MappingRow[] = rows as MappingRow[];
    if (search) {
      const qStr = String(search).toLowerCase();
      filtered = (rows as MappingRow[]).filter((r) =>
        (r.masterProduct?.name?.toLowerCase().includes(qStr)) ||
        (r.masterProduct?.upc?.includes(qStr)) ||
        (r.masterProduct?.brand?.toLowerCase().includes(qStr)),
      );
    }

    res.json({ success: true, data: filtered });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

interface UpsertMappingBody {
  masterProductId?: number | string;
  manufacturerId?: string;
  brandFamily?: string;
  mfrProductCode?: string | null;
  fundingType?: string;
}

export const upsertProductMapping = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as UpsertMappingBody;
    const {
      masterProductId,
      manufacturerId,
      brandFamily,
      mfrProductCode,
      fundingType,
    } = body;

    if (!masterProductId || !manufacturerId || !brandFamily) {
      res.status(400).json({
        success: false,
        error: 'masterProductId, manufacturerId, and brandFamily are required',
      });
      return;
    }

    const product = await prisma.masterProduct.findFirst({
      where: { id: Number(masterProductId), orgId: orgId ?? undefined },
    });
    if (!product) { res.status(404).json({ success: false, error: 'Product not found' }); return; }

    const mfr = await prisma.tobaccoManufacturer.findUnique({
      where: { id: String(manufacturerId) },
    });
    if (!mfr) { res.status(400).json({ success: false, error: 'Unknown manufacturer feed' }); return; }

    const data = {
      orgId: orgId as string,
      masterProductId: Number(masterProductId),
      manufacturerId,
      brandFamily: String(brandFamily),
      mfrProductCode: mfrProductCode || null,
      fundingType: fundingType || 'regular',
    };

    const row = await prisma.tobaccoProductMap.upsert({
      where: { masterProductId_manufacturerId: { masterProductId: data.masterProductId, manufacturerId } },
      create: data,
      update: { brandFamily: data.brandFamily, mfrProductCode: data.mfrProductCode, fundingType: data.fundingType },
      include: { masterProduct: true, manufacturer: true },
    });

    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

interface BulkMappingEntry {
  masterProductId?: number | string;
  manufacturerId?: string;
  brandFamily?: string;
  mfrProductCode?: string | null;
  fundingType?: string;
}

interface BulkMappingResult {
  created: number;
  updated: number;
  errors: Array<{ masterProductId?: number | string; error: string }>;
}

export const bulkUpsertProductMappings = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as { mappings?: BulkMappingEntry[] };
    const { mappings } = body;
    if (!Array.isArray(mappings) || mappings.length === 0) {
      res.status(400).json({ success: false, error: 'mappings[] is required' });
      return;
    }

    const results: BulkMappingResult = { created: 0, updated: 0, errors: [] };

    for (const m of mappings) {
      try {
        const data = {
          orgId: orgId as string,
          masterProductId: Number(m.masterProductId),
          manufacturerId: String(m.manufacturerId),
          brandFamily: String(m.brandFamily),
          mfrProductCode: m.mfrProductCode || null,
          fundingType: m.fundingType || 'regular',
        };

        const existing = await prisma.tobaccoProductMap.findUnique({
          where: { masterProductId_manufacturerId: { masterProductId: data.masterProductId, manufacturerId: data.manufacturerId } },
        });

        if (existing) {
          await prisma.tobaccoProductMap.update({
            where: { id: existing.id },
            data: { brandFamily: data.brandFamily, mfrProductCode: data.mfrProductCode, fundingType: data.fundingType },
          });
          results.updated++;
        } else {
          await prisma.tobaccoProductMap.create({ data });
          results.created++;
        }
      } catch (err) {
        results.errors.push({ masterProductId: m.masterProductId, error: (err as Error).message });
      }
    }

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const deleteProductMapping = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const row = await prisma.tobaccoProductMap.findFirst({ where: { id, orgId: orgId ?? undefined } });
    if (!row) { res.status(404).json({ success: false, error: 'Mapping not found' }); return; }

    await prisma.tobaccoProductMap.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// Lists products that ARE flagged as tobacco (taxClass='tobacco' OR have a
// tobacco product mapping already) — used by the Tobacco Catalog tab to
// render the bulk-tag list.
export const listTobaccoProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as { search?: string; departmentId?: string; unmappedOnly?: string };
    const { search, departmentId, unmappedOnly } = q;

    const where: Prisma.MasterProductWhereInput = {
      orgId: orgId ?? undefined,
      deleted: false,
      OR: [
        { taxClass: 'tobacco' },
        { tobaccoProductMaps: { some: {} } },
      ],
    };
    if (departmentId) where.departmentId = Number(departmentId);
    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { upc:  { contains: String(search) } },
        { brand: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    const products = await prisma.masterProduct.findMany({
      where,
      include: {
        tobaccoProductMaps: {
          include: {
            manufacturer: {
              select: { id: true, code: true, name: true, shortName: true, parentMfrCode: true },
            },
          },
        },
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ name: 'asc' }],
      take: 500,
    });
    type ProductRow = (typeof products)[number];

    let result: ProductRow[] = products as ProductRow[];
    if (unmappedOnly === 'true') {
      result = (products as ProductRow[]).filter((p) => p.tobaccoProductMaps.length === 0);
    }

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
