/**
 * Seeds and incrementally updates the IndexedDB product cache.
 * Called once on login, then every 15 minutes while the app is open.
 *
 * Returns { manualSync } so callers can trigger a forced full refresh.
 * Tracks syncing state in useSyncStore (catalogSyncing / catalogSyncedAt).
 */

import { useCallback, useEffect, useRef } from 'react';
import { getCatalogSnapshot, getDepositRules, getTaxRules } from '../api/pos.js';
import { db, getLastSync, setLastSync, upsertProducts } from '../db/dexie.js';
import { useAuthStore } from '../stores/useAuthStore.js';
import { useSyncStore } from '../stores/useSyncStore.js';

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 min

export function useCatalogSync() {
  const cashier           = useAuthStore(s => s.cashier);
  const isOnline          = useSyncStore(s => s.isOnline);
  const setCatalogSyncing = useSyncStore(s => s.setCatalogSyncing);
  const setCatalogSyncedAt= useSyncStore(s => s.setCatalogSyncedAt);
  const runRef            = useRef(false);

  const storeId = cashier?.storeId || cashier?.stores?.[0]?.storeId;

  const sync = useCallback(async (force = false) => {
    if (!isOnline || !storeId) return;
    if (runRef.current) return;
    runRef.current = true;
    setCatalogSyncing(true);

    try {
      const since = force ? null : await getLastSync('productsLastSync');

      // Paginate through all products
      let page = 1, total = Infinity;
      while ((page - 1) * 500 < total) {
        const res = await getCatalogSnapshot(storeId, since, page);
        total = res.total;
        if (res.data?.length) await upsertProducts(res.data);
        if (res.page >= res.pages) break;
        page++;
      }

      // Sync deposit and tax rules
      const [deposits, taxes] = await Promise.all([getDepositRules(), getTaxRules()]);
      if (deposits?.length) await db.depositRules.bulkPut(deposits);
      if (taxes?.length)    await db.taxRules.bulkPut(taxes);

      const now = new Date().toISOString();
      await setLastSync('productsLastSync', now);
      setCatalogSyncedAt(now);
    } catch (err) {
      console.warn('Catalog sync failed:', err.message);
    } finally {
      runRef.current = false;
      setCatalogSyncing(false);
    }
  }, [isOnline, storeId, setCatalogSyncing, setCatalogSyncedAt]);

  // Sync on login + every 15 min
  useEffect(() => {
    if (!cashier) return;
    sync();
    const id = setInterval(sync, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [cashier, sync]);

  // manualSync: force full re-download, exposed to UI
  const manualSync = useCallback(() => sync(true), [sync]);

  return { manualSync };
}
