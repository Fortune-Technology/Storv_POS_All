/**
 * useStoreModules — lightweight per-store feature-flag hook.
 *
 * Reads the currently-active store's module enablement:
 *   • lottery — from `store.pos.lottery.enabled` via GET /pos-terminal/config
 *   • fuel    — from the FuelSettings table via GET /fuel/settings
 *
 * Re-fetches on:
 *   • mount
 *   • `activeStoreId` change (so StoreSwitcher switches feature visibility)
 *   • tab-return visibility change (mirrors the cashier-app hook)
 *
 * Intentionally tolerant: if either call fails, the corresponding flag falls
 * back to a sensible default so the UI doesn't blank out from a transient
 * network error (lottery → true, fuel → false — matches the cashier-app
 * DEFAULT_POS_CONFIG and DEFAULT_SETTINGS respectively).
 */

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../contexts/StoreContext.jsx';
import { getPOSConfig, getFuelSettings } from '../services/api.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min

export function useStoreModules() {
  const { activeStoreId } = useStore();
  const [modules, setModules] = useState({
    lottery: true,   // default enabled until told otherwise
    fuel:    false,  // default disabled — most stores don't sell fuel
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeStoreId) return;
    setLoading(true);
    try {
      const [cfg, fuelCfg] = await Promise.all([
        getPOSConfig(activeStoreId).catch(() => null),
        getFuelSettings(activeStoreId).catch(() => null),
      ]);
      setModules({
        lottery: cfg?.lottery?.enabled ?? true,
        fuel:    fuelCfg?.enabled ?? false,
      });
    } finally {
      setLoading(false);
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
