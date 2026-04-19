/**
 * Manager Store — tracks an active manager override session at the POS.
 *
 * Flow:
 *   Cashier triggers a restricted action
 *   → requireManager(label, callback) called
 *   → if session valid: callback() runs immediately
 *   → if not: ManagerPinModal opens, manager enters PIN
 *   → onPinSuccess() activates session + runs callback
 *   → session lasts SESSION_MINUTES, auto-expires
 */

import { create } from 'zustand';

const SESSION_MINUTES = 10;

export const useManagerStore = create((set, get) => ({
  isActive:      false,
  managerId:     null,
  managerName:   null,
  // Captured during PIN validation so features like Back Office SSO can
  // open the portal as the authenticated manager without a second round
  // trip. Shape: { token, id, name, email, role, orgId, storeId, ... }.
  // Cleared on endSession().
  managerAuth:   null,
  expiresAt:     null,
  pendingAction: null,   // { label: string, callback: () => void } | null
  _timer:        null,

  isSessionValid: () => {
    const { isActive, expiresAt } = get();
    return isActive && expiresAt != null && Date.now() < expiresAt;
  },

  requireManager: (label, callback) => {
    if (get().isSessionValid()) {
      callback();
      return;
    }
    set({ pendingAction: { label, callback } });
  },

  // Third arg `auth` is the full response from /pos-terminal/pin-login
  // (token + user). Optional for back-compat with any caller that only
  // passes the two previous args — `managerAuth` simply stays null.
  onPinSuccess: (managerId, managerName, auth = null) => {
    const { pendingAction, _timer } = get();
    if (_timer) clearTimeout(_timer);

    const expiresAt = Date.now() + SESSION_MINUTES * 60 * 1000;
    const timer = setTimeout(() => {
      get().endSession();
    }, SESSION_MINUTES * 60 * 1000);

    set({
      isActive: true, managerId, managerName,
      managerAuth: auth,
      expiresAt, _timer: timer,
      pendingAction: null,
    });

    if (pendingAction?.callback) pendingAction.callback();
  },

  extendSession: () => {
    const { isActive, _timer } = get();
    if (!isActive) return;
    if (_timer) clearTimeout(_timer);
    const expiresAt = Date.now() + SESSION_MINUTES * 60 * 1000;
    const timer = setTimeout(() => get().endSession(), SESSION_MINUTES * 60 * 1000);
    set({ expiresAt, _timer: timer });
  },

  endSession: () => {
    const { _timer } = get();
    if (_timer) clearTimeout(_timer);
    set({ isActive: false, managerId: null, managerName: null, managerAuth: null, expiresAt: null, _timer: null });
  },

  cancelPending: () => set({ pendingAction: null }),
}));
