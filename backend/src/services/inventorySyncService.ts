/**
 * Inventory Sync Service
 * -----------------------
 * Pushes product availability and pricing to connected delivery platforms.
 *
 * Supports two modes:
 *   - Full push  (pushInventory)   — syncs every active product for a store/platform
 *   - Item push  (pushItemUpdate)  — syncs a single product across all active integrations
 *
 * "Smart QoH" logic translates internal stock numbers into platform-friendly
 * availability statuses, respecting per-department velocity overrides and the
 * store-level inventory management flag.
 */

import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { getPlatformAdapter } from './platforms/index.js';
import {
  computeMarketplacePrice,
  normalizeConfig,
  type MarketplacePricingConfig,
} from './marketplaceMarkup.js';

// ── Domain shapes ──────────────────────────────────────────

interface MasterProductSlim {
  id: number;
  name?: string;
  departmentId: number | null;
  // S71b — `weeklyVelocity` and `status` were removed from MasterProduct in an
  // earlier schema refactor but the old service code still referenced them.
  // We let calculateSmartQoH default to actual-stock mode (where: active=true
  // already filters out discontinued).
  weeklyVelocity?: number | null;
  defaultRetailPrice: Prisma.Decimal | number | string | null;
  defaultCostPrice?: Prisma.Decimal | number | string | null;
  status?: string | null;
}

interface StoreProductForSync {
  quantityOnHand?: number | null;
  retailPrice?: Prisma.Decimal | number | string | null;
  costPrice?: Prisma.Decimal | number | string | null;
  salePrice?: Prisma.Decimal | number | string | null;
  saleStart?: Date | null;
  saleEnd?: Date | null;
  masterProduct: MasterProductSlim;
}

interface DepartmentConfig {
  velocityMultiplier?: number | null;
  fixedQoH?: number | null;
}

export interface InventoryConfig {
  defaultBehavior?: 'track' | 'estimate' | string;
  departments?: Record<string, DepartmentConfig>;
}

export interface PlatformItem {
  merchant_supplied_id: string;
  base_price: number;
  status: 'AVAILABLE' | 'OUT_OF_STOCK';
}

export interface PlatformSyncResult {
  synced: number;
  failed: number;
  errors: string[];
  /** S71 — per-marketplace skip stats for analytics + drawer feedback. */
  skipped?: {
    excludedProduct:    number;
    excludedDepartment: number;
    syncModeFilter:     number;
    marginTooThin:      number;
    invalidPrice:       number;
    total:              number;
  };
}

interface PlatformAdapter {
  syncInventory(credentials: unknown, items: PlatformItem[]): Promise<PlatformSyncResult>;
}

// ── Smart Quantity-on-Hand ─────────────────────────────────

/**
 * Determine the effective quantity-on-hand for a product based on the
 * integration's inventory configuration.
 *
 * Priority:
 *   1. If the store does not manage inventory (`defaultBehavior === 'estimate'`),
 *      estimate availability from the product's weekly velocity.
 *   2. If the product's department has an explicit override in `inventoryConfig.departments`,
 *      use that department's velocity multiplier.
 *   3. Otherwise, return the raw `quantityOnHand` from StoreProduct.
 *
 * Returns the effective QoH (floored to 0 minimum).
 */
export function calculateSmartQoH(
  product: StoreProductForSync,
  inventoryConfig: InventoryConfig = {},
): number {
  const qoh = Number(product.quantityOnHand ?? 0);
  const { defaultBehavior, departments } = inventoryConfig;

  // Mode 1: store doesn't track inventory — estimate from velocity
  if (defaultBehavior === 'estimate') {
    const velocity = Number(product.masterProduct?.weeklyVelocity ?? 0);
    // Assume ~2 days of stock as a rough availability signal
    return Math.max(0, Math.round(velocity * (2 / 7)));
  }

  // Mode 2: department-level velocity override
  const deptId = String(product.masterProduct?.departmentId ?? '');
  if (deptId && departments?.[deptId]) {
    const deptConfig = departments[deptId];
    if (deptConfig.velocityMultiplier != null) {
      const velocity = Number(product.masterProduct?.weeklyVelocity ?? 0);
      return Math.max(0, Math.round(velocity * deptConfig.velocityMultiplier));
    }
    if (deptConfig.fixedQoH != null) {
      return Math.max(0, Number(deptConfig.fixedQoH));
    }
  }

  // Mode 3: use actual stock
  return Math.max(0, qoh);
}

