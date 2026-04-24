/**
 * Fetches the FuelSettings + FuelTypes + (V1.5) FuelPumps for this station's store.
 * Polls every 5 minutes; refreshes on visibility change.
 *
 * Returns: { settings, types, pumps, loading }
 *   settings = { enabled, cashOnly, allowRefunds, defaultEntryMode,
 *                defaultFuelTypeId, pumpTrackingEnabled, reconciliationCadence,
 *                varianceAlertThreshold, deliveryCostVarianceThreshold }
 *   types    = [{ id, name, gradeLabel, pricePerGallon, color, isDefault, isTaxable, taxRate }]
 *   pumps    = [{ id, pumpNumber, label, color, tankOverrides, active }]  (V1.5)
 *              — only populated when settings.pumpTrackingEnabled is true,
 *                otherwise always []
 */
import { useState, useEffect, useCallback } from 'react';
import { useStationStore } from '../stores/useStationStore.js';
import { getFuelSettings, getFuelTypes, getFuelPumps } from '../api/pos.js';

const DEFAULT_SETTINGS = {
  enabled:           false,
  cashOnly:          false,
  allowRefunds:      true,
  defaultEntryMode:  'amount',
  defaultFuelTypeId: null,
  pumpTrackingEnabled:           false,
  reconciliationCadence:         'shift',
  varianceAlertThreshold:        2,
  deliveryCostVarianceThreshold: 5,
};

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function useFuelSettings() {
  const storeId = useStationStore(s => s.station?.storeId);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [types, setTypes]       = useState([]);
  const [pumps, setPumps]       = useState([]);
  const [loading, setLoading]   = useState(false);

  const load = useCallback(() => {
    if (!storeId) return;
    setLoading(true);
    Promise.all([
      getFuelSettings(storeId).catch(() => DEFAULT_SETTINGS),
      getFuelTypes(storeId).catch(() => []),
    ])
      .then(async ([s, t]) => {
        const merged = { ...DEFAULT_SETTINGS, ...(s || {}) };
        setSettings(merged);
        setTypes(Array.isArray(t) ? t.filter(x => x.active !== false) : []);
        // V1.5: only fetch pumps when tracking is enabled
        if (merged.pumpTrackingEnabled) {
          try {
            const p = await getFuelPumps(storeId);
            setPumps(Array.isArray(p) ? p.filter(x => x.active !== false) : []);
          } catch {
            setPumps([]);
          }
        } else {
          setPumps([]);
        }
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

  return { settings, types, pumps, loading, reload: load };
}
