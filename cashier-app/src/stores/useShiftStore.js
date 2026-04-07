/**
 * Shift Store — tracks the active cash drawer shift for this store.
 *
 * On cashier login the POS should call loadActiveShift(storeId).
 * If no open shift exists, POSScreen shows OpenShiftModal.
 */

import { create } from 'zustand';
import {
  getActiveShift  as apiGetActiveShift,
  openShift       as apiOpenShift,
  closeShift      as apiCloseShift,
  addCashDrop     as apiAddCashDrop,
  addPayout       as apiAddPayout,
  getShiftReport  as apiGetShiftReport,
} from '../api/pos.js';

export const useShiftStore = create((set, get) => ({
  // ── State ────────────────────────────────────────────────────────────────
  shift:   null,   // active shift object or null
  loading: false,
  error:   null,

  // ── Actions ──────────────────────────────────────────────────────────────

  /** Load the active (open) shift for a store. Call on login / app boot. */
  loadActiveShift: async (storeId) => {
    set({ loading: true, error: null });
    try {
      const data = await apiGetActiveShift(storeId);
      const shift = data.shift || null;

      // Flag if the shift was opened before today's midnight (cashier forgot to close last night)
      if (shift?.openedAt) {
        const todayMidnight = new Date();
        todayMidnight.setHours(0, 0, 0, 0);
        if (new Date(shift.openedAt) < todayMidnight) {
          shift._crossedMidnight = true;
        }
      }

      set({ shift, loading: false });
    } catch (err) {
      set({ error: err.response?.data?.error || err.message, loading: false });
    }
  },

  /** Open a new shift. body: { storeId, stationId?, openingAmount, openingDenominations?, openingNote? } */
  openShift: async (body) => {
    set({ loading: true, error: null });
    try {
      const shift = await apiOpenShift(body);
      set({ shift, loading: false });
      return { ok: true, shift };
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      set({ error: msg, loading: false });
      return { ok: false, error: msg };
    }
  },

  /** Close the current shift. body: { closingAmount, closingDenominations?, closingNote? } */
  closeShift: async (body) => {
    const { shift } = get();
    if (!shift) return { ok: false, error: 'No active shift' };
    set({ loading: true, error: null });
    try {
      const closed = await apiCloseShift(shift.id, body);
      set({ shift: null, loading: false });
      return { ok: true, report: closed };
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      set({ error: msg, loading: false });
      return { ok: false, error: msg };
    }
  },

  /** Add a cash drop (remove cash from drawer mid-shift). */
  addCashDrop: async (amount, note) => {
    const { shift } = get();
    if (!shift) return { ok: false, error: 'No active shift' };
    try {
      const drop = await apiAddCashDrop(shift.id, { amount, note });
      set(s => ({
        shift: s.shift ? { ...s.shift, drops: [...(s.shift.drops || []), drop] } : s.shift,
      }));
      return { ok: true, drop };
    } catch (err) {
      return { ok: false, error: err.response?.data?.error || err.message };
    }
  },

  /** Add a paid-out (pay a vendor / misc expense from drawer). */
  addPayout: async (amount, recipient, note, extras = {}) => {
    const { shift } = get();
    if (!shift) return { ok: false, error: 'No active shift' };
    try {
      const payout = await apiAddPayout(shift.id, { amount, recipient, note, ...extras });
      set(s => ({
        shift: s.shift ? { ...s.shift, payouts: [...(s.shift.payouts || []), payout] } : s.shift,
      }));
      return { ok: true, payout };
    } catch (err) {
      return { ok: false, error: err.response?.data?.error || err.message };
    }
  },

  /** Fetch full shift report (for display after close or history). */
  getShiftReport: async (shiftId) => {
    try {
      return await apiGetShiftReport(shiftId);
    } catch (err) {
      return null;
    }
  },

  clearError: () => set({ error: null }),
}));
