/**
 * Resolves a scanned UPC:
 *   1. IndexedDB (offline cache) — ~1ms
 *   2. API (online fallback) — if not in cache
 *   3. Not found — returns null
 *
 * Returns { product, source: 'cache'|'api'|'not_found' }
 */

import { useCallback } from 'react';
import { lookupByUPC, upsertProducts } from '../db/dexie.js';
import { lookupProductByUPC } from '../api/pos.js';
import { useAuthStore } from '../stores/useAuthStore.js';
import { useSyncStore } from '../stores/useSyncStore.js';

export function useProductLookup() {
  const storeId  = useAuthStore(s => s.cashier?.storeId || s.cashier?.stores?.[0]?.storeId);
  const isOnline = useSyncStore(s => s.isOnline);

  const lookup = useCallback(async (upc) => {
    // 1. Try IndexedDB
    const cached = await lookupByUPC(upc, storeId);
    if (cached) return { product: cached, source: 'cache' };

    // 2. API fallback (online only)
    if (isOnline) {
      try {
        const remote = await lookupProductByUPC(upc, storeId);
        if (remote) {
          // Cache it for future scans
          await upsertProducts([{
            ...remote,
            id:           remote.id,
            upc:          remote.upc,
            retailPrice:  Number(remote.defaultRetailPrice || 0),
            storeId:      storeId || null,
            orgId:        remote.orgId,
            updatedAt:    remote.updatedAt || new Date().toISOString(),
          }]);
          return { product: remote, source: 'api' };
        }
      } catch { /* network error — fall through */ }
    }

    return { product: null, source: 'not_found' };
  }, [storeId, isOnline]);

  return { lookup };
}
