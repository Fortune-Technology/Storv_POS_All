/**
 * Shared utilities for the Catalog controller modules.
 * Split from `catalogController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Exports:
 *   - Tenant helpers: getOrgId, getStoreId
 *   - Price coercer: toPrice
 *   - E-commerce sync emitters (lazy-imported BullMQ producers — no-op when
 *     `@storeveu/queue` isn't installed)
 *   - UPC uniqueness: findUpcConflict, assertUpcUnique, UpcConflict type
 *   - Mutation bumper: touchMasterProduct
 *   - Deposit normalisation: flattenDeposit, DepositSource
 *   - Pagination: paginationParams
 *   - Permissive Prisma row shapes: ProductRowLite, TaxRuleRow, ProductUpcRow,
 *     ProductPackSizeRow, CashPayoutRow, ProductMappingRow, PromotionRow
 *   - Promo cart shapes: PromoLineItem, PromoAdjustment
 *   - Catalog-specific status error: CatalogStatusError
 */

import type { Request } from 'express';
import prisma from '../../config/postgres.js';
import { parsePrice } from '../../utils/validators.js';
import { errMsg, type StatusError } from '../../utils/typeHelpers.js';

// ── Augmented Error (catalog-specific: adds `conflict` surface) ────────────
// Extends the shared StatusError so generic helpers (errCode, errStatus)
// keep working; UPC-conflict throw paths use this richer shape so the
// downstream handler can read `err.conflict` and produce a 409 with the
// conflicting product details.
export type CatalogStatusError = StatusError & {
  conflict?: UpcConflict | null;
};

// ── Safe price coercer ─────────────────────────────────────────────────────
// Wrap parsePrice so controllers can one-line the transform.
// Returns parsed value or null. Throws a 400-formatted Error on invalid input
// (caught by the controller try/catch — do not swallow silently).
export function toPrice(value: unknown, field: string): number | null {
  const r = parsePrice(value, { min: 0, max: 9999999, allowNull: true });
  if (!r.ok) {
    const e = new Error(`${field}: ${r.error}`) as CatalogStatusError;
    e.status = 400;
    throw e;
  }
  return r.value as number | null;
}

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

export let emitProductSync: EmitProductSync = async () => {};
export let emitDepartmentSync: EmitDepartmentSync = async () => {};
export let emitInventorySync: EmitInventorySync = async () => {};
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
// Tenant helpers
// ─────────────────────────────────────────────────

export const getOrgId = (req: Request): string | undefined =>
  req.tenantId || req.user?.orgId || undefined;
export const getStoreId = (req: Request): string | undefined => req.storeId || undefined;

// ── Permissive prisma row shapes (the same workaround as lottery + posTerminal:
// `prisma` resolves to `any` from the JS postgres.js wrapper, so callbacks
// see implicit-any unless we cast each findMany result).
export type ProductRowLite = {
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

export type TaxRuleRow = {
  id: number;
  name: string;
  rate: number | string;
  departmentIds: number[];
};

export type ProductUpcRow = {
  masterProductId: number;
  upc: string;
  label?: string | null;
};

export type ProductPackSizeRow = {
  masterProductId: number;
  label?: string | null;
  unitCount?: number | null;
  retailPrice?: number | string | null;
  isDefault?: boolean;
  sortOrder?: number | null;
};

export type CashPayoutRow = {
  amount: number | string | null;
  createdAt: Date;
  payoutType?: string | null;
};

export type ProductMappingRow = {
  id: number;
  isPrimary: boolean;
  vendorItemCode?: string | null;
  lastReceivedAt?: Date | null;
  createdAt?: Date;
};

export type PromotionRow = {
  id: number;
  name: string;
  promoType: string;
  productIds: number[];
  departmentIds: number[];
  dealConfig: Record<string, unknown> | null;
  badgeLabel?: string | null;
  badgeColor?: string | null;
};

export interface PromoLineItem {
  lineId: string;
  productId?: number;
  departmentId?: number;
  qty: number;
  unitPrice: number;
  discountEligible?: boolean;
}

export interface PromoAdjustment {
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
export interface UpcConflict {
  source: 'master' | 'productUpc';
  conflictingProductId: number;
  conflictingProductName: string;
  upc: string | null;
}

export async function findUpcConflict(
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
export async function assertUpcUnique(
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
export async function touchMasterProduct(
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
export type DepositSource = {
  depositPerUnit?: number | string | null;
  depositRule?: { depositAmount: number | string } | null;
  sellUnitSize?: number | null;
  [k: string]: unknown;
};
export const flattenDeposit = <T extends DepositSource | null | undefined>(p: T): T => {
  if (!p) return p;
  const depositAmount =
    p.depositPerUnit != null
      ? Number(p.depositPerUnit)
      : p.depositRule
        ? Number(p.depositRule.depositAmount) * (p.sellUnitSize || 1)
        : null;
  return { ...p, depositAmount } as T;
};

export const paginationParams = (
  query: Record<string, unknown>,
): { skip: number; take: number; page: number; limit: number } => {
  const page = Math.max(1, parseInt(String(query.page)) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(String(query.limit)) || 50));
  return { skip: (page - 1) * limit, take: limit, page, limit };
};
