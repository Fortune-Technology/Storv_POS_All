/**
 * Catalog Controller (TypeScript)
 *
 * Handles the native POS product catalog stored in PostgreSQL.
 * All data is scoped to the requesting organization (req.tenantId / req.storeId).
 *
 * Endpoints cover:
 *   - Departments      GET/POST/PUT/DELETE
 *   - Tax Rules        GET/POST/PUT/DELETE
 *   - Deposit Rules    GET/POST/PUT/DELETE
 *   - Vendors          GET/POST/PUT/DELETE
 *   - Rebate Programs  GET/POST/PUT/DELETE
 *   - Master Products  GET/POST/PUT/DELETE + search + bulk
 *   - Store Products   GET/POST/PUT + stock adjustment
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { parsePrice } from '../utils/validators.js';
import * as XLSX from 'xlsx';
import { logAudit } from '../services/auditService.js';
import {
  errMsg,
  errCode,
  errStatus,
  type StatusError,
} from '../utils/typeHelpers.js';

// ── Augmented Error (catalog-specific: adds `conflict` surface) ────────────
// Extends the shared StatusError so generic helpers (errCode, errStatus)
// keep working; UPC-conflict throw paths use this richer shape so the
// downstream handler can read `err.conflict` and produce a 409 with the
// conflicting product details.
type CatalogStatusError = StatusError & {
  conflict?: UpcConflict | null;
};

// ── Safe price coercer ─────────────────────────────────────────────────────
// Wrap parsePrice so controllers can one-line the transform.
// Returns parsed value or null. Throws a 400-formatted Error on invalid input
// (caught by the controller try/catch — do not swallow silently).
function toPrice(value: unknown, field: string): number | null {
  const r = parsePrice(value, { min: 0, max: 9999999, allowNull: true });
  if (!r.ok) {
    const e = new Error(`${field}: ${r.error}`) as CatalogStatusError;
    e.status = 400;
    throw e;
  }
  return r.value as number | null;
}

import { normalizeUPC, upcVariants } from '../utils/upc.js';
import { batchResolveProductImages } from '../services/globalImageService.js';
import {
  queueLabelForPriceChange,
  queueLabelForNewProduct,
  queueLabelForSale,
} from '../services/labelQueueService.js';
import { tryParseDate } from '../utils/safeDate.js';

// ── E-commerce sync (optional) ────────────────────────────────────────────
// If Redis / @storeveu/queue is not installed, all emit functions are silent
// no-ops. POS operations are never blocked.
type EmitProductSync = (
  orgId: string,
  productId: number,
  action: 'create' | 'update' | 'delete',
  payload?: unknown,
) => Promise<void>;
type EmitDepartmentSync = (
  orgId: string,
  departmentId: number,
  action: 'create' | 'update' | 'delete',
  payload?: unknown,
) => Promise<void>;
type EmitInventorySync = (
  orgId: string,
  storeId: string,
  productId: number,
  action: 'update',
  payload?: unknown,
) => Promise<void>;

let emitProductSync: EmitProductSync = async () => {};
let emitDepartmentSync: EmitDepartmentSync = async () => {};
let emitInventorySync: EmitInventorySync = async () => {};
try {
  const producers = (await import('@storeveu/queue/producers')) as {
    emitProductSync: EmitProductSync;
    emitDepartmentSync: EmitDepartmentSync;
    emitInventorySync: EmitInventorySync;
  };
  emitProductSync = producers.emitProductSync;
  emitDepartmentSync = producers.emitDepartmentSync;
  emitInventorySync = producers.emitInventorySync;
} catch {
  console.log(
    '⚠ @storeveu/queue not available — e-commerce sync disabled (this is fine if not using e-commerce)',
  );
}

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

const getOrgId = (req: Request): string | undefined =>
  req.tenantId || req.user?.orgId || undefined;
const getStoreId = (req: Request): string | undefined => req.storeId || undefined;

// ── Permissive prisma row shapes (the same workaround as lottery + posTerminal:
// `prisma` resolves to `any` from the JS postgres.js wrapper, so callbacks
// see implicit-any unless we cast each findMany result).
type ProductRowLite = {
  id: number;
  name: string;
  upc?: string | null;
  imageUrl?: string | null;
  brand?: string | null;
  defaultRetailPrice?: number | string | null;
  defaultCostPrice?: number | string | null;
  taxClass?: string | null;
  taxRuleId?: number | null;
  departmentId?: number | null;
  vendorId?: number | null;
  storeProducts?: Array<{
    quantityOnHand?: number | string | null;
    retailPrice?: number | string | null;
    costPrice?: number | string | null;
    inStock?: boolean | null;
    salePrice?: number | string | null;
  }>;
  // Catch-all so spread-and-augment patterns keep working
  [k: string]: unknown;
};

type TaxRuleRow = {
  id: number;
  name: string;
  appliesTo: string;
  rate: number | string;
};

type ProductUpcRow = {
  masterProductId: number;
  upc: string;
  label?: string | null;
};

type ProductPackSizeRow = {
  masterProductId: number;
  label?: string | null;
  unitCount?: number | null;
  retailPrice?: number | string | null;
  isDefault?: boolean;
  sortOrder?: number | null;
};

type CashPayoutRow = {
  amount: number | string | null;
  createdAt: Date;
  payoutType?: string | null;
};

type ProductMappingRow = {
  id: number;
  isPrimary: boolean;
  vendorItemCode?: string | null;
  lastReceivedAt?: Date | null;
  createdAt?: Date;
};

type PromotionRow = {
  id: number;
  name: string;
  promoType: string;
  productIds: number[];
  departmentIds: number[];
  dealConfig: Record<string, unknown> | null;
  badgeLabel?: string | null;
  badgeColor?: string | null;
};

interface PromoLineItem {
  lineId: string;
  productId?: number;
  departmentId?: number;
  qty: number;
  unitPrice: number;
  discountEligible?: boolean;
}

interface PromoAdjustment {
  discountType: 'percent' | 'amount' | 'fixed' | string;
  discountValue: number;
  promoId: number;
  promoName: string;
  badgeLabel: string;
  badgeColor: string;
}

// ─────────────────────────────────────────────────
// UPC Uniqueness Assertion
// ─────────────────────────────────────────────────
// Two parallel UPC stores exist in the schema:
//   1. MasterProduct.upc        — legacy single-UPC field, indexed (NOT unique)
//   2. ProductUpc.upc           — multi-UPC table, @@unique([orgId, upc])
//
// The unique constraint on ProductUpc only protects rows added through that
// table — it does NOT prevent two MasterProducts from sharing the same legacy
// `upc`, nor does it stop a ProductUpc row from colliding with another product's
// MasterProduct.upc. That created the conflict the user reported when scanning
// a barcode that resolved to multiple candidate products.
//
// This helper consolidates the check across both tables. Pass `excludeProductId`
// when updating an existing product so the product's own UPC doesn't trigger
// a self-conflict. Returns the conflicting product's id+name+source when the
// UPC is taken, or null when free.
interface UpcConflict {
  source: 'master' | 'productUpc';
  conflictingProductId: number;
  conflictingProductName: string;
  upc: string | null;
}

async function findUpcConflict(
  prismaClient: typeof prisma,
  orgId: string,
  upc: unknown,
  excludeProductId: number | string | null = null,
): Promise<UpcConflict | null> {
  if (!upc) return null;
  const normalized = (typeof upc === 'string' ? upc : String(upc)).replace(/[\s\-\.]/g, '');
  if (!normalized) return null;

  // 1) Conflict on legacy MasterProduct.upc?
  const mp = await prismaClient.masterProduct.findFirst({
    where: {
      orgId,
      upc: normalized,
      deleted: false,
      ...(excludeProductId != null
        ? { id: { not: parseInt(String(excludeProductId)) } }
        : {}),
    },
    select: { id: true, name: true, upc: true },
  });
  if (mp) {
    return {
      source: 'master',
      conflictingProductId: mp.id,
      conflictingProductName: mp.name,
      upc: mp.upc,
    };
  }

  // 2) Conflict on ProductUpc table?
  const pu = await prismaClient.productUpc.findFirst({
    where: {
      orgId,
      upc: normalized,
      ...(excludeProductId != null
        ? { masterProductId: { not: parseInt(String(excludeProductId)) } }
        : {}),
    },
    select: {
      id: true,
      upc: true,
      masterProduct: { select: { id: true, name: true } },
    },
  });
  if (pu && pu.masterProduct) {
    return {
      source: 'productUpc',
      conflictingProductId: pu.masterProduct.id,
      conflictingProductName: pu.masterProduct.name,
      upc: pu.upc,
    };
  }
  return null;
}

// Throws a 409-flavoured error when a UPC is already taken. Caller surfaces
// the message as a 409 response. The conflicting product's name + id are in
// the message so the cashier knows exactly which product owns the barcode.
async function assertUpcUnique(
  prismaClient: typeof prisma,
  orgId: string,
  upc: unknown,
  excludeProductId: number | string | null = null,
): Promise<void> {
  const conflict = await findUpcConflict(prismaClient, orgId, upc, excludeProductId);
  if (conflict) {
    const e = new Error(
      `UPC "${conflict.upc}" is already used by product "${conflict.conflictingProductName}" (id ${conflict.conflictingProductId}). Each UPC must be unique within the organisation.`,
    ) as CatalogStatusError;
    e.status = 409;
    e.code = 'UPC_CONFLICT';
    e.conflict = conflict;
    throw e;
  }
}

// ─────────────────────────────────────────────────
// Touch MasterProduct (bump updatedAt for incremental sync)
// ─────────────────────────────────────────────────
// Pack sizes and UPCs live in their own tables (ProductPackSize / ProductUpc)
// so adding a pack size doesn't naturally bump the parent MasterProduct's
// updatedAt timestamp. The cashier-app's incremental sync filters by
// `updatedAt > lastSync` — without this manual bump, a freshly-configured
// pack size never reaches the local IndexedDB cache and the cashier never
// sees the picker on scan. Best-effort: failure to bump is non-fatal so
// the underlying mutation still succeeds.
async function touchMasterProduct(
  orgId: string | undefined,
  masterProductId: number | string | null | undefined,
): Promise<void> {
  if (!masterProductId) return;
  try {
    await prisma.masterProduct.update({
      where: { id: parseInt(String(masterProductId)) },
      data: { updatedAt: new Date() },
    });
  } catch (e: unknown) {
    // Product might be soft-deleted or wrong-org — log + swallow
    console.warn(
      `[touchMasterProduct] Failed to bump product ${masterProductId} (org ${orgId}):`,
      errMsg(e),
    );
  }
}

// ─────────────────────────────────────────────────
// Deposit flattener — normalises every product payload so downstream
// consumers (cashier cart, portal table, reports) can read a single
// `depositAmount` field regardless of whether the deposit was set via
// the new `MasterProduct.depositPerUnit` scalar or the legacy nested
// DepositRule. Must stay in lockstep with the formula in
// posTerminalController.js → getCatalogSnapshot.
// ─────────────────────────────────────────────────
type DepositSource = {
  depositPerUnit?: number | string | null;
  depositRule?: { depositAmount: number | string } | null;
  sellUnitSize?: number | null;
  [k: string]: unknown;
};
const flattenDeposit = <T extends DepositSource | null | undefined>(p: T): T => {
  if (!p) return p;
  const depositAmount =
    p.depositPerUnit != null
      ? Number(p.depositPerUnit)
      : p.depositRule
        ? Number(p.depositRule.depositAmount) * (p.sellUnitSize || 1)
        : null;
  return { ...p, depositAmount } as T;
};

const paginationParams = (
  query: Record<string, unknown>,
): { skip: number; take: number; page: number; limit: number } => {
  const page = Math.max(1, parseInt(String(query.page)) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(String(query.limit)) || 50));
  return { skip: (page - 1) * limit, take: limit, page, limit };
};

// ═══════════════════════════════════════════════════════
// DEPARTMENTS
// ═══════════════════════════════════════════════════════

export const getDepartments = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const showInactive = req.query.includeInactive === 'true';

    const departments = await prisma.department.findMany({
      where: { orgId, ...(showInactive ? {} : { active: true }) },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ success: true, data: departments });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

const VALID_DEPT_CATEGORIES = ['wine', 'liquor', 'beer', 'tobacco', 'general'];

// Auto-guess a dept's category from name/code — used as a default when the
// retailer doesn't pick one explicitly. See also `categorize()` in seedDeptAttributes.
function guessDeptCategory(name: string, code: string | null | undefined): string | null {
  const n = String(name || '').toLowerCase();
  const c = String(code || '').toLowerCase();
  if (c === 'wine' || n.includes('wine') || n.includes('champagne') || n.includes('vino'))
    return 'wine';
  if (
    c === 'beer' ||
    n.includes('beer') ||
    n.includes('cerveza') ||
    n.includes('cider') ||
    n.includes('malt')
  )
    return 'beer';
  if (
    ['liquor', 'spirits', 'spirit', 'liq', 'spir'].includes(c) ||
    n.includes('liquor') ||
    n.includes('spirit') ||
    n.includes('whiskey') ||
    n.includes('licor')
  )
    return 'liquor';
  if (
    ['tobac', 'tobacco', 'vape', 'smoke'].some((t) => c.includes(t)) ||
    n.includes('tobacco') ||
    n.includes('vape') ||
    n.includes('cigar') ||
    n.includes('smoke')
  )
    return 'tobacco';
  return null;
}

export const createDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const {
      name,
      code,
      description,
      ageRequired,
      ebtEligible,
      taxClass,
      bottleDeposit,
      sortOrder,
      color,
      showInPOS,
      category,
    } = req.body;

    if (!name) {
      res.status(400).json({ success: false, error: 'name is required' });
      return;
    }

    // Explicit category wins; otherwise auto-guess from name/code.
    let finalCategory: string | null = null;
    if (category && VALID_DEPT_CATEGORIES.includes(category)) finalCategory = category;
    else if (category === null || category === '') finalCategory = null;
    else finalCategory = guessDeptCategory(name, code);

    const dept = await prisma.department.create({
      data: {
        orgId,
        name,
        code: code?.toUpperCase() || null,
        description: description || null,
        ageRequired: ageRequired ? parseInt(ageRequired) : null,
        ebtEligible: Boolean(ebtEligible),
        taxClass: taxClass || null,
        bottleDeposit: Boolean(bottleDeposit),
        sortOrder: parseInt(sortOrder) || 0,
        color: color || null,
        showInPOS: showInPOS !== undefined ? Boolean(showInPOS) : true,
        category: finalCategory,
      },
    });

    emitDepartmentSync(orgId, dept.id, 'create', dept);
    res.status(201).json({ success: true, data: dept });
  } catch (err) {
    if (errCode(err) === 'P2002') {
      res.status(409).json({ success: false, error: 'Department code already exists' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const {
      name,
      code,
      description,
      ageRequired,
      ebtEligible,
      taxClass,
      bottleDeposit,
      sortOrder,
      color,
      showInPOS,
      active,
      category,
    } = req.body;

    // Validate + normalize category. Empty string clears the category.
    let categoryUpdate: string | null | undefined;
    if (category !== undefined) {
      if (category === null || category === '') categoryUpdate = null;
      else if (VALID_DEPT_CATEGORIES.includes(category)) categoryUpdate = category;
      else {
        res.status(400).json({
          success: false,
          error: `Invalid category. Must be one of: ${VALID_DEPT_CATEGORIES.join(', ')}`,
        });
        return;
      }
    }

    const dept = await prisma.department.update({
      where: { id, orgId },
      data: {
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code: code?.toUpperCase() }),
        ...(description !== undefined && { description }),
        ...(ageRequired !== undefined && {
          ageRequired: ageRequired ? parseInt(ageRequired) : null,
        }),
        ...(ebtEligible !== undefined && { ebtEligible: Boolean(ebtEligible) }),
        ...(taxClass !== undefined && { taxClass }),
        ...(bottleDeposit !== undefined && { bottleDeposit: Boolean(bottleDeposit) }),
        ...(sortOrder !== undefined && { sortOrder: parseInt(sortOrder) }),
        ...(color !== undefined && { color }),
        ...(showInPOS !== undefined && { showInPOS: Boolean(showInPOS) }),
        ...(active !== undefined && { active: Boolean(active) }),
        ...(category !== undefined && { category: categoryUpdate }),
      },
    });

    emitDepartmentSync(orgId as string, dept.id, 'update', dept);
    res.json({ success: true, data: dept });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Department not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deleteDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const force = req.query.force === 'true';

    // Check for active product assignments before deactivating. This prevents
    // the silent-data-loss bug where a user deactivates a dept, then later
    // edits a product whose dept is no longer in the dropdown, saves, and
    // loses the assignment entirely.
    const usageCount = await prisma.masterProduct.count({
      where: { orgId, departmentId: id, deleted: false },
    });
    if (usageCount > 0 && !force) {
      res.status(409).json({
        success: false,
        code: 'IN_USE',
        error:
          `Cannot delete: ${usageCount} product(s) are assigned to this department. ` +
          `Reassign them first, or retry with ?force=true to detach them.`,
        usageCount,
      });
      return;
    }
    if (force && usageCount > 0) {
      // User opted into cascade — clear FK on every product referencing this
      // department so nothing breaks on future edits.
      await prisma.masterProduct.updateMany({
        where: { orgId, departmentId: id },
        data: { departmentId: null },
      });
    }

    // Soft delete — set active: false
    await prisma.department.update({ where: { id, orgId }, data: { active: false } });
    emitDepartmentSync(orgId as string, id, 'delete');
    res.json({
      success: true,
      message:
        force && usageCount > 0
          ? `Department deactivated; ${usageCount} product(s) detached`
          : 'Department deactivated',
      detachedCount: force ? usageCount : 0,
    });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Department not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ═══════════════════════════════════════════════════════
// DEPARTMENT ATTRIBUTES (Session 4)
// ═══════════════════════════════════════════════════════

const VALID_ATTR_TYPES = ['text', 'decimal', 'integer', 'boolean', 'date', 'dropdown'];

// GET /api/catalog/department-attributes?departmentId=X
export const getDepartmentAttributes = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const departmentId = req.query.departmentId
      ? parseInt(req.query.departmentId as string)
      : null;

    const where =
      departmentId != null
        ? { orgId, active: true, OR: [{ departmentId }, { departmentId: null }] }
        : { orgId, active: true };

    const attrs = await prisma.departmentAttribute.findMany({
      where,
      orderBy: [{ departmentId: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
    });
    res.json({ success: true, data: attrs });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// POST /api/catalog/department-attributes
export const createDepartmentAttribute = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const {
      departmentId,
      key,
      label,
      dataType,
      required,
      options,
      unit,
      placeholder,
      sortOrder,
    } = req.body;

    if (!key || !label) {
      res.status(400).json({ success: false, error: 'key and label are required' });
      return;
    }
    const normalizedKey = String(key).toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_');
    const type = VALID_ATTR_TYPES.includes(dataType) ? dataType : 'text';

    const attr = await prisma.departmentAttribute.create({
      data: {
        orgId,
        departmentId: departmentId ? parseInt(departmentId) : null,
        key: normalizedKey,
        label,
        dataType: type,
        required: Boolean(required),
        options: Array.isArray(options) ? options : [],
        unit: unit || null,
        placeholder: placeholder || null,
        sortOrder: Number.isFinite(+sortOrder) ? +sortOrder : 0,
      },
    });
    res.status(201).json({ success: true, data: attr });
  } catch (err) {
    if (errCode(err) === 'P2002') {
      res
        .status(409)
        .json({ success: false, error: 'An attribute with this key already exists for that department' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// PUT /api/catalog/department-attributes/:id
export const updateDepartmentAttribute = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const body = req.body;
    const updates: Record<string, unknown> = {};

    if (body.label !== undefined) updates.label = body.label;
    if (body.dataType !== undefined)
      updates.dataType = VALID_ATTR_TYPES.includes(body.dataType) ? body.dataType : 'text';
    if (body.required !== undefined) updates.required = Boolean(body.required);
    if (body.options !== undefined)
      updates.options = Array.isArray(body.options) ? body.options : [];
    if (body.unit !== undefined) updates.unit = body.unit || null;
    if (body.placeholder !== undefined) updates.placeholder = body.placeholder || null;
    if (body.sortOrder !== undefined)
      updates.sortOrder = Number.isFinite(+body.sortOrder) ? +body.sortOrder : 0;
    if (body.active !== undefined) updates.active = Boolean(body.active);

    const attr = await prisma.departmentAttribute.update({
      where: { id, orgId },
      data: updates,
    });
    res.json({ success: true, data: attr });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Attribute not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// POST /api/catalog/departments/:id/apply-standard-attributes
export const applyStandardAttributes = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const dept = await prisma.department.findFirst({ where: { id, orgId } });
    if (!dept) {
      res.status(404).json({ success: false, error: 'Department not found' });
      return;
    }
    const cat = dept.category;
    if (!cat || cat === 'general') {
      res.status(400).json({
        success: false,
        error: `Set category before applying standard attributes (got "${cat || 'none'}").`,
      });
      return;
    }

    interface AttrPreset {
      key: string;
      label: string;
      dataType: string;
      placeholder?: string;
      sortOrder: number;
      options?: string[];
      unit?: string;
    }

    const PRESETS: Record<string, AttrPreset[]> = {
      wine: [
        { key: 'vintage', label: 'Vintage Year', dataType: 'integer', placeholder: 'e.g. 2019', sortOrder: 1 },
        { key: 'country', label: 'Country', dataType: 'text', placeholder: 'e.g. France', sortOrder: 2 },
        { key: 'region', label: 'Region', dataType: 'text', placeholder: 'e.g. Napa Valley', sortOrder: 3 },
        { key: 'varietal', label: 'Varietal', dataType: 'text', placeholder: 'e.g. Cabernet Sauvignon', sortOrder: 4 },
        { key: 'colour', label: 'Colour', dataType: 'dropdown', options: ['Red', 'White', 'Rosé', 'Sparkling', 'Dessert'], sortOrder: 5 },
        { key: 'abv', label: 'ABV', dataType: 'decimal', unit: '%', placeholder: 'e.g. 13.5', sortOrder: 6 },
        { key: 'bottle_size', label: 'Bottle Size', dataType: 'text', placeholder: 'e.g. 750ml', sortOrder: 7 },
      ],
      liquor: [
        { key: 'type', label: 'Type', dataType: 'dropdown', options: ['Whiskey', 'Vodka', 'Gin', 'Rum', 'Tequila', 'Brandy', 'Liqueur', 'Other'], sortOrder: 1 },
        { key: 'country', label: 'Country', dataType: 'text', placeholder: 'e.g. Scotland', sortOrder: 2 },
        { key: 'proof', label: 'Proof', dataType: 'decimal', unit: '°', placeholder: 'e.g. 80', sortOrder: 3 },
        { key: 'abv', label: 'ABV', dataType: 'decimal', unit: '%', placeholder: 'e.g. 40.0', sortOrder: 4 },
        { key: 'bottle_size', label: 'Bottle Size', dataType: 'text', placeholder: 'e.g. 750ml', sortOrder: 5 },
      ],
      beer: [
        { key: 'style', label: 'Style', dataType: 'dropdown', options: ['Lager', 'IPA', 'Stout', 'Wheat', 'Pilsner', 'Sour', 'Ale', 'Cider', 'Other'], sortOrder: 1 },
        { key: 'container', label: 'Container', dataType: 'dropdown', options: ['Can', 'Bottle', 'Keg'], sortOrder: 2 },
        { key: 'abv', label: 'ABV', dataType: 'decimal', unit: '%', placeholder: 'e.g. 5.0', sortOrder: 3 },
        { key: 'country', label: 'Country', dataType: 'text', placeholder: 'e.g. Mexico', sortOrder: 4 },
        { key: 'pack_count', label: 'Pack Count', dataType: 'integer', placeholder: 'e.g. 6', sortOrder: 5 },
      ],
      tobacco: [
        { key: 'type', label: 'Type', dataType: 'dropdown', options: ['Cigarette', 'Cigar', 'Pipe', 'Smokeless', 'Vape', 'E-Liquid', 'Rolling Paper', 'Other'], sortOrder: 1 },
        { key: 'nicotine_strength', label: 'Nicotine Strength', dataType: 'text', placeholder: 'e.g. 6mg', sortOrder: 2 },
        { key: 'flavour', label: 'Flavour', dataType: 'text', placeholder: 'e.g. Menthol', sortOrder: 3 },
        { key: 'country', label: 'Country', dataType: 'text', placeholder: 'e.g. USA', sortOrder: 4 },
      ],
    };

    const preset = PRESETS[cat] || [];
    let applied = 0;
    for (const a of preset) {
      try {
        await prisma.departmentAttribute.upsert({
          where: { orgId_departmentId_key: { orgId, departmentId: id, key: a.key } },
          create: {
            orgId,
            departmentId: id,
            key: a.key,
            label: a.label,
            dataType: a.dataType,
            options: a.options || [],
            unit: a.unit || null,
            placeholder: a.placeholder || null,
            sortOrder: a.sortOrder || 0,
          },
          update: {}, // never overwrite operator customizations
        });
        applied++;
      } catch {
        /* skip collisions silently */
      }
    }
    res.json({ success: true, applied, total: preset.length, category: cat });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// DELETE /api/catalog/department-attributes/:id
