/**
 * Product Group Controller
 *
 * Product Groups are templates that share classification + pricing across
 * multiple products (e.g. "750ml Red Wine", "12oz Can Beer").
 *
 * When a group has autoSync=true, changes to group fields cascade to all
 * member products. When autoSync=false, the group is a one-time template.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { queueLabelForPriceChange } from '../services/labelQueueService.js';
import { tryParseDate } from '../utils/safeDate.js';

// Fields on ProductGroup that can be cascaded to MasterProduct
const CASCADE_FIELDS = [
  'departmentId', 'vendorId', 'taxClass', 'ageRequired',
  'ebtEligible', 'discountEligible', 'taxable',
  'depositRuleId', 'containerType', 'containerVolumeOz',
  'size', 'sizeUnit', 'pack', 'casePacks', 'sellUnitSize',
  'defaultCostPrice', 'defaultRetailPrice', 'defaultCasePrice',
];

function getOrgId(req: Request): string | null | undefined {
  return req.orgId || req.user?.orgId;
}

// ── GET /api/catalog/groups ──────────────────────────────────────────────────
export const listProductGroups = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const { active, departmentId } = req.query as { active?: string; departmentId?: string };

    const where: Prisma.ProductGroupWhereInput = { orgId };
    if (active !== undefined) where.active = active === 'true';
    if (departmentId) where.departmentId = parseInt(departmentId);

    const groups = await prisma.productGroup.findMany({
      where,
      include: {
        department: { select: { id: true, name: true, code: true, color: true } },
        vendor:     { select: { id: true, name: true, code: true } },
        _count:     { select: { products: true } },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: groups });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── GET /api/catalog/groups/:id ──────────────────────────────────────────────
export const getProductGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const id = parseInt(req.params.id);

    const group = await prisma.productGroup.findFirst({
      where: { id, orgId },
      include: {
        department: true,
        vendor: true,
        depositRule: true,
        products: {
          select: {
            id: true, name: true, upc: true, defaultRetailPrice: true,
            defaultCostPrice: true, active: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!group) { res.status(404).json({ success: false, error: 'Group not found' }); return; }
    res.json({ success: true, data: group });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

interface GroupBody {
  name?: string;
  description?: string | null;
  color?: string | null;
  departmentId?: string | number | null;
  vendorId?: string | number | null;
  taxClass?: string | null;
  ageRequired?: string | number | null;
  ebtEligible?: boolean;
  discountEligible?: boolean;
  taxable?: boolean;
  depositRuleId?: string | number | null;
  containerType?: string | null;
  containerVolumeOz?: number | string | null;
  size?: string | null;
  sizeUnit?: string | null;
  pack?: number | string | null;
  casePacks?: number | string | null;
  sellUnitSize?: number | string | null;
  defaultCostPrice?: number | string | null;
  defaultRetailPrice?: number | string | null;
  defaultCasePrice?: number | string | null;
  salePrice?: number | string | null;
  saleStart?: string | Date | null;
  saleEnd?: string | Date | null;
  autoSync?: boolean;
  active?: boolean;
}

// ── POST /api/catalog/groups ─────────────────────────────────────────────────
export const createProductGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const {
      name, description, color,
      departmentId, vendorId, taxClass, ageRequired,
      ebtEligible, discountEligible, taxable,
      depositRuleId, containerType, containerVolumeOz,
      size, sizeUnit, pack, casePacks, sellUnitSize,
      defaultCostPrice, defaultRetailPrice, defaultCasePrice,
      salePrice, saleStart, saleEnd,
      autoSync = true, active = true,
    } = req.body as GroupBody;

    if (!name) { res.status(400).json({ success: false, error: 'name is required' }); return; }

    // Safe-parse dates (reject out-of-range years like 20001 with 400 instead of 500)
    const ss = tryParseDate(res, saleStart, 'saleStart'); if (!ss.ok) return;
    const se = tryParseDate(res, saleEnd,   'saleEnd');   if (!se.ok) return;

    const group = await prisma.productGroup.create({
      data: {
        orgId, name, description, color,
        departmentId: departmentId ? parseInt(String(departmentId)) : null,
        vendorId: vendorId ? parseInt(String(vendorId)) : null,
        taxClass, ageRequired: ageRequired ? parseInt(String(ageRequired)) : null,
        ebtEligible, discountEligible, taxable,
        depositRuleId: depositRuleId ? parseInt(String(depositRuleId)) : null,
        containerType,
        containerVolumeOz: containerVolumeOz != null ? parseFloat(String(containerVolumeOz)) : null,
        size, sizeUnit,
        pack: pack ? parseInt(String(pack)) : null,
        casePacks: casePacks ? parseInt(String(casePacks)) : null,
        sellUnitSize: sellUnitSize ? parseInt(String(sellUnitSize)) : null,
        defaultCostPrice: defaultCostPrice != null ? parseFloat(String(defaultCostPrice)) : null,
        defaultRetailPrice: defaultRetailPrice != null ? parseFloat(String(defaultRetailPrice)) : null,
        defaultCasePrice: defaultCasePrice != null ? parseFloat(String(defaultCasePrice)) : null,
        salePrice: salePrice != null ? parseFloat(String(salePrice)) : null,
        saleStart: ss.value,
        saleEnd:   se.value,
        autoSync, active,
      },
    });

    res.status(201).json({ success: true, data: group });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'P2002') {
      res.status(400).json({ success: false, error: 'A group with this name already exists' });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── PUT /api/catalog/groups/:id ──────────────────────────────────────────────
// Updates the group and optionally cascades changes to all members if autoSync
export const updateProductGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const id = parseInt(req.params.id);

    const existing = await prisma.productGroup.findFirst({ where: { id, orgId } });
    if (!existing) { res.status(404).json({ success: false, error: 'Group not found' }); return; }

    const {
      name, description, color,
      departmentId, vendorId, taxClass, ageRequired,
      ebtEligible, discountEligible, taxable,
      depositRuleId, containerType, containerVolumeOz,
      size, sizeUnit, pack, casePacks, sellUnitSize,
      defaultCostPrice, defaultRetailPrice, defaultCasePrice,
      salePrice, saleStart, saleEnd,
      autoSync, active,
    } = req.body as GroupBody;

    const oldRetailPrice = Number(existing.defaultRetailPrice) || null;

    const updateData: Prisma.ProductGroupUpdateInput = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (color !== undefined) updateData.color = color;
    if (departmentId !== undefined) updateData.department = departmentId
      ? { connect: { id: parseInt(String(departmentId)) } }
      : { disconnect: true };
    if (vendorId !== undefined) updateData.vendor = vendorId
      ? { connect: { id: parseInt(String(vendorId)) } }
      : { disconnect: true };
    if (taxClass !== undefined) updateData.taxClass = taxClass;
    if (ageRequired !== undefined) updateData.ageRequired = ageRequired ? parseInt(String(ageRequired)) : null;
    if (ebtEligible !== undefined) updateData.ebtEligible = ebtEligible;
    if (discountEligible !== undefined) updateData.discountEligible = discountEligible;
    if (taxable !== undefined) updateData.taxable = taxable;
    if (depositRuleId !== undefined) updateData.depositRule = depositRuleId
      ? { connect: { id: parseInt(String(depositRuleId)) } }
      : { disconnect: true };
    if (containerType !== undefined) updateData.containerType = containerType;
    if (containerVolumeOz !== undefined) updateData.containerVolumeOz = containerVolumeOz != null ? parseFloat(String(containerVolumeOz)) : null;
    if (size !== undefined) updateData.size = size;
    if (sizeUnit !== undefined) updateData.sizeUnit = sizeUnit;
    if (pack !== undefined) updateData.pack = pack ? parseInt(String(pack)) : null;
    if (casePacks !== undefined) updateData.casePacks = casePacks ? parseInt(String(casePacks)) : null;
    if (sellUnitSize !== undefined) updateData.sellUnitSize = sellUnitSize ? parseInt(String(sellUnitSize)) : null;
    if (defaultCostPrice !== undefined) updateData.defaultCostPrice = defaultCostPrice != null ? parseFloat(String(defaultCostPrice)) : null;
    if (defaultRetailPrice !== undefined) updateData.defaultRetailPrice = defaultRetailPrice != null ? parseFloat(String(defaultRetailPrice)) : null;
    if (defaultCasePrice !== undefined) updateData.defaultCasePrice = defaultCasePrice != null ? parseFloat(String(defaultCasePrice)) : null;
    if (salePrice !== undefined) updateData.salePrice = salePrice != null ? parseFloat(String(salePrice)) : null;
    if (saleStart !== undefined) {
      const r = tryParseDate(res, saleStart, 'saleStart'); if (!r.ok) return;
      updateData.saleStart = r.value;
    }
    if (saleEnd !== undefined) {
      const r = tryParseDate(res, saleEnd, 'saleEnd'); if (!r.ok) return;
      updateData.saleEnd = r.value;
    }
    if (autoSync !== undefined) updateData.autoSync = autoSync;
    if (active !== undefined) updateData.active = active;

    const group = await prisma.productGroup.update({ where: { id }, data: updateData });

    // Cascade to members if autoSync is on
    let cascaded = 0;
    if (group.autoSync) {
      cascaded = await cascadeToMembers(orgId, group, oldRetailPrice);
    }

    res.json({ success: true, data: group, cascaded });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── DELETE /api/catalog/groups/:id ───────────────────────────────────────────
export const deleteProductGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const id = parseInt(req.params.id);

    const existing = await prisma.productGroup.findFirst({ where: { id, orgId } });
    if (!existing) { res.status(404).json({ success: false, error: 'Group not found' }); return; }

    // Unlink all products first (set productGroupId to null)
    await prisma.masterProduct.updateMany({
      where: { productGroupId: id },
      data: { productGroupId: null },
    });

    await prisma.productGroup.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── POST /api/catalog/groups/:id/apply ───────────────────────────────────────
// Manually push template fields to all member products
export const applyGroupTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const id = parseInt(req.params.id);

    const group = await prisma.productGroup.findFirst({ where: { id, orgId } });
    if (!group) { res.status(404).json({ success: false, error: 'Group not found' }); return; }

    const updated = await cascadeToMembers(orgId, group, null);
    res.json({ success: true, updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── POST /api/catalog/groups/:id/add-products ────────────────────────────────
// Add products to a group and auto-fill template fields
export const addProductsToGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const id = parseInt(req.params.id);
    const { productIds, applyTemplate = true } = req.body as {
      productIds?: (string | number)[];
      applyTemplate?: boolean;
    };

    if (!Array.isArray(productIds) || productIds.length === 0) {
      res.status(400).json({ success: false, error: 'productIds array required' });
      return;
    }

    const group = await prisma.productGroup.findFirst({ where: { id, orgId } });
    if (!group) { res.status(404).json({ success: false, error: 'Group not found' }); return; }

    // Build update data — only non-null template fields
    const update: Record<string, unknown> = { productGroupId: id };
    if (applyTemplate) {
      const groupRec = group as unknown as Record<string, unknown>;
      for (const field of CASCADE_FIELDS) {
        const value = groupRec[field];
        if (value !== null && value !== undefined) {
          update[field] = value;
        }
      }
    }

    const result = await prisma.masterProduct.updateMany({
      where: {
        id: { in: productIds.map((pid) => parseInt(String(pid))) },
        orgId,
      },
      data: update as Prisma.MasterProductUpdateManyMutationInput,
    });

    res.json({ success: true, added: result.count });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ── POST /api/catalog/groups/:id/remove-products ─────────────────────────────
export const removeProductsFromGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const { productIds } = req.body as { productIds?: (string | number)[] };

    if (!Array.isArray(productIds) || productIds.length === 0) {
      res.status(400).json({ success: false, error: 'productIds array required' });
      return;
    }

    const result = await prisma.masterProduct.updateMany({
      where: {
        id: { in: productIds.map((pid) => parseInt(String(pid))) },
        orgId,
      },
      data: { productGroupId: null },
    });

    res.json({ success: true, removed: result.count });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

interface ProductGroupRow {
  id: number;
  defaultRetailPrice?: unknown;
  autoSync: boolean;
  [extra: string]: unknown;
}

// ── Internal helper: cascade group template to members ──────────────────────
async function cascadeToMembers(
  orgId: string,
  group: ProductGroupRow,
  _oldRetailPrice: number | null,
): Promise<number> {
  // Fetch member products before update (for price change detection)
  const members = await prisma.masterProduct.findMany({
    where: { orgId, productGroupId: group.id },
    select: { id: true, defaultRetailPrice: true },
  });

  if (members.length === 0) return 0;

  const update: Record<string, unknown> = {};
  for (const field of CASCADE_FIELDS) {
    const value = group[field];
    if (value !== null && value !== undefined) {
      update[field] = value;
    }
  }

  if (Object.keys(update).length === 0) return 0;

  const result = await prisma.masterProduct.updateMany({
    where: { orgId, productGroupId: group.id },
    data: update as Prisma.MasterProductUpdateManyMutationInput,
  });

  // Queue label reprints for price changes
  if (update.defaultRetailPrice !== undefined) {
    try {
      type MemberRow = { id: string; defaultRetailPrice: unknown };
      for (const m of members as MemberRow[]) {
        const oldPrice = Number(m.defaultRetailPrice) || null;
        const newPrice = Number(group.defaultRetailPrice) || null;
        if (oldPrice !== newPrice) {
          await queueLabelForPriceChange(orgId, null, m.id, oldPrice, newPrice);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[ProductGroup] Label queue failed:', message);
    }
  }

  return result.count;
}
