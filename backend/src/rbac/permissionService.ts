/**
 * Permission service — resolves a user's effective permission set.
 *
 * Sources (union):
 *   1. Legacy `User.role` → maps to the matching built-in system role's permissions
 *   2. Any explicit UserRole rows the user holds (custom or system roles)
 *
 * Cached per-request via `req._perms` to avoid repeat DB hits within a single call.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import prisma from '../config/postgres.js';

interface UserLike {
  id: string;
  orgId?: string | null;
  role?: string | null;
}

interface RequestWithPerms extends Request {
  _perms?: string[];
}

/**
 * Return a de-duplicated array of permission keys the user effectively holds
 * in the given active org. When `activeOrgId` is null, falls back to the
 * user's home org (User.orgId) for backward compatibility.
 *
 * Multi-org semantics: a user who belongs to Org A and Org B may have
 * different roles (and therefore different permissions) in each. Permissions
 * are always resolved against the *active* org — never unioned across orgs.
 */
export async function computeUserPermissions(
  user: UserLike | null | undefined,
  activeOrgId: string | null = null,
): Promise<string[]> {
  if (!user) return [];

  const orgId: string | null = activeOrgId || user.orgId || null;

  // The effective role key for permission resolution:
  //   1. UserOrg row for the active org (per-org role)
  //   2. Fallback: user.role (legacy home-org role)
  let effectiveRoleKey: string | null | undefined = user.role;
  if (orgId) {
    const membership = await prisma.userOrg.findUnique({
      where: { userId_orgId: { userId: user.id, orgId } },
      select: { role: true },
    });
    if (membership?.role) effectiveRoleKey = membership.role;
  }

  const roleIds = new Set<string>();

  // 1. Legacy `User.role` + UserOrg role → find the matching role row.
  //    Could be a built-in system role (orgId=null) OR a custom role in the
  //    active org (orgId = activeOrgId).
  if (effectiveRoleKey) {
    const match = await prisma.role.findFirst({
      where: {
        key: effectiveRoleKey,
        status: 'active',
        OR: [
          { orgId: null, isSystem: true },
          ...(orgId ? [{ orgId }] : []),
        ],
      },
      select: { id: true },
    });
    if (match) roleIds.add(match.id);
  }

  // 2. Explicit UserRole assignments (multi-role stacking).
  //    A UserRole only applies when its Role is either a system role
  //    (orgId=null) OR lives in the currently active org — otherwise a
  //    custom "Store Manager" role in Org A would leak permissions when
  //    the user switches to Org B.
  const userRoles = await prisma.userRole.findMany({
    where: {
      userId: user.id,
      role: {
        OR: [
          { orgId: null },
          ...(orgId ? [{ orgId }] : []),
        ],
      },
    },
    select: { roleId: true },
  });
  type UserRoleRow = { roleId: string };
  (userRoles as UserRoleRow[]).forEach((ur) => roleIds.add(ur.roleId));

  if (roleIds.size === 0) {
    // Defence-in-depth: if a user claims a known full-access role but the
    // matching Role row doesn't exist (seedRbac.js never ran), grant '*' so
    // org owners don't get locked out of their own account. The proper fix
    // is still `node prisma/seedRbac.js` — this is just a soft failover.
    if (effectiveRoleKey && ['owner', 'admin', 'superadmin'].includes(effectiveRoleKey)) {
      try {
        const { ALL_PERMISSIONS } = await import('./permissionCatalog.js');
        const scope: 'org' | null = effectiveRoleKey === 'superadmin' ? null /* both scopes */ : 'org';
        return ALL_PERMISSIONS
          .filter((p) => scope === null || p.scope === scope)
          .map((p) => p.key);
      } catch { /* catalog import failed — return empty below */ }
    }
    return [];
  }

  // 3. Collect all permission keys across those roles
  const rolePerms = await prisma.rolePermission.findMany({
    where: { roleId: { in: [...roleIds] } },
    select: { permission: { select: { key: true } } },
  });

  type RolePermRow = { permission: { key: string } };
  return [...new Set((rolePerms as RolePermRow[]).map((rp) => rp.permission.key))];
}

/**
 * Express middleware factory. Usage:
 *   router.post('/products', protect, requirePermission('products.create'), handler)
 *
 * If the user holds ANY of the supplied permission keys, the request passes.
 * (Use this instead of — or alongside — the legacy `authorize('manager', ...)`.)
 *
 * Superadmins bypass the check automatically.
 */
export function requirePermission(...keys: string[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authorized' });
      if (req.user.role === 'superadmin') return next();

      const r = req as RequestWithPerms;
      if (!r._perms) {
        // scopeToTenant sets req.orgId to the active org (derived from the
        // active store). Permissions are always evaluated against that org.
        r._perms = await computeUserPermissions(req.user as UserLike, req.orgId ?? null);
      }
      const perms = r._perms || [];
      const has = keys.some((k) => perms.includes(k));
      if (!has) {
        return res.status(403).json({ error: `Missing permission: ${keys.join(' or ')}` });
      }
      next();
    } catch (err) { next(err); }
  };
}

/**
 * Boolean helper for use inside controllers (post-`protect`):
 *   if (await userHasPermission(req, 'transactions.manage')) { ... }
 */
export async function userHasPermission(req: Request, key: string): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === 'superadmin') return true;
  const r = req as RequestWithPerms;
  if (!r._perms) r._perms = await computeUserPermissions(req.user as UserLike, req.orgId ?? null);
  return (r._perms || []).includes(key);
}

/**
 * Ensure the user is assigned to the built-in system role that matches their
 * legacy `User.role` field. Idempotent — safe to call on every create/update.
 *
 * Removes ANY stale default-role assignments (other system roles) so that
 * changing User.role from "cashier" to "manager" also updates the UserRole
 * junction. Custom per-org roles assigned manually are never touched.
 *
 * Returns true if a change was made, false if already in sync.
 */
export async function syncUserDefaultRole(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!user || !user.role) return false;

  // Only auto-sync BUILT-IN system roles. For custom org roles set as
  // `user.role`, we rely on `computeUserPermissions` reading the key
  // directly — we don't create an auto-UserRole entry, so that manually
  // stacked custom roles via UserRolesModal aren't silently wiped when
  // the primary role changes.
  const systemRole = await prisma.role.findFirst({
    where: { orgId: null, key: user.role, isSystem: true },
    select: { id: true, key: true },
  });

  // Always clean up stale built-in system UserRoles (from a previous `user.role`).
  const existing = await prisma.userRole.findMany({
    where: {
      userId,
      role: { isSystem: true, orgId: null },
    },
    select: { roleId: true },
  });

  type ExistRow = { roleId: string };
  const targetId: string | undefined = systemRole?.id;
  const existRows = existing as ExistRow[];
  const alreadyAssigned = targetId ? existRows.some((e) => e.roleId === targetId) : false;
  const staleIds = existRows
    .filter((e) => e.roleId !== targetId)
    .map((e) => e.roleId);

  let changed = false;

  if (staleIds.length) {
    await prisma.userRole.deleteMany({ where: { userId, roleId: { in: staleIds } } });
    changed = true;
  }

  if (targetId && !alreadyAssigned) {
    await prisma.userRole.create({ data: { userId, roleId: targetId } });
    changed = true;
  }

  return changed;
}

export default { computeUserPermissions, requirePermission, userHasPermission, syncUserDefaultRole };
