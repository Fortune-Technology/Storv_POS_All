// ─────────────────────────────────────────────────
// usePlanModules — S78
//
// Fetches the current user's plan-level entitlements (which modules their
// org's subscription plan grants). Cached in module-scope so all consumers
// (Sidebar, ProtectedRoute, page-level <PlanGate>) share one fetch.
//
// Refresh triggers:
//   • initial mount
//   • `storv:auth-change` event (e.g. after invitation accept / impersonate)
//   • `storv:plan-change` event (admin-side updates that should bust cache)
//   • visibility-change → tab becomes visible AND cache > 5 min old
// ─────────────────────────────────────────────────
import { useEffect, useState, useCallback } from 'react';
import api from '../services/api';

let _cache = null;       // { moduleKeys:Set, routePaths:Set, plan:{...}, modules:[...], fetchedAt:number }
let _inflight = null;    // shared promise during concurrent first-loads
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
        // S80 Phase 3 — grouped architecture:
        //   moduleKeys           : ACTIVE set (subscription ∩ per-store enabled)
        //   subscribedModuleKeys : what the subscription grants regardless of overrides
        //   businessModules      : the 12 toggleable parent modules (subset of subscribed)
        //                          — StoreSettings renders one toggle per row from THIS list
        //   featureOverrides     : per-store overrides keyed by business module key only
        moduleKeys: new Set(data.moduleKeys || []),
        subscribedModuleKeys: new Set(data.subscribedModuleKeys || data.moduleKeys || []),
        businessModuleKeys: new Set(data.businessModuleKeys || []),
        routePaths: new Set(data.routePaths || []),
        plan: data.plan || null,
        addons: data.addons || [],
        modules: data.modules || [],
        subscribedModules: data.subscribedModules || data.modules || [],
        businessModules: data.businessModules || [],
        featureOverrides: data.featureOverrides || {},
        fetchedAt: Date.now(),
        warning: data.warning || null,
      };
      notify();
      return _cache;
    } catch (err) {
      // On failure (e.g. backend down) fall back to a permissive cache
      // so a transient blip doesn't lock the user out of every page.
      _cache = {
        moduleKeys: new Set(),
        subscribedModuleKeys: new Set(),
        businessModuleKeys: new Set(),
        routePaths: new Set(),
        plan: null,
        addons: [],
        modules: [],
        subscribedModules: [],
        businessModules: [],
        featureOverrides: {},
        fetchedAt: Date.now(),
        error: err?.message || 'fetch_failed',
      };
      notify();
      return _cache;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** Force-refresh from anywhere — admin update, plan switch, etc. */
export function refreshPlanModules() {
  _cache = null;
  return fetchEntitlements();
}

/** Public hook. Returns { ready, has, hasRoute, plan, modules, refresh }. */
export default function usePlanModules() {
  const [snap, setSnap] = useState(_cache);

  useEffect(() => {
    const onChange = (s) => setSnap(s);
    _listeners.add(onChange);

    if (!_cache || (Date.now() - (_cache.fetchedAt || 0) > TTL_MS)) {
      fetchEntitlements();
    } else {
      // Cache valid → seed local state immediately.
      setSnap(_cache);
    }

    const onAuth = () => { _cache = null; fetchEntitlements(); };
    const onPlan = () => { _cache = null; fetchEntitlements(); };
    const onVis = () => {
      if (document.visibilityState === 'visible' &&
          _cache && Date.now() - _cache.fetchedAt > TTL_MS) {
        fetchEntitlements();
      }
    };

    window.addEventListener('storv:auth-change', onAuth);
    window.addEventListener('storv:plan-change', onPlan);
    document.addEventListener('visibilitychange', onVis);

    return () => {
      _listeners.delete(onChange);
      window.removeEventListener('storv:auth-change', onAuth);
      window.removeEventListener('storv:plan-change', onPlan);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  /**
   * `has(moduleKey)` — does the current plan grant this module?
   * Superadmins always pass.
   * Returns `true` while loading (optimistic) so the first paint isn't
   * a flash of empty sidebar; the gate re-renders once the fetch lands.
   */
  const has = useCallback((moduleKey) => {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (user?.role === 'superadmin') return true;
    if (!snap) return true; // optimistic during initial load
    if (snap.error) return true; // permissive on fetch failure
    return snap.moduleKeys.has(moduleKey);
  }, [snap]);

  /**
   * `hasRoute(pathname)` — checks if the route is governed by ANY of the
   * user's entitled modules. Used by the route-level gate.
   * Matches dynamic segments (e.g. /portal/catalog/edit/:id matches the
   * literal pathname /portal/catalog/edit/abc).
   */
  const hasRoute = useCallback((pathname) => {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (user?.role === 'superadmin') return true;
    if (!snap) return true;
    if (snap.error) return true;
    if (!pathname) return true;
    // Direct match (most common case).
    if (snap.routePaths.has(pathname)) return true;
    // Param-friendly match — e.g. '/portal/catalog/edit/:id' covers
    // '/portal/catalog/edit/abc'.
    for (const p of snap.routePaths) {
      if (!p.includes(':')) continue;
      const re = new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+') + '$');
      if (re.test(pathname)) return true;
    }
    return false;
  }, [snap]);

  /**
   * `isSubscribed(moduleKey)` — is the module included in the org's
   * subscription (regardless of per-store overrides)? Used by StoreSettings
   * to decide which toggles to show.
   */
  const isSubscribed = useCallback((moduleKey) => {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (user?.role === 'superadmin') return true;
    if (!snap) return true;
    if (snap.error) return true;
    return snap.subscribedModuleKeys.has(moduleKey);
  }, [snap]);

  return {
    ready: !!snap && !_inflight,
    has,
    hasRoute,
    isSubscribed,
    plan: snap?.plan || null,
    addons: snap?.addons || [],
    modules: snap?.modules || [],
    subscribedModules: snap?.subscribedModules || [],
    businessModules: snap?.businessModules || [],   // S80 Phase 3 — toggleable parents
    moduleKeys: snap?.moduleKeys || new Set(),
    subscribedModuleKeys: snap?.subscribedModuleKeys || new Set(),
    businessModuleKeys: snap?.businessModuleKeys || new Set(),
    featureOverrides: snap?.featureOverrides || {},
    refresh: refreshPlanModules,
  };
}
