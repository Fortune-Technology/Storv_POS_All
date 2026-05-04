/**
 * Platform Adapter Interface
 * ---------------------------
 * Every delivery platform adapter must implement these methods.
 * The factory in index.js validates adapters against this list at import time.
 *
 * Each method receives platform-specific `credentials` (from StoreIntegration.credentials)
 * as its first argument.  Return shapes are documented inline.
 */

export const ADAPTER_METHODS = [
  'testConnection',    // (credentials) => { ok: boolean, storeName?: string, error?: string }
  'syncInventory',     // (credentials, items) => { synced: number, failed: number, errors: string[] }
  'confirmOrder',      // (credentials, orderId, data) => { confirmed: boolean, error?: string }
  'markReady',         // (credentials, orderId) => { success: boolean, error?: string }
  'cancelOrder',       // (credentials, orderId, reason) => { cancelled: boolean, error?: string }
  'getMenu',           // (credentials) => { menu: object|null, error?: string }
  'updateHours',       // (credentials, hours) => { updated: boolean, error?: string }
] as const;

export type AdapterMethodName = (typeof ADAPTER_METHODS)[number];

/** Loose credential bag — each platform interprets its own keys. */
export type PlatformCredentials = Record<string, unknown>;

export interface InventoryItemInput {
  sku?: string;
  upc?: string;
  name?: string;
  price?: number;
  quantityOnHand?: number;
  available?: boolean;
  [extra: string]: unknown;
}

export interface PlatformHours {
  [day: string]: { open: string; close: string } | { closed: true } | undefined;
}

/** Platform menu shape — opaque to the factory; each adapter typed internally. */
export type PlatformMenu = Record<string, unknown>;

// ── Standard return shapes ───────────────────────────────────────────────

export interface TestConnectionResult {
  ok: boolean;
  storeName?: string;
  error?: string;
  [extra: string]: unknown;
}

export interface SyncInventoryResult {
  synced: number;
  failed: number;
  errors: string[];
}

export interface ConfirmOrderResult {
  confirmed: boolean;
  error?: string;
}

export interface MarkReadyResult {
  success: boolean;
  error?: string;
}

export interface CancelOrderResult {
  cancelled: boolean;
  error?: string;
}

export interface GetMenuResult {
  menu: PlatformMenu | null;
  error?: string;
}

export interface UpdateHoursResult {
  updated: boolean;
  error?: string;
}

/**
 * The contract every concrete adapter implements. Each method receives
 * platform-specific `credentials` as its first arg.
 */
export interface PlatformAdapter {
  testConnection(credentials: PlatformCredentials): Promise<TestConnectionResult>;
  syncInventory(credentials: PlatformCredentials, items: InventoryItemInput[]): Promise<SyncInventoryResult>;
  confirmOrder(credentials: PlatformCredentials, orderId: string, data?: unknown): Promise<ConfirmOrderResult>;
  markReady(credentials: PlatformCredentials, orderId: string): Promise<MarkReadyResult>;
  cancelOrder(credentials: PlatformCredentials, orderId: string, reason?: string): Promise<CancelOrderResult>;
  getMenu(credentials: PlatformCredentials): Promise<GetMenuResult>;
  updateHours(credentials: PlatformCredentials, hours: PlatformHours): Promise<UpdateHoursResult>;
}

export interface PlatformCatalogEntry {
  name: string;
  color: string;
  logo: string;
  credentialFields: string[];
  status: 'live' | 'coming_soon';
  note?: string;
}

/**
 * Registry of supported delivery platforms.
 * `credentialFields` lists the keys required inside StoreIntegration.credentials JSON.
 */
export const PLATFORMS: Record<string, PlatformCatalogEntry> = {
  doordash: {
    name: 'DoorDash',
    color: '#FF3008',
    logo: '🔴',
    credentialFields: ['developerId', 'keyId', 'signingSecret', 'storeLocationId'],
    status: 'live',
  },
  ubereats: {
    name: 'Uber Eats',
    color: '#06C167',
    logo: '🟢',
    credentialFields: ['clientId', 'clientSecret', 'restaurantId'],
    status: 'live',
  },
  instacart: {
    name: 'Instacart',
    color: '#43B02A',
    logo: '🟢',
    credentialFields: ['clientId', 'clientSecret', 'baseUrl', 'storeLocationId'],
    status: 'live',
  },
  grubhub: {
    name: 'Grubhub',
    color: '#F63440',
    logo: '🔴',
    credentialFields: [],
    status: 'coming_soon',
  },
  gopuff: {
    name: 'Gopuff',
    color: '#00A4FF',
    logo: '🔵',
    credentialFields: [],
    status: 'coming_soon',
  },
  postmates: {
    name: 'Postmates',
    color: '#000000',
    logo: '⚫',
    credentialFields: [],
    status: 'coming_soon',
    note: 'Merged into Uber Eats — use Uber Eats integration',
  },
  // S71d — Self-hosted storefront. Not a third-party marketplace, so no creds.
  // Lives here to reuse the per-marketplace StoreIntegration.pricingConfig
  // schema, validation, and drawer UI. Settings managed in EcomSetup, NOT in
  // the IntegrationHub Connections tab. The adapter is a no-op (the actual
  // sync flows through ecom-backend's separate pipeline, not via syncInventory).
  storefront: {
    name: 'Custom Storefront',
    color: '#3d56b5',
    logo: '🏪',
    credentialFields: [],
    status: 'live',
    note: 'Settings managed in eCommerce Setup → Pricing tab',
  },
};
