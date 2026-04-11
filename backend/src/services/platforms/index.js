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

const adapters = {
  doordash,
  ubereats,
  instacart,
  grubhub,
  postmates: grubhub,   // Postmates merged into Uber — reuse Grubhub stub for now
};

/**
 * Return the adapter for a given platform key, or null if unsupported.
 *
 * @param {string} platform — one of the keys in PLATFORMS
 * @returns {object|null}
 */
export function getPlatformAdapter(platform) {
  return adapters[platform] || null;
}

/**
 * Convenience: list every platform that has a registered adapter.
 */
export function listSupportedPlatforms() {
  return Object.keys(adapters);
}

export { PLATFORMS, ADAPTER_METHODS };