// ── Internal helpers ───────────────────────────────────────

/**
 * Resolve the effective retail price for a product at a given store.
 * StoreProduct override wins, then falls back to MasterProduct default.
 *
 * Active sale price takes priority. This is the in-store price BEFORE any
 * marketplace markup — caller passes this into computeMarketplacePrice().
 */
function effectivePrice(storeProduct: StoreProductForSync): { price: number; hasActivePromo: boolean } {
  const now = new Date();
  // Active sale price takes priority
  if (
    storeProduct.salePrice != null &&
    storeProduct.saleStart && storeProduct.saleEnd &&
    now >= storeProduct.saleStart && now <= storeProduct.saleEnd
  ) {
    return { price: Number(storeProduct.salePrice), hasActivePromo: true };
  }
  return {
    price: Number(
      storeProduct.retailPrice
      ?? storeProduct.masterProduct?.defaultRetailPrice
      ?? 0,
    ),
    hasActivePromo: false,
  };
}

/** Resolve effective cost price for the margin guard (StoreProduct override → MasterProduct default). */
function effectiveCost(storeProduct: StoreProductForSync): number | null {
  const c = storeProduct.costPrice ?? storeProduct.masterProduct?.defaultCostPrice;
  if (c == null) return null;
  const n = Number(c);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Map a StoreProduct row into the platform-agnostic item shape used by adapters.
 *
 * Returns `{ item, skipReason }` — exactly one will be set. Caller drops items
 * with skipReason from the push and aggregates the reasons for reporting.
 */
function mapToPlatformItem(
  sp: StoreProductForSync,
  inventoryConfig: InventoryConfig,
  pricingConfig: MarketplacePricingConfig,
): { item: PlatformItem | null; skipReason: string | null } {
  const { price: basePrice, hasActivePromo } = effectivePrice(sp);
  const smartQoH = calculateSmartQoH(sp, inventoryConfig);

  const result = computeMarketplacePrice({
    basePrice,
    costPrice:       effectiveCost(sp),
    departmentId:    sp.masterProduct?.departmentId ?? null,
    productId:       sp.masterProduct?.id,
    hasActivePromo,
    quantityOnHand:  smartQoH,
    config:          pricingConfig,
  });

  if (result.skipped || result.price == null) {
    return { item: null, skipReason: result.skipReason || 'invalid_base_price' };
  }

  return {
    item: {
      merchant_supplied_id: String(sp.masterProduct.id),
      base_price:           Math.round(result.price * 100),  // cents
      status:               smartQoH > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
    },
    skipReason: null,
  };
}

/** Build a fresh skip-stats accumulator. */
function newSkipStats() {
  return {
    excludedProduct:    0,
    excludedDepartment: 0,
    syncModeFilter:     0,
    marginTooThin:      0,
    invalidPrice:       0,
    total:              0,
  };
}

/** Bump the right counter for a `computeMarketplacePrice` skipReason. */
function tallySkip(stats: ReturnType<typeof newSkipStats>, reason: string): void {
  stats.total++;
  switch (reason) {
    case 'excluded_product':    stats.excludedProduct++;    return;
    case 'excluded_department': stats.excludedDepartment++; return;
    case 'sync_mode_filter':    stats.syncModeFilter++;     return;
    case 'margin_too_thin':     stats.marginTooThin++;      return;
    case 'invalid_base_price':
    default:                    stats.invalidPrice++;       return;
  }
}

// ── Full inventory push ────────────────────────────────────

/**
 * Push the complete product catalog for a store to a single delivery platform.
 *
 * `platform`: "doordash" | "ubereats" | ...
 */
export async function pushInventory(
  orgId: string,
  storeId: string,
  platform: string,
): Promise<PlatformSyncResult> {
  // 1. Load integration credentials + config
  const integration = await prisma.storeIntegration.findUnique({
    where: { storeId_platform: { storeId, platform } },
  });

  if (!integration || integration.status !== 'active') {
    return { synced: 0, failed: 0, errors: [`No active ${platform} integration for store ${storeId}`] };
  }

  const adapter = getPlatformAdapter(platform) as PlatformAdapter | null;
  if (!adapter) {
    return { synced: 0, failed: 0, errors: [`Unsupported platform: ${platform}`] };
  }

  // S71 — master inventory-sync toggle. When the marketplace's pricingConfig
  // says inventorySyncEnabled = false, skip the inventory push entirely so
  // the marketplace can keep showing "out of stock" while the menu/orders
  // sync still works.
  const pricingConfig = normalizeConfig(
    (integration.pricingConfig as unknown as MarketplacePricingConfig) ?? {},
  );
  if (!pricingConfig.inventorySyncEnabled) {
    return { synced: 0, failed: 0, errors: [] };
  }

  // 2. Load all active products with store-level stock
  type StoreProductRow = Prisma.StoreProductGetPayload<{
    include: {
      masterProduct: {
        select: {
          id: true; departmentId: true;
          defaultRetailPrice: true; defaultCostPrice: true;
        };
      };
    };
  }>;
  const storeProducts: StoreProductRow[] = await prisma.storeProduct.findMany({
    where: { orgId, storeId, active: true },
    include: {
      masterProduct: {
        select: {
          id: true,
          departmentId: true,
          defaultRetailPrice: true,
          defaultCostPrice: true,
        },
      },
    },
  });

  // S71b — discontinued filtering removed (status field gone from MasterProduct
  // schema). The where: { active: true } on StoreProduct already filters out
  // inactive store products.
  const activeProducts = storeProducts;

  if (activeProducts.length === 0) {
    return { synced: 0, failed: 0, errors: [] };
  }

  // 3. Map to platform format with smart QoH + pricingConfig (markup, rounding,
  // exclusions, sync mode, margin guard). Aggregate skip reasons so the caller
  // can surface them in the sync result toast.
  const inventoryConfig: InventoryConfig =
    (integration.inventoryConfig as unknown as InventoryConfig) ?? {};
  const skipped = newSkipStats();
  const items: PlatformItem[] = [];
  for (const sp of activeProducts) {
    const mapped = mapToPlatformItem(sp as unknown as StoreProductForSync, inventoryConfig, pricingConfig);
    if (mapped.item) items.push(mapped.item);
    else if (mapped.skipReason) tallySkip(skipped, mapped.skipReason);
  }

  if (items.length === 0) {
    // Every product was filtered out — nothing to push, but not an error
    return { synced: 0, failed: 0, errors: [], skipped };
  }

  // 4. Push to platform
  const result = await adapter.syncInventory(integration.credentials, items);
  // Bolt skip stats onto the adapter's result so callers see the full picture
  result.skipped = skipped;

  // 5. Update lastSyncAt (fire-and-forget)
  prisma.storeIntegration.update({
    where: { id: integration.id },
    data: {
      lastSyncAt: new Date(),
      lastError:  result.errors.length > 0 ? result.errors.join('; ') : null,
    },
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[inventorySyncService] failed to update lastSyncAt:', message);
  });

  return result;
}

// ── Single-item push ───────────────────────────────────────

/**
 * Push a single product update to every active platform integration for a store.
 * Designed to be called from catalog update hooks / webhooks.
 *
 * `productId`: MasterProduct.id
 */
export async function pushItemUpdate(
  orgId: string,
  storeId: string,
  productId: number,
): Promise<{ results: Record<string, PlatformSyncResult> }> {
  // Load the specific store product
  const sp = await prisma.storeProduct.findFirst({
    where: { orgId, storeId, masterProductId: productId, active: true },
    include: {
      masterProduct: {
        select: {
          id: true,
          departmentId: true,
          defaultRetailPrice: true,
          defaultCostPrice: true,
        },
      },
    },
  });

  if (!sp) {
    return { results: {} };
  }

  // Find every active integration for this store
  const integrations = await prisma.storeIntegration.findMany({
    where: { orgId, storeId, status: 'active' },
  });

  const results: Record<string, PlatformSyncResult> = {};

  for (const integration of integrations) {
    const adapter = getPlatformAdapter(integration.platform) as PlatformAdapter | null;
    if (!adapter) continue;

    // S71 — per-marketplace toggle + pricing rules
    const pricingConfig = normalizeConfig(
      (integration.pricingConfig as unknown as MarketplacePricingConfig) ?? {},
    );
    if (!pricingConfig.inventorySyncEnabled) {
      results[integration.platform] = { synced: 0, failed: 0, errors: [] };
      continue;
    }

    const inventoryConfig: InventoryConfig =
      (integration.inventoryConfig as unknown as InventoryConfig) ?? {};
    const mapped = mapToPlatformItem(
      sp as unknown as StoreProductForSync,
      inventoryConfig,
      pricingConfig,
    );

    if (!mapped.item) {
      // Filtered by pricingConfig (excluded / sync-mode / margin) — skip this platform
      const skipped = newSkipStats();
      if (mapped.skipReason) tallySkip(skipped, mapped.skipReason);
      results[integration.platform] = { synced: 0, failed: 0, errors: [], skipped };
      continue;
    }

    try {
      results[integration.platform] = await adapter.syncInventory(
        integration.credentials,
        [mapped.item],
      );

      // Update sync timestamp (fire-and-forget)
      prisma.storeIntegration.update({
        where: { id: integration.id },
        data: { lastSyncAt: new Date() },
      }).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results[integration.platform] = {
        synced: 0,
        failed: 1,
        errors: [message],
      };
    }
  }

  return { results };
}

// ── Preview impact (dry-run, no push) ───────────────────────

export interface PreviewImpactResult {
  totalActive:    number;
  wouldSync:      number;
  skipped:        ReturnType<typeof newSkipStats>;
  /** Sample of marked-up prices vs base — first 5 products that would sync. */
  sampleItems: Array<{
    productId:    number;
    name?:        string;
    basePrice:    number;
    marketPrice:  number;
    delta:        number;
    deltaPct:     number;
  }>;
}

/**
 * Dry-run the pricing pipeline against all of a store's products without
 * pushing anything. Used by the drawer's "Preview impact" button so the user
 * can see exactly how many products would sync + how many would be skipped
 * (and why) BEFORE saving config.
 *
 * Accepts an optional `overrideConfig` so the caller can preview a hypothetical
 * pricingConfig without persisting it first. Falls back to the stored config
 * when omitted.
 */
export async function previewMarketplaceImpact(
  orgId: string,
  storeId: string,
  platform: string,
  overrideConfig?: MarketplacePricingConfig,
): Promise<PreviewImpactResult> {
  const integration = await prisma.storeIntegration.findUnique({
    where: { storeId_platform: { storeId, platform } },
  });
  if (!integration) {
    return { totalActive: 0, wouldSync: 0, skipped: newSkipStats(), sampleItems: [] };
  }

  // Use override if supplied, otherwise read stored config
  const pricingConfig = normalizeConfig(
    overrideConfig
      ?? (integration.pricingConfig as unknown as MarketplacePricingConfig)
      ?? {},
  );

  const inventoryConfig: InventoryConfig =
    (integration.inventoryConfig as unknown as InventoryConfig) ?? {};

  type PreviewRow = Prisma.StoreProductGetPayload<{
    include: {
      masterProduct: {
        select: {
          id: true; name: true; departmentId: true;
          defaultRetailPrice: true; defaultCostPrice: true;
        };
      };
    };
  }>;

  const products: PreviewRow[] = await prisma.storeProduct.findMany({
    where: { orgId, storeId, active: true },
    include: {
      masterProduct: {
        select: {
          id: true, name: true, departmentId: true,
          defaultRetailPrice: true, defaultCostPrice: true,
        },
      },
    },
  });

  // S71b — discontinued filter no-op (status field no longer on schema)
  const active = products;
  const skipped = newSkipStats();
  const sample: PreviewImpactResult['sampleItems'] = [];

  for (const sp of active) {
    const { price: basePrice, hasActivePromo } = effectivePrice(sp as unknown as StoreProductForSync);
    const smartQoH = calculateSmartQoH(sp as unknown as StoreProductForSync, inventoryConfig);
    const result = computeMarketplacePrice({
      basePrice,
      costPrice:       effectiveCost(sp as unknown as StoreProductForSync),
      departmentId:    sp.masterProduct?.departmentId ?? null,
      productId:       sp.masterProduct?.id,
      hasActivePromo,
      quantityOnHand:  smartQoH,
      config:          pricingConfig,
    });

    if (result.skipped) {
      tallySkip(skipped, result.skipReason || 'invalid_base_price');
    } else if (result.price != null && sample.length < 5) {
      const delta = result.price - basePrice;
      sample.push({
        productId:   sp.masterProduct.id,
        name:        sp.masterProduct.name || undefined,
        basePrice:   Math.round(basePrice * 100) / 100,
        marketPrice: result.price,
        delta:       Math.round(delta * 100) / 100,
        deltaPct:    basePrice > 0 ? Math.round((delta / basePrice) * 1000) / 10 : 0,
      });
    }
  }

  return {
    totalActive: active.length,
    wouldSync:   active.length - skipped.total,
    skipped,
    sampleItems: sample,
  };
}
