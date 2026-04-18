/**
 * Fetches the FuelSettings + FuelTypes for this station's store.
 * Polls every 5 minutes; refreshes on visibility change.
 *
 * Returns: { settings, types, loading }
 *   settings = { enabled, cashOnly, allowRefunds, defaultEntryMode, defaultFuelTypeId }
 *   types    = [{ id, name, gradeLabel, pricePerGallon, color, isDefault, isTaxable, taxRate }]
 */
import { useState, useEffect, useCallback } from 'react';
import { useStationStore } from '../stores/useStationStore.js';
import { getFuelSettings, getFuelTypes } from '../api/pos.js';

const DEFAULT_SETTINGS = {
  enabled:           false,
  cashOnly:          false,
  allowRefunds:      true,
  defaultEntryMode:  'amount',
  defaultFuelTypeId: null,
};

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function useFuelSettings() {
  const storeId = useStationStore(s => s.station?.storeId);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [types, setTypes]       = useState([]);
  const [loading, setLoading]   = useState(false);

  const load = useCallback(() => {
    if (!storeId) return;
    setLoading(true);
    Promise.all([
      getFuelSettings(storeId).catch(() => DEFAULT_SETTINGS),
      getFuelTypes(storeId).catch(() => []),
    ])
      .then(([s, t]) => {
        setSettings({ ...DEFAULT_SETTINGS, ...(s || {}) });
        setTypes(Array.isArray(t) ? t.filter(x => x.active !== false) : []);
      })
      .finally(() => setLoading(false));
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    load();
    const intervalId = setInterval(load, POLL_INTERVAL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [storeId, load]);

  return { settings, types, loading, reload: load };
}