export const deleteDepartmentAttribute = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    await prisma.departmentAttribute.delete({ where: { id, orgId } });
    res.json({ success: true });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Attribute not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ═══════════════════════════════════════════════════════
// TAX RULES
// ═══════════════════════════════════════════════════════

export const getTaxRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const storeId = (req.query.storeId as string) || null;

    const rules = await prisma.taxRule.findMany({
      where: {
        orgId,
        active: true,
        ...(storeId ? { OR: [{ storeId }, { storeId: null }] } : { storeId: null }),
      },
      orderBy: { appliesTo: 'asc' },
    });

    res.json({ success: true, data: rules });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// Normalize departmentIds input — accept number[], string[] (IDs as strings),
// or a single value. Returns a clean number[] with invalid entries dropped.
function normalizeDeptIds(raw: unknown): number[] {
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((v) => (typeof v === 'number' ? v : parseInt(String(v), 10)))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export const createTaxRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const {
      name,
      description,
      rate,
      appliesTo,
      ebtExempt,
      state,
      county,
      storeId,
      departmentIds,
    } = req.body;

    const deptIds = normalizeDeptIds(departmentIds);
    const hasClass = appliesTo && String(appliesTo).trim() !== '';
    if (!name || rate == null || (!hasClass && deptIds.length === 0)) {
      res.status(400).json({
        success: false,
        error: 'name, rate, and either departments or appliesTo are required',
      });
      return;
    }

    const rule = await prisma.taxRule.create({
      data: {
        orgId,
        storeId: storeId || null,
        name,
        description: description || null,
        rate,
        appliesTo: hasClass ? appliesTo : 'all',
        departmentIds: deptIds,
        ebtExempt: ebtExempt !== false,
        state: state || null,
        county: county || null,
      },
    });

    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateTaxRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const body = req.body || {};
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.rate !== undefined) data.rate = body.rate;
    if (body.appliesTo !== undefined) data.appliesTo = body.appliesTo || 'all';
    if (body.ebtExempt !== undefined) data.ebtExempt = Boolean(body.ebtExempt);
    if (body.state !== undefined) data.state = body.state || null;
    if (body.county !== undefined) data.county = body.county || null;
    if (body.storeId !== undefined) data.storeId = body.storeId || null;
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.departmentIds !== undefined)
      data.departmentIds = normalizeDeptIds(body.departmentIds);

    const rule = await prisma.taxRule.update({
      where: { id, orgId },
      data,
    });

    res.json({ success: true, data: rule });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Tax rule not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deleteTaxRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const force = req.query.force === 'true';

    const usageCount = await prisma.masterProduct.count({
      where: { orgId, taxRuleId: id, deleted: false },
    });
    if (usageCount > 0 && !force) {
      res.status(409).json({
        success: false,
        code: 'IN_USE',
        error:
          `Cannot delete: ${usageCount} product(s) have this as their explicit tax rule. ` +
          `Reassign them first, or retry with ?force=true to detach them (they'll fall back to the legacy taxClass matcher).`,
        usageCount,
      });
      return;
    }
    if (force && usageCount > 0) {
      await prisma.masterProduct.updateMany({
        where: { orgId, taxRuleId: id },
        data: { taxRuleId: null },
      });
    }

    await prisma.taxRule.update({ where: { id, orgId }, data: { active: false } });
    res.json({
      success: true,
      message:
        force && usageCount > 0
          ? `Tax rule deactivated; ${usageCount} product(s) detached`
          : 'Tax rule deactivated',
      detachedCount: force ? usageCount : 0,
    });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Tax rule not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ═══════════════════════════════════════════════════════
