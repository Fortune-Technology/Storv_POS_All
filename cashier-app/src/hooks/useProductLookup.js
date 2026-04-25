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

// Session 39 Round 5 — defensive deposit flattener.
// The backend now flattens `depositAmount` server-side (catalogController.js
// flattenDeposit), but if an older backend is still deployed, this ensures
// the cashier cart never silently drops the deposit on a cache-miss scan.
// Mirrors the same priority the backend uses.
const ensureDepositAmount = (p) => {
  if (!p) return p;
  if (p.depositAmount != null) return p;
  const computed =
    p.depositPerUnit != null ? Number(p.depositPerUnit) :
    p.depositRule              ? Number(p.depositRule.depositAmount) * (p.sellUnitSize || 1) :
    null;
  return { ...p, depositAmount: computed };
};

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
    // Session 39 Round 5 — self-heal any cached row that was synced before
    // the backend started flattening depositAmount. Without this, products
    // cached by an older build silently drop the deposit on every scan
    // until the next full re-sync.
    if (cached) return { product: ensureDepositAmount(cached), source: 'cache' };

    // 2. API fallback (online only) — send normalized UPC so the backend
    //    variant-matching logic works on clean input.
    if (isOnline) {
      try {
        const remote = await lookupProductByUPC(upc, storeId);
        if (remote) {
          // Session 39 Round 5 — ensure depositAmount is populated BEFORE
          // we cache the row, so the cart + all future cache hits see it.
          const withDeposit = ensureDepositAmount(remote);
          // Cache with normalized UPC so future scans hit IndexedDB.
          // The search endpoint returns `upcs` as objects ({id, upc, label,
          // isDefault}) — flatten to a normalized string array so the Dexie
          // multi-entry `*upcs` index resolves alternate-barcode lookups.
          const altUpcs = Array.isArray(withDeposit.upcs)
            ? withDeposit.upcs
                .map(u => normalizeUPC(u?.upc || u) || u?.upc || u)
                .filter(v => typeof v === 'string' && v.length > 0)
            : [];
          await upsertProducts([{
            ...withDeposit,
            id:          withDeposit.id,
            upc:         normalizeUPC(withDeposit.upc) || withDeposit.upc,
            upcs:        altUpcs,
            retailPrice: Number(withDeposit.defaultRetailPrice || 0),
            storeId:     storeId || null,
            orgId:       withDeposit.orgId,
            updatedAt:   withDeposit.updatedAt || new Date().toISOString(),
          }]);
          // Apply Product → Department taxClass fallback so the first-scan
          // API path gets the same tax inheritance as the cached-scan path.
          // Subsequent scans hit Dexie and are decorated inside lookupByUPC.
          const decorated = await decorateProductWithDeptTaxClass(withDeposit);
          return { product: decorated, source: 'api' };
        }
      } catch { /* network error — fall through */ }
    }

    return { product: null, source: 'not_found' };
  }, [storeId, isOnline]);

  return { lookup };
}
