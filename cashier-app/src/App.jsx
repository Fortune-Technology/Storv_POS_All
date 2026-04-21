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
import AIAssistantWidget   from './components/AIAssistantWidget.jsx';
import './App.css';

export default function App() {
  // Customer display — separate window rendered via hash route
  const [isCustomerDisplay] = useState(
    () => window.location.hash === '#/customer-display'
  );
  if (isCustomerDisplay) return <CustomerDisplayScreen />;
  const station    = useStationStore(s => s.station);
  const setStation = useStationStore(s => s.setStation);
  const cashier    = useAuthStore(s => s.cashier);
  const logout     = useAuthStore(s => s.logout);
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

  // ── Auto-logout when browser tab/window is closed (not Electron) ────────
  useEffect(() => {
    if (window.electronAPI?.isElectron) return;
    const handleUnload = () => { localStorage.removeItem('pos_user'); };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  // ── Listen for session expiry from API interceptor ───────────────────
  // Instead of hard-reloading, the API interceptor dispatches a custom event
  // and we gracefully call logout() to return to the PIN screen.
  useEffect(() => {
    const handleExpired = () => {
      console.warn('[App] Session expired — returning to PIN login');
      logout();
    };
    window.addEventListener('pos-session-expired', handleExpired);
    return () => window.removeEventListener('pos-session-expired', handleExpired);
  }, [logout]);

  // ── Listen for station token becoming invalid ────────────────────────
  // If the backend says the station token doesn't match, it means the
  // station record was deleted or we're pointing at a different backend.
  // Clear the station config so the user is sent to the setup wizard.
  useEffect(() => {
    const handleStationInvalid = () => {
      console.warn('[App] Station token invalid — clearing station, returning to setup');
      try {
        // Clear persistent station config
        if (window.electronAPI?.saveConfig) {
          window.electronAPI.saveConfig({ station: null }).catch(() => {});
        }
      } catch {}
      // Clear Zustand store (setStation(null))
      setStation(null);
      logout();
    };
    window.addEventListener('pos-station-invalid', handleStationInvalid);
    return () => window.removeEventListener('pos-station-invalid', handleStationInvalid);
  }, [setStation, logout]);

  // ── Stale session check on boot ───────────────────────────────────────
  // If the cached cashier session is from a previous day, clear it immediately.
  // This handles the case where the browser was closed overnight without logout.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('pos_user');
      if (!raw) return;
      const cached = JSON.parse(raw);
      if (!cached?.loginAt) return;
      const loginDate = new Date(cached.loginAt).toDateString();
      const today = new Date().toDateString();
      if (loginDate !== today) {
        console.info('[App] Stale session detected (logged in on', loginDate, ') — auto-clearing');
        localStorage.removeItem('pos_user');
        logout();
      }
    } catch {}
  }, []); // eslint-disable-line

  // ── Midnight auto-close shift + logout ─────────────────────────────────
  // Runs at App level so it works regardless of which screen is active.
  // At midnight: auto-close the active shift (amount=0) and log out.
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    const timerId = setTimeout(async () => {
      console.info('[App] Midnight reached — auto-closing shift and logging out');

      // Try to close the active shift via API
      try {
        const { shift: currentShift, closeShift: closeFn } = (await import('./stores/useShiftStore.js')).useShiftStore.getState();
        if (currentShift?.id) {
          await closeFn({
            closingAmount: 0,
            closingNote: 'Auto-settled at midnight',
          }).catch(() => {});
        }
      } catch {}

      // Clear cart
      try {
        const { useCartStore } = await import('./stores/useCartStore.js');
        useCartStore.getState().clearCart();
      } catch {}

      // Logout
      localStorage.removeItem('pos_user');
      logout();
    }, msUntilMidnight);

    return () => clearTimeout(timerId);
  }, []); // eslint-disable-line

  if (booting) {
    return (
      <div className="app-boot">
        Starting\u2026
      </div>
    );
  }

  // cashier is authenticated if they have a token (online) OR offlineMode flag (offline)
  const isAuthenticated = !!(cashier?.token || cashier?.offlineMode);

  if (!station)       return <StationSetupScreen />;
  if (!isAuthenticated) return <PinLoginScreen />;
  return (
    <>
      <POSScreen />
      <AIAssistantWidget />
    </>
  );
}