// DEPOSIT RULES
// ═══════════════════════════════════════════════════════

export const getDepositRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const rules = await prisma.depositRule.findMany({
      where: { orgId, active: true },
      orderBy: { minVolumeOz: 'asc' },
    });
    res.json({ success: true, data: rules });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const createDepositRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const { name, description, minVolumeOz, maxVolumeOz, containerTypes, depositAmount, state } =
      req.body;

    if (!name || depositAmount == null) {
      res.status(400).json({ success: false, error: 'name and depositAmount are required' });
      return;
    }

    const rule = await prisma.depositRule.create({
      data: {
        orgId,
        name,
        description: description || null,
        minVolumeOz: minVolumeOz != null ? parseFloat(minVolumeOz) : null,
        maxVolumeOz: maxVolumeOz != null ? parseFloat(maxVolumeOz) : null,
        containerTypes: containerTypes || 'bottle,can',
        depositAmount,
        state: state || null,
      },
    });

    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updateDepositRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const rule = await prisma.depositRule.update({ where: { id, orgId }, data: req.body });
    res.json({ success: true, data: rule });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Deposit rule not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

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
    } = req.body;

    if (!name) {
      res.status(400).json({ success: false, error: 'name is required' });
      return;
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

// ═══════════════════════════════════════════════════════
// MASTER PRODUCTS
// ═══════════════════════════════════════════════════════

interface UnmappedRow {
  id: number;
  name: string;
  upc: string | null | undefined;
  departmentId: number | null | undefined;
  taxClass: string | null | undefined;
  taxRuleId: number | null;
  status: 'STALE_FK' | 'UNMAPPED' | 'AMBIGUOUS';
  suggestions: Array<{ id: number; name: string; rate: number }>;
  reason: string;
}

export const getTaxUnmappedProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { skip, take } = paginationParams(req.query as Record<string, unknown>);

    const rules = (await prisma.taxRule.findMany({
      where: { orgId, active: true },
      select: { id: true, name: true, appliesTo: true, rate: true },
    })) as TaxRuleRow[];
    const ruleIds = new Set(rules.map((r) => r.id));
    const byName = new Map<string, TaxRuleRow>();
    const byAppliesTo = new Map<string, TaxRuleRow[]>();
    const byRate = new Map<string, TaxRuleRow[]>();
    for (const r of rules) {
      const nk = String(r.name).toLowerCase().trim();
      const ak = String(r.appliesTo).toLowerCase().trim();
      if (nk && !byName.has(nk)) byName.set(nk, r);
      if (ak) {
        if (!byAppliesTo.has(ak)) byAppliesTo.set(ak, []);
        byAppliesTo.get(ak)!.push(r);
      }
      const rk = Number(r.rate).toFixed(4);
      if (!byRate.has(rk)) byRate.set(rk, []);
      byRate.get(rk)!.push(r);
    }

    type TaxProductRow = {
      id: number;
      name: string;
      upc: string | null;
      taxClass: string | null;
      taxRuleId: number | null;
      departmentId: number | null;
    };
    const products = (await prisma.masterProduct.findMany({
      where: { orgId, deleted: false },
      select: {
        id: true,
        name: true,
        upc: true,
        taxClass: true,
        taxRuleId: true,
        departmentId: true,
      },
    })) as TaxProductRow[];

    const unmapped: UnmappedRow[] = [];
    const countsByStatus = { STALE_FK: 0, UNMAPPED: 0, AMBIGUOUS: 0, OK: 0 };

    for (const p of products) {
      if (p.taxRuleId && !ruleIds.has(p.taxRuleId)) {
        unmapped.push({
          id: p.id,
          name: p.name,
          upc: p.upc,
          departmentId: p.departmentId,
          taxClass: p.taxClass,
          taxRuleId: p.taxRuleId,
          status: 'STALE_FK',
          suggestions: [],
          reason: 'taxRuleId points at a rule that is inactive or no longer exists',
        });
        countsByStatus.STALE_FK++;
        continue;
      }
      if (p.taxRuleId) {
        countsByStatus.OK++;
        continue;
      }

      if (!p.taxClass) {
        countsByStatus.OK++;
        continue;
      }

      const tc = String(p.taxClass).toLowerCase().trim();

      if (byName.has(tc)) {
        countsByStatus.OK++;
        continue;
      }

      const apHits = byAppliesTo.get(tc);
      if (apHits) {
        if (apHits.length === 1) {
          countsByStatus.OK++;
          continue;
        }
        unmapped.push({
          id: p.id,
          name: p.name,
          upc: p.upc,
          departmentId: p.departmentId,
          taxClass: p.taxClass,
          taxRuleId: null,
          status: 'AMBIGUOUS',
          suggestions: apHits.map((r) => ({ id: r.id, name: r.name, rate: Number(r.rate) })),
          reason: `${apHits.length} active rules match appliesTo="${tc}"`,
        });
        countsByStatus.AMBIGUOUS++;
        continue;
      }

      const cleaned = p.taxClass.replace(/[%$,\s]/g, '').trim();
      const n = parseFloat(cleaned);
      if (!isNaN(n) && n >= 0) {
        const dec = n <= 1 ? n : n / 100;
        const rk = dec.toFixed(4);
        const rateHits = byRate.get(rk);
        if (rateHits?.length === 1) {
          countsByStatus.OK++;
          continue;
        }
        if (rateHits && rateHits.length > 1) {
          unmapped.push({
            id: p.id,
            name: p.name,
            upc: p.upc,
            departmentId: p.departmentId,
            taxClass: p.taxClass,
            taxRuleId: null,
            status: 'AMBIGUOUS',
            suggestions: rateHits.map((r) => ({ id: r.id, name: r.name, rate: Number(r.rate) })),
            reason: `${rateHits.length} active rules match rate ${(dec * 100).toFixed(2)}%`,
          });
          countsByStatus.AMBIGUOUS++;
          continue;
        }
      }

      unmapped.push({
        id: p.id,
        name: p.name,
        upc: p.upc,
        departmentId: p.departmentId,
        taxClass: p.taxClass,
        taxRuleId: null,
        status: 'UNMAPPED',
        suggestions: [],
        reason: `No active rule matches taxClass="${p.taxClass}"`,
      });
      countsByStatus.UNMAPPED++;
    }

    const total = unmapped.length;
    const paged = unmapped.slice(skip, skip + take);

    res.json({
      success: true,
      summary: {
        totalProducts: products.length,
        okCount: countsByStatus.OK,
        unmappedCount: countsByStatus.UNMAPPED,
        ambiguousCount: countsByStatus.AMBIGUOUS,
        staleFkCount: countsByStatus.STALE_FK,
        activeRuleCount: rules.length,
      },
      total,
      skip,
      take,
      data: paged,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

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
    const isUpcLike = digitsOnlyQuery.length >= 6 && digitsOnlyQuery.length <= 14;

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
          select: { id: true, name: true, rate: true, appliesTo: true, active: true },
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
        select: { id: true, appliesTo: true },
      });
      if (!rule) {
        res
          .status(400)
          .json({ success: false, error: `taxRuleId ${taxRuleId} not found for this org` });
        return;
      }
      resolvedTaxRuleId = rule.id;
      if (taxClass == null) {
        taxClass = rule.appliesTo;
      }
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
      const { upsertGlobalImage } = await import('../services/globalImageService.js');
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
          select: { id: true, appliesTo: true },
        });
        if (!rule) {
          res.status(400).json({
            success: false,
            error: `taxRuleId ${body.taxRuleId} not found for this org`,
          });
          return;
        }
        updates.taxRuleId = rule.id;
        if (body.taxClass === undefined) updates.taxClass = rule.appliesTo;
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
      const { upsertGlobalImage } = await import('../services/globalImageService.js');
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

