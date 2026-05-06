// ─────────────────────────────────────────────────
// useEntitlements — S80 Phase 2 (cashier-app)
//
// Mirror of frontend's `usePlanModules`. Resolves the active station's
// store-scoped entitlements (plan modules ∪ purchased addon modules,
// minus per-store-disabled overrides). The cashier-app's API client
// already attaches the station token, so /plans/me/modules resolves to
// the right store automatically.
//
// Cached in module scope so all consumers share one fetch. Refresh on:
//   • initial mount
//   • storv:auth-change event (cashier sign-in / sign-out)
//   • storv:plan-change event
// ─────────────────────────────────────────────────
import { useEffect, useState, useCallback } from 'react';
import api from '../api/client.js';

let _cache = null;
let _inflight = null;
const _listeners = new Set();
const TTL_MS = 5 * 60 * 1000;

function notify() {
  for (const fn of _listeners) {
    try { fn(_cache); } catch { /* swallow */ }
  }
}

async function fetchEntitlements() {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const { data } = await api.get('/plans/me/modules');
      _cache = {
        moduleKeys: new Set(data.moduleKeys || []),
        subscribedModuleKeys: new Set(data.subscribedModuleKeys || data.moduleKeys || []),
        businessModuleKeys: new Set(data.businessModuleKeys || []),
        plan: data.plan || null,
        addons: data.addons || [],
        modules: data.modules || [],
        businessModules: data.businessModules || [],
        featureOverrides: data.featureOverrides || {},
        fetchedAt: Date.now(),
      };
      notify();
      return _cache;
    } catch (err) {
      // Cashier may not be signed in yet (no JWT) → 401 is expected.
      // Fall back to permissive cache so the cashier UI doesn't lock up.
      _cache = {
        moduleKeys: new Set(),
        subscribedModuleKeys: new Set(),
        businessModuleKeys: new Set(),
        plan: null,
        addons: [],
        modules: [],
        businessModules: [],
        featureOverrides: {},
        fetchedAt: Date.now(),
        error: err?.response?.status === 401 ? 'unauth' : (err?.message || 'fetch_failed'),
      };
      notify();
      return _cache;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export function refreshEntitlements() {
  _cache = null;
  return fetchEntitlements();
}

export default function useEntitlements() {
  const [snap, setSnap] = useState(_cache);

  useEffect(() => {
    const onChange = (s) => setSnap(s);
    _listeners.add(onChange);

    if (!_cache || (Date.now() - (_cache.fetchedAt || 0) > TTL_MS)) {
      fetchEntitlements();
    } else {
      setSnap(_cache);
    }

    const onAuth = () => { _cache = null; fetchEntitlements(); };
    const onPlan = () => { _cache = null; fetchEntitlements(); };

    window.addEventListener('storv:auth-change', onAuth);
    window.addEventListener('storv:plan-change', onPlan);

    return () => {
      _listeners.delete(onChange);
      window.removeEventListener('storv:auth-change', onAuth);
      window.removeEventListener('storv:plan-change', onPlan);
    };
  }, []);

  /**
   * `has(moduleKey)` — does the active store grant this module?
   * Permissive when not yet loaded OR fetch failed (avoid locking the
   * cashier out of the POS due to a transient network blip).
   */
  const has = useCallback((moduleKey) => {
    if (!snap) return true;          // optimistic during initial load
    if (snap.error) return true;     // permissive on fetch failure
    return snap.moduleKeys.has(moduleKey);
  }, [snap]);

  return {
    ready: !!snap && !_inflight,
    has,
    plan: snap?.plan || null,
    addons: snap?.addons || [],
    modules: snap?.modules || [],
    moduleKeys: snap?.moduleKeys || new Set(),
    refresh: refreshEntitlements,
  };
}
