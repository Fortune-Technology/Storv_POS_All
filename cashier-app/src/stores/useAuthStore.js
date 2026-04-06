/**
 * Auth Store — cashier session only.
 * Station identity is separate (useStationStore).
 * Sign-out clears the session but never the station config.
 *
 * Offline login:
 *   On every successful online PIN login the cashier profile + SHA-256(pin)
 *   is written to IndexedDB.  If the network is unavailable on the next login
 *   attempt, the local cache is checked instead so cashiers can always sign in.
 */

import { create } from 'zustand';
import api from '../api/client.js';
import { cacheCashierLocally, findCashierByPinHash } from '../db/dexie.js';

const STORAGE_KEY = 'pos_user';

const load = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
};

/** SHA-256 of pin string using Web Crypto API (available in Electron + Chrome) */
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const useAuthStore = create((set) => ({
  cashier: load(),
  loading: false,
  error:   null,

  // PIN-based login. stationToken comes from useStationStore.
  // Falls back to locally cached credentials when the network is unavailable.
  pinLogin: async (pin, stationToken) => {
    set({ loading: true, error: null });

    // ── Online path ──────────────────────────────────────────────────────────
    try {
      const res = await api.post(
        '/pos-terminal/pin-login',
        { pin },
        { headers: { 'X-Station-Token': stationToken } }
      );
      const cashier = res.data;

      // Cache cashier + PIN hash for offline logins
      try {
        const pinHash = await sha256(pin);
        await cacheCashierLocally({ ...cashier, pinHash });
      } catch { /* non-critical — cache failure shouldn't block login */ }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(cashier));
      set({ cashier, loading: false });
      return cashier;

    } catch (err) {
      // ── Offline / network-error path ───────────────────────────────────────
      // err.response is undefined when there is no HTTP response (network down,
      // connection refused, timeout). In that case try the local cache.
      const isNetworkError = !err.response;
      if (isNetworkError) {
        try {
          const pinHash = await sha256(pin);
          const cached  = await findCashierByPinHash(pinHash);
          if (cached) {
            // Strip the internal pinHash before exposing to the app
            const { pinHash: _ph, cachedAt: _ca, ...cashierData } = cached;
            const offlineCashier = { ...cashierData, offlineMode: true };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(offlineCashier));
            set({ cashier: offlineCashier, loading: false });
            return offlineCashier;
          }
        } catch { /* ignore IndexedDB errors */ }

        const msg = 'No internet connection. Connect online at least once per day so your PIN can be saved for offline use.';
        set({ loading: false, error: msg });
        throw new Error(msg);
      }

      const msg = err.response?.data?.error || err.message || 'Incorrect PIN. Please try again.';
      set({ loading: false, error: msg });
      throw new Error(msg);
    }
  },

  // Sign out — clears cashier session only, station config stays.
  logout: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ cashier: null, error: null });
  },

  // Call this to check whether it's safe to sign out. Pass cart items count.
  checkLogout: (cartItemCount) => {
    if (cartItemCount > 0) {
      return { allowed: false, reason: 'Transaction in progress. Complete or clear the cart before signing out.' };
    }
    return { allowed: true };
  },

  clearError: () => set({ error: null }),
}));
