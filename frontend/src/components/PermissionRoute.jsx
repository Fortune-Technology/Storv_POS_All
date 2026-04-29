import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';
import { useStoreModules } from '../hooks/useStoreModules';
import { getRoutePermission, getRouteModule } from '../rbac/routePermissions';
import Unauthorized from '../pages/Unauthorized';

/**
 * Guards a route based on the caller's effective permissions AND the
 * active store's enabled feature modules.
 *
 * Layered checks (in order):
 *   1. Not logged in  → redirect to /login
 *   2. Permission known but not granted → show <Unauthorized />
 *   3. Route belongs to a store-module that's disabled → show <Unauthorized />
 *   4. Otherwise render children
 *
 * Explicit `permission` / `module` props override the lookup.
 * Routes without an explicit mapping (no permission AND no module) are
 * "authenticated only" — any logged-in user passes.
 */
export default function PermissionRoute({ children, permission, module: moduleProp }) {
  const { user, can, loading } = usePermissions();
  const { modules, loading: modulesLoading } = useStoreModules();
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

  // Per-store module gating. We wait for the first modules-load to complete
  // so a slow API call doesn't briefly flash the Unauthorized page before
  // settling on the real value.
  const moduleKey = moduleProp ?? getRouteModule(location.pathname);
  if (moduleKey) {
    if (modulesLoading) return null;
    if (!modules[moduleKey]) {
      return <Unauthorized required={`${moduleKey} module is disabled for this store`} />;
    }
  }

  return children;
}
