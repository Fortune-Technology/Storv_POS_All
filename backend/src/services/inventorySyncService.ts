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

// ── Domain shapes ──────────────────────────────────────────

interface MasterProductSlim {
  id: number;
  departmentId: number | null;
  weeklyVelocity: number | null;
  defaultRetailPrice: Prisma.Decimal | number | string | null;
  status: string | null;
}

interface StoreProductForSync {
  quantityOnHand?: number | null;
  retailPrice?: Prisma.Decimal | number | string | null;
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
 */
function effectivePrice(storeProduct: StoreProductForSync): number {
  const now = new Date();
  // Active sale price takes priority
  if (
    storeProduct.salePrice != null &&
    storeProduct.saleStart && storeProduct.saleEnd &&
    now >= storeProduct.saleStart && now <= storeProduct.saleEnd
  ) {
    return Number(storeProduct.salePrice);
  }
  return Number(
    storeProduct.retailPrice
    ?? storeProduct.masterProduct?.defaultRetailPrice
    ?? 0,
  );
}

/**
 * Map a StoreProduct row into the platform-agnostic item shape used by adapters.
 */
function mapToPlatformItem(
  sp: StoreProductForSync,
  inventoryConfig: InventoryConfig,
): PlatformItem {
  const smartQoH = calculateSmartQoH(sp, inventoryConfig);
  return {
    merchant_supplied_id: String(sp.masterProduct.id),
    base_price:           Math.round(effectivePrice(sp) * 100),  // cents
    status:               smartQoH > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
  };
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

  // 2. Load all active products with store-level stock
  type StoreProductRow = Prisma.StoreProductGetPayload<{
    include: {
      masterProduct: {
        select: {
          id: true; departmentId: true; weeklyVelocity: true;
          defaultRetailPrice: true; status: true;
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
          weeklyVelocity: true,
          defaultRetailPrice: true,
          status: true,
        },
      },
    },
  });

  // Filter out discontinued master products
  const activeProducts = storeProducts.filter(
    (sp) => sp.masterProduct.status !== 'discontinued',
  );

  if (activeProducts.length === 0) {
    return { synced: 0, failed: 0, errors: [] };
  }

  // 3. Map to platform format with smart QoH
  const inventoryConfig: InventoryConfig =
    (integration.inventoryConfig as unknown as InventoryConfig) ?? {};
  const items = activeProducts.map((sp) =>
    mapToPlatformItem(sp as unknown as StoreProductForSync, inventoryConfig),
  );

  // 4. Push to platform
  const result = await adapter.syncInventory(integration.credentials, items);

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
          weeklyVelocity: true,
          defaultRetailPrice: true,
          status: true,
        },
      },
    },
  });

  if (!sp || sp.masterProduct.status === 'discontinued') {
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

    const inventoryConfig: InventoryConfig =
      (integration.inventoryConfig as unknown as InventoryConfig) ?? {};
    const item = mapToPlatformItem(sp as unknown as StoreProductForSync, inventoryConfig);

    try {
      results[integration.platform] = await adapter.syncInventory(
        integration.credentials,
        [item],
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
