/**
 * Platform Adapter Factory
 * -------------------------
 * Central entry point for all delivery-platform adapters.
 *
 * Usage:
 *   import { getPlatformAdapter, PLATFORMS } from '../services/platforms/index.js';
 *   const adapter = getPlatformAdapter('doordash');
 *   const result  = await adapter.testConnection(credentials);
 */

import doordash  from './doordash.js';
import ubereats  from './ubereats.js';
import instacart from './instacart.js';
import grubhub   from './grubhub.js';
import { PLATFORMS, ADAPTER_METHODS } from './adapterInterface.js';
import type { PlatformAdapter } from './adapterInterface.js';

// S71d — Self-hosted storefront. Not a third-party marketplace, so no real
// HTTP push happens here. The actual storefront sync runs through ecom-backend
// (separate service, separate DB) via BullMQ events / direct HTTP fallback.
// This adapter exists only so `getPlatformAdapter('storefront')` doesn't return
// null for code paths that blanket-check adapter existence (e.g. analytics
// loops that iterate all connected platforms).
const storefrontAdapter: PlatformAdapter = {
  testConnection: async () => ({ ok: true, storeName: 'Self-hosted storefront' }),
  syncInventory:  async () => ({ synced: 0, failed: 0, errors: [] }),
  confirmOrder:   async () => ({ confirmed: false, error: 'storefront does not route orders here' }),
  markReady:      async () => ({ success: false, error: 'storefront does not route orders here' }),
  cancelOrder:    async () => ({ cancelled: false, error: 'storefront does not route orders here' }),
  getMenu:        async () => ({ menu: null }),
  updateHours:    async () => ({ updated: false }),
};

const adapters: Record<string, PlatformAdapter> = {
  doordash,
  ubereats,
  instacart,
  grubhub,
  postmates: grubhub,   // Postmates merged into Uber — reuse Grubhub stub for now
  storefront: storefrontAdapter,
};

/**
 * Return the adapter for a given platform key, or null if unsupported.
 */
export function getPlatformAdapter(platform: string | null | undefined): PlatformAdapter | null {
  if (!platform) return null;
  return adapters[platform] || null;
}

/**
 * Convenience: list every platform that has a registered adapter.
 */
export function listSupportedPlatforms(): string[] {
  return Object.keys(adapters);
}

export { PLATFORMS, ADAPTER_METHODS };
export type {
  PlatformAdapter,
  PlatformCredentials,
  PlatformCatalogEntry,
  AdapterMethodName,
  TestConnectionResult,
  SyncInventoryResult,
  ConfirmOrderResult,
  MarkReadyResult,
  CancelOrderResult,
  GetMenuResult,
  UpdateHoursResult,
  InventoryItemInput,
  PlatformHours,
  PlatformMenu,
} from './adapterInterface.js';
