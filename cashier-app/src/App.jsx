/**
 * App — state-machine router
 *
 * No station config  →  StationSetupScreen  (manager one-time setup)
 * Station but no cashier  →  PinLoginScreen  (cashier PIN entry)
 * Station + cashier  →  POSScreen  (full POS)
 *
 * Offline login: cashier.offlineMode=true is treated as authenticated.
 * The cashier signed in against the local PIN cache; their token may be
 * expired but all sales will be queued and synced when back online.
 */

import React, { useEffect, useState } from 'react';
import { useStationStore, restoreStationFromDisk } from './stores/useStationStore.js';
import { useAuthStore }    from './stores/useAuthStore.js';
import { useSyncStore }    from './stores/useSyncStore.js';
import StationSetupScreen  from './screens/StationSetupScreen.jsx';
import PinLoginScreen      from './screens/PinLoginScreen.jsx';
import POSScreen           from './screens/POSScreen.jsx';
import CustomerDisplayScreen from './screens/CustomerDisplayScreen.jsx';

export default function App() {
  // Customer display — separate window rendered via hash route
  const [isCustomerDisplay] = useState(
    () => window.location.hash === '#/customer-display'
  );
  if (isCustomerDisplay) return <CustomerDisplayScreen />;
  const station    = useStationStore(s => s.station);
  const setStation = useStationStore(s => s.setStation);
  const cashier    = useAuthStore(s => s.cashier);
  const loadPendingCount = useSyncStore(s => s.loadPendingCount);

  const [booting, setBooting] = useState(true);

  // On startup:
  // 1. Load pending transaction count from IndexedDB
  // 2. If running in Electron and station is missing from localStorage,
  //    try to restore it from the disk backup (userData/storeveu_station.json)
  useEffect(() => {
    async function boot() {
      await loadPendingCount();

      if (!station && window.electronAPI?.loadConfig) {
        const diskStation = await restoreStationFromDisk();
        if (diskStation) {
          console.info('[App] Restored station config from disk backup');
          setStation(diskStation);
        }
      }
      setBooting(false);
    }
    boot();
  }, []); // eslint-disable-line

  if (booting) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0f1117', color: '#7ac143', fontSize: '0.85rem', fontWeight: 700,
        letterSpacing: '0.08em',
      }}>
        Starting…
      </div>
    );
  }

  // cashier is authenticated if they have a token (online) OR offlineMode flag (offline)
  const isAuthenticated = !!(cashier?.token || cashier?.offlineMode);

  if (!station)       return <StationSetupScreen />;
  if (!isAuthenticated) return <PinLoginScreen />;
  return <POSScreen />;
}
