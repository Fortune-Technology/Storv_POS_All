/**
 * useStoreModules — lightweight per-store feature-flag hook.
 *
 * Reads the currently-active store's module enablement:
 *   • grocery — from `store.pos.groceryEnabled` via GET /pos-terminal/config
 *               (gates PLU, scale / by-weight UI, ingredients, nutrition)
 *   • lottery — from `store.pos.lottery.enabled` via GET /pos-terminal/config
 *   • fuel    — from the FuelSettings table via GET /fuel/settings
 *   • ecom    — from `store.pos.ecomEnabled` via GET /pos-terminal/config
 *
 * Re-fetches on:
 *   • mount
 *   • `activeStoreId` change (so StoreSwitcher switches feature visibility)
 *   • tab-return visibility change (mirrors the cashier-app hook)
 *
 * Intentionally tolerant: if any call fails, the corresponding flag falls
 * back to a sensible default so the UI doesn't blank out from a transient
 * network error. Defaults:
 *   grocery → false (conservative — PLU hidden until explicitly enabled;
 *             matches StoreSettings.jsx `useState(false)` initialiser)
 *   lottery → true  (most stores have it; matches cashier-app DEFAULT_POS_CONFIG)
 *   fuel    → false (most stores don't sell fuel)
 *   ecom    → false (opt-in feature)
 *
 * For bulk-import dropdown filtering that can span several stores at once,
 * see `useImportScopeModules(storeScope)` below.
 */

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../contexts/StoreContext.jsx';
import { getPOSConfig, getFuelSettings, getStores } from '../services/api.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min

// Parse a single store's modules from its pos config + fuel settings payloads.
// Shared by useStoreModules (active store) + useImportScopeModules (any store).
function parseModules(cfg, fuelCfg) {
  return {
    grocery: cfg?.groceryEnabled === true,
    lottery: cfg?.lottery?.enabled ?? true,
    fuel:    fuelCfg?.enabled ?? false,
    ecom:    cfg?.ecomEnabled === true,
  };
}

const DEFAULT_MODULES = { grocery: false, lottery: true, fuel: false, ecom: false };

export function useStoreModules() {
  const { activeStoreId } = useStore();
  const [modules, setModules] = useState(DEFAULT_MODULES);
  // `loading` ONLY reflects the very first load. After the first successful
  // fetch it flips false and never flips back. Subsequent polls / visibility-
  // change refetches / store switches update `modules` silently without
  // triggering a `loading=true` phase.
  //
  // Why this matters: pages that gate rendering on `loading` (e.g.
  // `if (loading) return null` in Lottery.jsx + Fuel.jsx) were unmounting
  // themselves every 5 minutes when the poll fired — which also unmounted
  // any open modal and reset local state (tab selection, form drafts, etc.).
  // Users reported "my Receive Books popup just closes itself while I'm
  // working on it" and that's exactly why.
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeStoreId) return;
    try {
      const [cfg, fuelCfg] = await Promise.all([
        getPOSConfig(activeStoreId).catch(() => null),
        getFuelSettings(activeStoreId).catch(() => null),
      ]);
      setModules(parseModules(cfg, fuelCfg));
    } finally {
      setLoading(false);   // one-way flip — never goes back to true
    }
  }, [activeStoreId]);

  useEffect(() => {
    if (!activeStoreId) return;
    load();
    const intervalId = setInterval(load, POLL_INTERVAL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [activeStoreId, load]);

  return { modules, loading, reload: load };
}

/**
 * useImportScopeModules(storeScope)
 *
 * Scope-aware module aggregation for the Bulk Import page (Item #4 in the
 * April audit — "PLU gated on grocery module; dropdown hides it per scope").
 *
 * storeScope semantics (matches BulkImport.jsx):
 *   • 'active'       → return active store's modules
 *   • 'all'          → return UNION across every store in the org
 *                      (flag is true if ANY store in the org has it enabled)
 *   • <specific id>  → return that one store's modules
 *
 * Returns an object { modules, loading } with modules shaped like
 * useStoreModules. While loading, falls back to the active store's modules
 * rather than DEFAULT_MODULES so there's no brief flicker of everything off.
 */
export function useImportScopeModules(storeScope) {
  const { modules: activeModules } = useStoreModules();
  const [scopeModules, setScopeModules] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      if (!storeScope || storeScope === 'active') {
        setScopeModules(activeModules);
        return;
      }
      setLoading(true);
      try {
        if (storeScope === 'all') {
          // Fetch every store in the org + their pos config + fuel settings
          // in parallel, then compute the OR-union.
          const r = await getStores();
          const list = Array.isArray(r) ? r : (r?.stores || r?.data || []);
          const perStore = await Promise.all(list.map(async (s) => {
            const [cfg, fuelCfg] = await Promise.all([
              getPOSConfig(s.id).catch(() => null),
              getFuelSettings(s.id).catch(() => null),
            ]);
            return parseModules(cfg, fuelCfg);
          }));
          if (cancelled) return;
          const union = perStore.reduce((acc, m) => ({
            grocery: acc.grocery || m.grocery,
            lottery: acc.lottery || m.lottery,
            fuel:    acc.fuel    || m.fuel,
            ecom:    acc.ecom    || m.ecom,
          }), { grocery: false, lottery: false, fuel: false, ecom: false });
          setScopeModules(union);
        } else {
          // Specific store id
          const [cfg, fuelCfg] = await Promise.all([
            getPOSConfig(storeScope).catch(() => null),
            getFuelSettings(storeScope).catch(() => null),
          ]);
          if (cancelled) return;
          setScopeModules(parseModules(cfg, fuelCfg));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    resolve();
    return () => { cancelled = true; };
  }, [storeScope, activeModules]);

  return { modules: scopeModules || activeModules, loading };
}
