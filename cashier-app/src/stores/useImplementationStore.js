/**
 * S78 — Implementation Engineer session store (cashier-app).
 *
 * Mirrors useManagerStore but with a 1-hour window (vs manager's 10 min)
 * and a separate modal trigger (`pendingHardwareAction`). Lives parallel
 * to the manager session — they don't interact.
 *
 * Flow:
 *   Cashier opens Hardware Settings
 *   → requireImplementation('Hardware Settings', callback) called
 *   → if session valid: callback() runs immediately
 *   → if not: ImplementationPinModal opens, engineer enters PIN
 *   → onPinSuccess() activates session + runs callback
 *   → session lasts SESSION_MINUTES, auto-expires
 *
 * Persisted? NO. Each fresh sign-in / page reload requires a new PIN.
 * The threat model is "store staff who shouldn't touch hardware" — they
 * don't have the PIN, so a fresh session is the right default.
 */

import { create } from 'zustand';

const SESSION_MINUTES = 60; // 1 hour — full setup window per user spec

export const useImplementationStore = create((set, get) => ({
  isActive:      false,
  engineerId:    null,
  engineerName:  null,
  engineerEmail: null,
  expiresAt:     null,
  pendingAction: null,   // { label, callback } | null
  _timer:        null,

  isSessionValid: () => {
    const { isActive, expiresAt } = get();
    return isActive && expiresAt != null && Date.now() < expiresAt;
  },

  /** Open the ImplementationPinModal if there's no active session yet. */
  requireImplementation: (label, callback) => {
    if (get().isSessionValid()) {
      callback();
      return;
    }
    set({ pendingAction: { label, callback } });
  },

  /**
   * Called by ImplementationPinModal after a successful POST to
   * /api/auth/implementation-pin/verify. The endpoint returns
   * { token, user, expiresAt, ttlSeconds }. We respect the server-side
   * ttl by capping at the smaller of SESSION_MINUTES and the JWT exp.
   */
  onPinSuccess: ({ user, expiresAt: serverExpiry }) => {
    const { pendingAction, _timer } = get();
    if (_timer) clearTimeout(_timer);

    const localExpiresAt = Date.now() + SESSION_MINUTES * 60 * 1000;
    const serverExpiresMs = serverExpiry ? new Date(serverExpiry).getTime() : Infinity;
    const expiresAt = Math.min(localExpiresAt, serverExpiresMs);
    const ttlMs = Math.max(0, expiresAt - Date.now());

    const timer = setTimeout(() => get().endSession(), ttlMs);

    set({
      isActive: true,
      engineerId:    user?.id    || null,
      engineerName:  user?.name  || null,
      engineerEmail: user?.email || null,
      expiresAt,
      _timer: timer,
      pendingAction: null,
    });

    if (pendingAction?.callback) pendingAction.callback();
  },

  endSession: () => {
    const { _timer } = get();
    if (_timer) clearTimeout(_timer);
    set({
      isActive: false,
      engineerId: null,
      engineerName: null,
      engineerEmail: null,
      expiresAt: null,
      _timer: null,
    });
  },

  cancelPending: () => set({ pendingAction: null }),
}));
