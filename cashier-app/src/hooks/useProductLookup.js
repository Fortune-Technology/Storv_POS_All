/**
 * Resolves a scanned UPC:
 *   1. IndexedDB (offline cache) — ~1ms
 *   2. API (online fallback) — if not in cache
 *   3. Not found — returns null
 *
 * Returns { product, source: 'cache'|'api'|'not_found' }
 */

import { useCallback } from 'react';
import { lookupByUPC, upsertProducts, decorateProductWithDeptTaxClass } from '../db/dexie.js';
import { lookupProductByUPC } from '../api/pos.js';
import { useAuthStore } from '../stores/useAuthStore.js';
import { useSyncStore } from '../stores/useSyncStore.js';
import { normalizeUPC } from '../utils/upc.js';

export function useProductLookup() {
  const storeId  = useAuthStore(s => s.cashier?.storeId || s.cashier?.stores?.[0]?.storeId);
  const isOnline = useSyncStore(s => s.isOnline);

  const lookup = useCallback(async (rawUpc) => {
    // Normalize at entry — strips spaces/dashes, pads to EAN-13.
    // This means "0 80686 00637 4" and "0080686006374" both become
    // the same key before touching IndexedDB or the API.
    const upc = normalizeUPC(rawUpc) || rawUpc;

    // 1. Try IndexedDB (handles format variants internally)
    const cached = await lookupByUPC(upc, storeId);
    if (cached) return { product: cached, source: 'cache' };

    // 2. API fallback (online only) — send normalized UPC so the backend
    //    variant-matching logic works on clean input.
    if (isOnline) {
      try {
        const remote = await lookupProductByUPC(upc, storeId);
        if (remote) {
          // Cache with normalized UPC so future scans hit IndexedDB
          await upsertProducts([{
            ...remote,
            id:          remote.id,
            upc:         normalizeUPC(remote.upc) || remote.upc,
            retailPrice: Number(remote.defaultRetailPrice || 0),
            storeId:     storeId || null,
            orgId:       remote.orgId,
            updatedAt:   remote.updatedAt || new Date().toISOString(),
          }]);
          // Apply Product → Department taxClass fallback so the first-scan
          // API path gets the same tax inheritance as the cached-scan path.
          // Subsequent scans hit Dexie and are decorated inside lookupByUPC.
          const decorated = await decorateProductWithDeptTaxClass(remote);
          return { product: decorated, source: 'api' };
        }
      } catch { /* network error — fall through */ }
    }

    return { product: null, source: 'not_found' };
  }, [storeId, isOnline]);

  return { lookup };
}
