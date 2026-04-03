/**
 * Station Store — persists physical register identity across cashier sign-outs.
 * Station config lives in localStorage indefinitely until a manager resets it.
 * Cashier sessions are separate (useAuthStore) and clear on sign-out.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useStationStore = create(
  persist(
    (set) => ({
      // station shape:
      // { stationId, stationToken, stationName, storeId, storeName, orgId }
      station: null,

      setStation:   (station) => set({ station }),
      clearStation: ()        => set({ station: null }),
    }),
    { name: 'pos_station' }
  )
);
