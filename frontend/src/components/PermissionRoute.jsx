import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';
import { useStoreModules } from '../hooks/useStoreModules';
import usePlanModules from '../hooks/usePlanModules';
import { getRoutePermission, getRouteModule } from '../rbac/routePermissions';
import Unauthorized from '../pages/Unauthorized';

/**
 * Guards a route based on three layered checks:
 *   1. RBAC permission (per-user role)
 *   2. Per-store module flag (`useStoreModules` — "Lottery is disabled at this store")
 *   3. Plan entitlement   (`usePlanModules` — "Lottery is not in your subscription plan") ← S78
 *
 * Layered checks (in order):
 *   • Not logged in            → redirect to /login
 *   • Missing permission       → <Unauthorized />
 *   • Store module disabled    → <Unauthorized />
 *   • Plan doesn't include it  → <Unauthorized />  (S78)
 *
 * Explicit `permission` / `module` props override the lookup.
 * Routes without an explicit mapping are authenticated-only.
 */
export default function PermissionRoute({ children, permission, module: moduleProp }) {
  const { user, can, loading } = usePermissions();
  const { modules, loading: modulesLoading } = useStoreModules();
  const planGate = usePlanModules();
  const location = useLocation();

  if (!user || !user.token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Wait for permissions fetch before deciding (prevents a false negative flash)
  if (loading) return null;

  const required = permission ?? getRoutePermission(location.pathname);
  if (required && !can(required)) {
    return <Unauthorized required={required} />;
  }

  // Per-store module gating.
  const moduleKey = moduleProp ?? getRouteModule(location.pathname);
  if (moduleKey) {
    if (modulesLoading) return null;
    if (!modules[moduleKey]) {
      return <Unauthorized required={`${moduleKey} module is disabled for this store`} />;
    }
  }

  // S78 — Plan-level entitlement check. Superadmins bypass.
  // The `hasRoute` matcher is permissive while loading (prevents false-negative
  // flash) AND on fetch error (so a transient API blip doesn't lock users out).
  if (user.role !== 'superadmin' && !planGate.hasRoute(location.pathname)) {
    return <Unauthorized required={`This page is not included in your ${planGate.plan?.name || 'current'} plan. Contact billing to upgrade.`} />;
  }

  return children;
}
