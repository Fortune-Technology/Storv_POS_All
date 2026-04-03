/**
 * Auth Store — cashier session only.
 * Station identity is separate (useStationStore).
 * Sign-out clears the session but never the station config.
 */

import { create } from 'zustand';
import api from '../api/client.js';

const STORAGE_KEY = 'pos_user';

const load = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
};

export const useAuthStore = create((set) => ({
  cashier: load(),
  loading: false,
  error:   null,

  // PIN-based login. stationToken comes from useStationStore.
  pinLogin: async (pin, stationToken) => {
    set({ loading: true, error: null });
    try {
      const res = await api.post(
        '/pos-terminal/pin-login',
        { pin },
        { headers: { 'X-Station-Token': stationToken } }
      );
      const cashier = res.data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cashier));
      set({ cashier, loading: false });
      return cashier;
    } catch (err) {
      const msg = err.response?.data?.error || 'Invalid PIN';
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
