/**
 * Redis client re-export for the ecom-backend.
 * Wraps the shared @storv/redis client with ecom-specific helpers.
 *
 * OPTIONAL: All functions return null/no-op when Redis is unavailable.
 */

import { getRedisClient, isRedisAvailable } from '@storv/redis';

const INVENTORY_TTL = 60; // seconds

/**
 * Get cached inventory for a product.
 * Returns { qty, inStock, updatedAt } or null.
 */
export async function getCachedInventory(storeId, posProductId) {
  try {
    const redis = getRedisClient();
    if (!redis || !isRedisAvailable()) return null;
    const raw = await redis.get(`inv:${storeId}:${posProductId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Set cached inventory for a product.
 */
export async function setCachedInventory(storeId, posProductId, data) {
  try {
    const redis = getRedisClient();
    if (!redis || !isRedisAvailable()) return;
    await redis.set(
      `inv:${storeId}:${posProductId}`,
      JSON.stringify({ ...data, updatedAt: new Date().toISOString() }),
      'EX',
      INVENTORY_TTL
    );
  } catch {
    // Silently ignore — cache is optional
  }
}

/**
 * Invalidate cached inventory for a product.
 */
export async function invalidateInventory(storeId, posProductId) {
  try {
    const redis = getRedisClient();
    if (!redis || !isRedisAvailable()) return;
    await redis.del(`inv:${storeId}:${posProductId}`);
  } catch {
    // Silently ignore
  }
}

export { getRedisClient, isRedisAvailable };
