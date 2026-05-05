/**
 * Storefront Pricing Client (F32)
 *
 * Fetches the storefront's pricingConfig + velocity map from POS backend's
 * internal endpoint, with a small in-memory cache so the same config doesn't
 * get re-fetched on every product upsert during a full-catalog sync.
 *
 * Cache TTL: 60 seconds. Long enough to amortize a 7000-product full sync,
 * short enough that admin config changes propagate within a minute. Cache is
 * keyed by storeId.
 *
 * Auth: shared `INTERNAL_API_KEY` env var (must match between POS backend
 * and ecom-backend `.env`). When missing or POS is unreachable, the client
 * returns null — callers should treat this as "no pricing config" and pass
 * raw prices through unchanged (backwards-compatible behaviour).
 */

const POS_URL = process.env.POS_BACKEND_URL || 'http://localhost:5000';
const CACHE_TTL_MS = 60 * 1000;

/** @type {Map<string, { data: any, expiresAt: number }>} */
const cache = new Map();

/**
 * Fetch the storefront pricing config + velocity map for a store.
 * Returns null on failure (missing key, network error, 4xx/5xx).
 *
 * @param {string} storeId
 * @returns {Promise<{
 *   pricingConfig: object,
 *   velocityMap: Record<string, number>,
 *   windowDays: number,
 *   fetchedAt: string,
 * } | null>}
 */
export async function getStorefrontPricing(storeId) {
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!internalKey) {
    if (!getStorefrontPricing._warned) {
      console.warn('[storefrontPricingClient] INTERNAL_API_KEY not set — storefront pricing transform DISABLED. Set INTERNAL_API_KEY in both backend/.env and ecom-backend/.env (must match).');
      getStorefrontPricing._warned = true;
    }
    return null;
  }

  // Cache hit?
  const cached = cache.get(storeId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const url = `${POS_URL.replace(/\/$/, '')}/api/internal/storefront-pricing/${encodeURIComponent(storeId)}`;
    const r = await fetch(url, {
      headers: { 'X-Internal-Api-Key': internalKey, Accept: 'application/json' },
    });
    if (!r.ok) {
      console.warn(`[storefrontPricingClient] POS returned ${r.status} for store ${storeId}`);
      return null;
    }
    const data = await r.json();
    cache.set(storeId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    console.warn(`[storefrontPricingClient] failed to fetch pricing for store ${storeId}:`, err.message);
    return null;
  }
}

/** Clear the cache for a specific store. Called after admin saves config. */
export function invalidateStorefrontPricing(storeId) {
  cache.delete(storeId);
}

/** Clear the whole cache. Useful for tests. */
export function clearStorefrontPricingCache() {
  cache.clear();
}
