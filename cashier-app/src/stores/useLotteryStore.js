/**
 * useLotteryStore — tracks lottery sales and payouts for the current shift.
 *
 * Keeps a running list of pending transactions before bulk-submitting at shift end,
 * plus loaded games list from the backend.
 */

import { create } from 'zustand';
import {
  getLotteryGames     as apiGetGames,
  getLotteryBoxes     as apiGetBoxes,
  createLotteryTransaction    as apiCreateTx,
  bulkCreateLotteryTransactions as apiBulkTx,
  getLotteryShiftReport as apiGetShiftReport,
  saveLotteryShiftReport as apiSaveShiftReport,
} from '../api/pos.js';

export const useLotteryStore = create((set, get) => ({
  // ── State ──────────────────────────────────────────────────────────────────
  games:   [],     // LotteryGame[] loaded from API
  boxes:   [],     // active LotteryBox[] for current store
  // In-session transactions (queued locally until submitted)
  pendingTransactions: [],  // { type, amount, gameId?, boxId?, notes? }[]
  // Totals computed from pending
  sessionSales:   0,
  sessionPayouts: 0,
  loading: false,
  error:   null,

  // ── Load games & boxes ────────────────────────────────────────────────────
  loadGames: async (storeId) => {
    set({ loading: true, error: null });
    try {
      const [gamesRes, boxesRes] = await Promise.all([
        apiGetGames(storeId),
        apiGetBoxes({ storeId, status: 'active' }),
      ]);
      set({
        games:   Array.isArray(gamesRes)         ? gamesRes         : (gamesRes?.games   || []),
        boxes:   Array.isArray(boxesRes)          ? boxesRes         : (boxesRes?.boxes   || []),
        loading: false,
      });
    } catch (err) {
      set({ error: err.response?.data?.error || err.message, loading: false });
    }
  },

  // ── Record a sale (adds to pending + immediately posts to backend) ─────────
  recordSale: async ({ amount, gameId, boxId, shiftId, cashierId, stationId, notes }) => {
    const tx = { type: 'sale', amount: Number(amount), gameId, boxId, shiftId, cashierId, stationId, notes };
    try {
      await apiCreateTx(tx);
      set(s => {
        const pending = [...s.pendingTransactions, tx];
        return {
          pendingTransactions: pending,
          sessionSales: s.sessionSales + Number(amount),
        };
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.response?.data?.error || err.message };
    }
  },

  // ── Record a payout ───────────────────────────────────────────────────────
  recordPayout: async ({ amount, shiftId, cashierId, stationId, notes }) => {
    const tx = { type: 'payout', amount: Number(amount), shiftId, cashierId, stationId, notes };
    try {
      await apiCreateTx(tx);
      set(s => {
        const pending = [...s.pendingTransactions, tx];
        return {
          pendingTransactions: pending,
          sessionPayouts: s.sessionPayouts + Number(amount),
        };
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.response?.data?.error || err.message };
    }
  },

  // ── Fetch & save shift report ─────────────────────────────────────────────
  getShiftReport: async (shiftId) => {
    try {
      return await apiGetShiftReport(shiftId);
    } catch (err) {
      return null;
    }
  },

  saveShiftReport: async (data) => {
    try {
      const result = await apiSaveShiftReport(data);
      return { ok: true, report: result };
    } catch (err) {
      return { ok: false, error: err.response?.data?.error || err.message };
    }
  },

  // ── Reset for new shift ───────────────────────────────────────────────────
  resetSession: () => set({
    pendingTransactions: [],
    sessionSales:   0,
    sessionPayouts: 0,
  }),

  clearError: () => set({ error: null }),
}));