// ═══════════════════════════════════════════════════════
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
      select: { retailPrice: true, salePrice: true },
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

export const getPromotions = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { active, promoType } = req.query;
    const where = {
      orgId,
      ...(active === 'true' && { active: true }),
      ...(active === 'false' && { active: false }),
      ...(promoType && { promoType: promoType as string }),
    };
    const promos = await prisma.promotion.findMany({
      where,
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ success: true, data: promos });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const createPromotion = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const {
      name,
      promoType,
      description,
      productIds,
      departmentIds,
      dealConfig,
      badgeLabel,
      badgeColor,
      startDate,
      endDate,
      active,
    } = req.body;

    if (!name || !promoType) {
      res.status(400).json({ error: 'name and promoType are required.' });
      return;
    }

    const sd = tryParseDate(res, startDate, 'startDate');
    if (!sd.ok) return;
    const ed = tryParseDate(res, endDate, 'endDate');
    if (!ed.ok) return;

    const promo = await prisma.promotion.create({
      data: {
        orgId,
        name,
        promoType,
        description: description ?? null,
        productIds: Array.isArray(productIds) ? productIds.map(Number) : [],
        departmentIds: Array.isArray(departmentIds) ? departmentIds.map(Number) : [],
        dealConfig: dealConfig ?? {},
        badgeLabel: badgeLabel ?? null,
        badgeColor: badgeColor ?? null,
        startDate: sd.value,
        endDate: ed.value,
        active: active ?? true,
      },
    });

    res.status(201).json({ success: true, data: promo });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const updatePromotion = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const existing = await prisma.promotion.findFirst({ where: { id, orgId } });
    if (!existing) {
      res.status(404).json({ error: 'Promotion not found.' });
      return;
    }

    const {
      name,
      promoType,
      description,
      productIds,
      departmentIds,
      dealConfig,
      badgeLabel,
      badgeColor,
      startDate,
      endDate,
      active,
    } = req.body;

    const updated = await prisma.promotion.update({
      where: { id },
      data: {
        ...(name != null && { name }),
        ...(promoType != null && { promoType }),
        ...(description != null && { description }),
        ...(productIds != null && { productIds: productIds.map(Number) }),
        ...(departmentIds != null && { departmentIds: departmentIds.map(Number) }),
        ...(dealConfig != null && { dealConfig }),
        ...(badgeLabel != null && { badgeLabel }),
        ...(badgeColor != null && { badgeColor }),
        ...(active != null && { active }),
      },
    });

    if (startDate !== undefined) {
      const r = tryParseDate(res, startDate, 'startDate');
      if (!r.ok) return;
      await prisma.promotion.update({ where: { id }, data: { startDate: r.value } });
    }
    if (endDate !== undefined) {
      const r = tryParseDate(res, endDate, 'endDate');
      if (!r.ok) return;
      await prisma.promotion.update({ where: { id }, data: { endDate: r.value } });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deletePromotion = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const existing = await prisma.promotion.findFirst({ where: { id, orgId } });
    if (!existing) {
      res.status(404).json({ error: 'Promotion not found.' });
      return;
    }

    await prisma.promotion.delete({ where: { id } });
    res.json({ success: true, message: 'Promotion deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const evaluatePromotions = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { items } = req.body as { items?: PromoLineItem[] };

    if (!Array.isArray(items) || !items.length) {
      res.json({
        success: true,
        data: { lineAdjustments: {}, totalSaving: 0, appliedPromos: [] },
      });
      return;
    }

    const now = new Date();
    const promosRaw = await prisma.promotion.findMany({
      where: {
        orgId,
        active: true,
        OR: [{ startDate: null }, { startDate: { lte: now } }],
        AND: [
          {
            OR: [{ endDate: null }, { endDate: { gte: now } }],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    const promos = promosRaw as PromotionRow[];

    const lineAdjustments: Record<string, PromoAdjustment> = {};
    interface AppliedPromo {
      id: number;
      name: string;
      promoType: string;
      badgeLabel?: string | null;
      badgeColor?: string | null;
    }
    const appliedPromos: AppliedPromo[] = [];

    const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

    const getQualifying = (promo: PromotionRow): PromoLineItem[] =>
      items.filter((item) => {
        if (item.discountEligible === false) return false;
        const hasProd = (promo.productIds?.length ?? 0) > 0;
        const hasDept = (promo.departmentIds?.length ?? 0) > 0;
        if (!hasProd && !hasDept) return true;
        if (hasProd && item.productId != null && promo.productIds.includes(item.productId)) return true;
        if (hasDept && item.departmentId != null && promo.departmentIds.includes(item.departmentId))
          return true;
        return false;
      });

    const makeAdj = (
      promo: PromotionRow,
      dt: string,
      dv: number,
    ): PromoAdjustment => ({
      discountType: dt,
      discountValue: round2(dv),
      promoId: promo.id,
      promoName: promo.name,
      badgeLabel: promo.badgeLabel || promo.name,
      badgeColor: promo.badgeColor || '#f59e0b',
    });

    for (const promo of promos) {
      const cfg = (promo.dealConfig || {}) as Record<string, unknown>;
      const qualifying = getQualifying(promo);
      if (!qualifying.length) continue;

      const result: Record<string, PromoAdjustment> = {};

      if (promo.promoType === 'sale') {
        for (const item of qualifying) {
          if (item.qty < ((cfg.minQty as number) || 1)) continue;
          result[item.lineId] = makeAdj(
            promo,
            (cfg.discountType as string) || 'percent',
            parseFloat(String(cfg.discountValue)) || 0,
          );
        }
      } else if (promo.promoType === 'bogo') {
        const buyQty = (cfg.buyQty as number) || 1;
        const getQty = (cfg.getQty as number) || 1;
        const getDiscount = cfg.getDiscount != null ? (cfg.getDiscount as number) : 100;
        const setSize = buyQty + getQty;
        const units: Array<{ lineId: string; price: number }> = [];
        for (const item of qualifying) {
          for (let i = 0; i < item.qty; i++)
            units.push({ lineId: item.lineId, price: parseFloat(String(item.unitPrice)) });
        }
        units.sort((a, b) => b.price - a.price);
        let numSets = Math.floor(units.length / setSize);
        if (cfg.maxSets) numSets = Math.min(numSets, cfg.maxSets as number);
        const lineDisc: Record<string, number> = {};
        for (let s = 0; s < numSets; s++) {
          const free = units.slice(s * setSize + buyQty, (s + 1) * setSize);
          for (const u of free)
            lineDisc[u.lineId] = (lineDisc[u.lineId] || 0) + (u.price * getDiscount) / 100;
        }
        for (const item of qualifying) {
          if (!lineDisc[item.lineId]) continue;
          result[item.lineId] = makeAdj(promo, 'amount', round2(lineDisc[item.lineId] / item.qty));
        }
      } else if (promo.promoType === 'volume') {
        const totalQty = qualifying.reduce((s, i) => s + i.qty, 0);
        interface VolumeTier {
          minQty: number;
          discountType?: string;
          discountValue?: number | string;
        }
        const tiers = (((cfg.tiers as VolumeTier[]) || []).slice() as VolumeTier[]).sort(
          (a, b) => b.minQty - a.minQty,
        );
        const tier = tiers.find((t) => totalQty >= t.minQty);
        if (tier) {
          for (const item of qualifying) {
            result[item.lineId] = makeAdj(
              promo,
              tier.discountType || 'percent',
              parseFloat(String(tier.discountValue)) || 0,
            );
          }
        }
      } else if (promo.promoType === 'mix_match') {
        const groupSize = (cfg.groupSize as number) || 2;
        const bundlePrice = parseFloat(String(cfg.bundlePrice)) || 0;
        const units: Array<{ lineId: string; price: number }> = [];
        for (const item of qualifying) {
          for (let i = 0; i < item.qty; i++)
            units.push({ lineId: item.lineId, price: parseFloat(String(item.unitPrice)) });
        }
        units.sort((a, b) => a.price - b.price);
        const numGroups = Math.floor(units.length / groupSize);
        if (numGroups > 0) {
          const groupUnits = units.slice(0, numGroups * groupSize);
          const regTotal = groupUnits.reduce((s, u) => s + u.price, 0);
          const totalDisc = Math.max(0, regTotal - numGroups * bundlePrice);
          if (totalDisc > 0) {
            const lineDiscTotal: Record<string, number> = {};
            for (const u of groupUnits)
              lineDiscTotal[u.lineId] =
                (lineDiscTotal[u.lineId] || 0) + (u.price / regTotal) * totalDisc;
            for (const item of qualifying) {
              if (!lineDiscTotal[item.lineId]) continue;
              result[item.lineId] = makeAdj(
                promo,
                'amount',
                round2(lineDiscTotal[item.lineId] / item.qty),
              );
            }
          }
        }
      } else if (promo.promoType === 'combo') {
        interface ComboGroup {
          productIds?: number[];
          minQty?: number;
        }
        const requiredGroups = (cfg.requiredGroups as ComboGroup[]) || [];
        let allSatisfied = true;
        for (const group of requiredGroups) {
          const ids = group.productIds || [];
          const minQty = group.minQty || 1;
          const qty = items
            .filter((i) => i.productId != null && ids.includes(i.productId))
            .reduce((s, i) => s + i.qty, 0);
          if (qty < minQty) {
            allSatisfied = false;
            break;
          }
        }
        if (allSatisfied) {
          const comboIds = requiredGroups.flatMap((g) => g.productIds || []);
          for (const item of items) {
            if (item.productId == null || !comboIds.includes(item.productId)) continue;
            result[item.lineId] = makeAdj(
              promo,
              (cfg.discountType as string) || 'percent',
              parseFloat(String(cfg.discountValue)) || 0,
            );
          }
        }
      }

      if (Object.keys(result).length) {
        for (const [lineId, adj] of Object.entries(result)) {
          const existing = lineAdjustments[lineId];
          const item = items.find((i) => i.lineId === lineId);
          if (!item) continue;
          const newSav =
            adj.discountType === 'percent'
              ? (item.unitPrice * adj.discountValue) / 100
              : adj.discountValue;
          const exSav = existing
            ? existing.discountType === 'percent'
              ? (item.unitPrice * existing.discountValue) / 100
              : existing.discountValue
            : -1;
          if (newSav > exSav) lineAdjustments[lineId] = adj;
        }
        appliedPromos.push({
          id: promo.id,
          name: promo.name,
          promoType: promo.promoType,
          badgeLabel: promo.badgeLabel,
          badgeColor: promo.badgeColor,
        });
      }
    }

    let totalSaving = 0;
    for (const [lineId, adj] of Object.entries(lineAdjustments)) {
      const item = items.find((i) => i.lineId === lineId);
      if (!item) continue;
      if (adj.discountType === 'percent')
        totalSaving += (item.unitPrice * item.qty * adj.discountValue) / 100;
      else if (adj.discountType === 'amount')
        totalSaving += Math.min(adj.discountValue * item.qty, item.unitPrice * item.qty);
      else if (adj.discountType === 'fixed')
        totalSaving += Math.max(0, item.unitPrice * item.qty - adj.discountValue * item.qty);
    }

    res.json({
      success: true,
      data: { lineAdjustments, totalSaving: round2(totalSaving), appliedPromos },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

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

// Re-export Prisma type alias so consumers that import from this module
// (e.g., tax-rule cleanup scripts) can stay TS-safe.
export type { Prisma };
