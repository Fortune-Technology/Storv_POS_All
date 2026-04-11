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
];

/**
 * Registry of supported delivery platforms.
 * `credentialFields` lists the keys required inside StoreIntegration.credentials JSON.
 */
export const PLATFORMS = {
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
};
