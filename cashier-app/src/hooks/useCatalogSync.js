/**
 * Seeds and incrementally updates the IndexedDB product cache.
 * Called once on login, then every 15 minutes while the app is open.
 *
 * Returns { manualSync } so callers can trigger a forced full refresh.
 * Tracks syncing state in useSyncStore (catalogSyncing / catalogSyncedAt).
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  getCatalogSnapshot, getCatalogActiveIds,
  getDepositRules, getTaxRules,
  getDepartmentsForPOS, getActivePromotionsForPOS,
} from '../api/pos.js';
import {
  db, getLastSync, setLastSync,
  upsertProducts, deleteProducts, reconcileProducts,
  upsertDepartments, replaceDepartments,
  upsertPromotions, replacePromotions,
} from '../db/dexie.js';
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
        // Tombstones — only present on the FIRST page of an incremental sync.
        // Apply once to purge soft-deleted/deactivated rows from local cache.
        if (res.deleted?.length) await deleteProducts(res.deleted);
        if (res.page >= res.pages) break;
        page++;
      }

      // Sync deposit rules, tax rules, and departments — these are small lists
      // (typically <50 rows) so we use REPLACE semantics. Wipe + bulkPut
      // ensures back-office deletions are reflected without needing tombstones.
      const [deposits, taxes, depts] = await Promise.all([
        getDepositRules(),
        getTaxRules(),
        getDepartmentsForPOS(),
      ]);
      // Deposit + tax rule tables are wiped + replaced so deleted rules vanish.
      await db.transaction('rw', db.depositRules, async () => {
        await db.depositRules.clear();
        if (deposits?.length) await db.depositRules.bulkPut(deposits);
      });
      await db.transaction('rw', db.taxRules, async () => {
        await db.taxRules.clear();
        if (taxes?.length) await db.taxRules.bulkPut(taxes);
      });
      await replaceDepartments(depts || []);

      // Sync promotions — also REPLACE semantics so deactivated promos clear.
      const promos = await getActivePromotionsForPOS().catch(() => []);
      await replacePromotions(promos || []);

      // Reconcile local cache against server truth — prune any product rows
      // whose id is NOT currently active in the back office. Covers the case
      // where the incremental tombstone stream missed rows (long offline gap,
      // Dexie-reseeded across many import batches, etc). Tiny ~50 KB payload.
      try {
        const { activeIds } = await getCatalogActiveIds(storeId);
        const removed = await reconcileProducts(activeIds);
        if (removed > 0) {
          console.info(`[CatalogSync] Reconciled cache — pruned ${removed} stale products.`);
        }
      } catch (err) {
        console.warn('[CatalogSync] active-ids reconciliation skipped:', err.message);
      }

      const now = new Date().toISOString();
      await setLastSync('productsLastSync', now);
      setCatalogSyncedAt(now);

      // ── Post-sync diagnostic ──────────────────────────────────────────
      // One-line summary of the cache so anyone with DevTools open can see
      // whether deposit / age / EBT data is reaching the register. Most
      // useful debugging "why is the cart deposit zero?" — if `withDeposit`
      // is far below what the back office expects, the snapshot didn't
      // populate the field (DB nulls or backend not redeployed). If it's
      // healthy here but the cart still shows zero, the bug is in the
      // cart store, not the data layer. Counts are cheap (Dexie filter pass
      // over ~10-100K rows takes ms) so we log on every sync.
      try {
        const allProducts = await db.products.where('storeId').equals(storeId).toArray();
        const withDeposit  = allProducts.filter(p => Number(p.depositAmount) > 0).length;
        const withPerBase  = allProducts.filter(p => Number(p.depositPerBaseUnit) > 0).length;
        const withPacks    = allProducts.filter(p => Array.isArray(p.packSizes) && p.packSizes.length > 0).length;
        const withAge      = allProducts.filter(p => Number(p.ageRequired) > 0).length;
        const withEbt      = allProducts.filter(p => p.ebtEligible).length;
        // eslint-disable-next-line no-console
        console.info(
          `[CatalogSync] Cache OK — ${allProducts.length} products | ` +
          `${withDeposit} deposit | ${withPerBase} per-base-unit | ${withPacks} multi-pack | ` +
          `${withAge} age-restricted | ${withEbt} EBT`,
        );
        // Backend health: depositPerBaseUnit only emitted by Session F+ snapshot.
        // Zero on a non-empty catalog = backend is running pre-Session-F code.
        if (allProducts.length > 0 && withPerBase === 0 && withDeposit > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            '[CatalogSync] ⚠ depositPerBaseUnit not set on any product — ' +
            'backend may be running pre-Session-F code. Multi-pack picks will ' +
            'show the master deposit instead of pack-scaled deposit. ' +
            'Verify backend git ref + pm2 restart.',
          );
        }
      } catch { /* diagnostic, never blocks sync */ }
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
