/**
 * Station Store — persists physical register identity across cashier sign-outs.
 * Station config lives in localStorage indefinitely until a manager resets it.
 * Cashier sessions are separate (useAuthStore) and clear on sign-out.
 *
 * Electron resilience:
 *   When running as an Electron app, a copy of the station config is ALSO
 *   written to disk (userData/storeveu_station.json) so it can be restored if
 *   localStorage is ever cleared by an Electron update or crash.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Write station config to disk (Electron only — no-op in browser) */
function backupToDisk(station) {
  try {
    if (window.electronAPI?.saveConfig) {
      window.electronAPI.saveConfig({ station, savedAt: new Date().toISOString() });
    }
  } catch { /* non-critical */ }
}

/** Try to restore station config from disk if localStorage is empty (Electron only) */
export async function restoreStationFromDisk() {
  try {
    if (!window.electronAPI?.loadConfig) return null;
    const saved = await window.electronAPI.loadConfig();
    return saved?.station || null;
  } catch {
    return null;
  }
}

export const useStationStore = create(
  persist(
    (set) => ({
      // station shape:
      // { stationId, stationToken, stationName, storeId, storeName, orgId }
      station: null,

      setStation: (station) => {
        backupToDisk(station);
        set({ station });
      },
      clearStation: () => set({ station: null }),
    }),
    { name: 'pos_station' }
  )
);
