/**
 * Role & Permission management controller.
 *
 * Two operational scopes:
 *   • org scope  — used by portal. Lists/creates/edits roles where orgId = req.orgId.
 *                  Built-in org-scope system roles (orgId=null) are also returned but
 *                  cannot be edited / deleted (enforced by isSystem flag).
 *   • admin scope — used by admin-app (superadmin only). Lists and edits ALL roles
 *                   including admin-scope system roles (superadmin).
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { ALL_PERMISSIONS } from '../rbac/permissionCatalog.js';
import { logAudit } from '../services/auditService.js';

interface PermissionCatalogEntry {
  key: string;
  surface?: string;
  moduleLabel?: string;
}

// ─── Permission catalog (read-only) ──────────────────────────────────────
export async function listPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = req.query.scope as string | undefined; // 'org' | 'admin' | undefined (all)
    const perms = await prisma.permission.findMany({
      where: scope ? { scope } : undefined,
      orderBy: [{ scope: 'asc' }, { module: 'asc' }, { action: 'asc' }],
    });

    // Merge `surface` metadata from the in-memory catalog.
    const catalogByKey: Record<string, PermissionCatalogEntry> = Object.fromEntries(
      (ALL_PERMISSIONS as PermissionCatalogEntry[]).map((p) => [p.key, p]),
    );
    type PermRow = (typeof perms)[number];
    const enriched = perms.map((p: PermRow) => {
      const c = catalogByKey[p.key];
      return {
        ...p,
        surface: c?.surface || (p.scope === 'admin' ? 'back-office' : 'back-office'),
        moduleLabel: c?.moduleLabel || null,
      };
    });

    // Group by module for convenience in UI
    const grouped: Record<string, typeof enriched> = {};
    for (const p of enriched) {
      if (!grouped[p.module]) grouped[p.module] = [];
      grouped[p.module].push(p);
    }
    res.json({ permissions: enriched, grouped });
  } catch (err) { next(err); }
}

// ─── List roles (org-scope for portal, all for admin) ────────────────────
export async function listRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const isAdminScope = req.query.scope === 'admin';
    const includeSystem = req.query.includeSystem !== 'false';

    let where: Prisma.RoleWhereInput;
    if (isAdminScope) {
      // admin-app: return only admin-scope roles
      where = { scope: 'admin' };
    } else {
      // portal: org's own roles + built-in org-scope system roles (if requested)
      where = {
        OR: [
          { orgId: req.orgId as string },
          ...(includeSystem ? [{ orgId: null, scope: 'org', isSystem: true } as Prisma.RoleWhereInput] : []),
        ],
      };
    }

    const roles = await prisma.role.findMany({
      where,
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: {
        rolePermissions: { select: { permission: { select: { key: true } } } },
        userRoles:       { select: { userId: true } },
      },
    });

    // Also count users where `User.role = role.key`.
    type RoleRow = (typeof roles)[number];
    const roleKeys = Array.from(new Set(roles.map((r: RoleRow) => r.key)));
    const legacyUsers = await prisma.user.findMany({
      where: {
        role: { in: roleKeys },
        ...(req.orgId ? { orgId: req.orgId } : {}),
      },
      select: { id: true, role: true },
    });
    const legacyByKey: Record<string, Set<string>> = {};
    for (const u of legacyUsers) {
      if (u.role) (legacyByKey[u.role] ??= new Set()).add(u.id);
    }

    const shaped = roles.map((r: RoleRow) => {
      const users = new Set(r.userRoles.map((ur: { userId: string }) => ur.userId));
      if (legacyByKey[r.key]) legacyByKey[r.key].forEach((id: string) => users.add(id));
      return {
        id: r.id,
        orgId: r.orgId,
        key: r.key,
        name: r.name,
        description: r.description,
        status: r.status,
        scope: r.scope,
        isSystem: r.isSystem,
        isCustomized: r.isCustomized,
        permissions: r.rolePermissions.map((rp: { permission: { key: string } }) => rp.permission.key),
        userCount: users.size,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });

    res.json({ roles: shaped });
  } catch (err) { next(err); }
}

export async function getRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: {
        rolePermissions: { select: { permission: { select: { key: true } } } },
        userRoles:       { select: { userId: true } },
      },
    });
    if (!role) { res.status(404).json({ error: 'Role not found' }); return; }
    // Scope check: org users can only read their own org's custom roles + system roles
    if (req.user?.role !== 'superadmin' && role.orgId && role.orgId !== req.orgId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Union UserRole holders with users whose legacy `User.role = role.key`.
    const legacy = await prisma.user.findMany({
      where: {
        role: role.key,
        ...(req.orgId ? { orgId: req.orgId } : {}),
      },
      select: { id: true },
    });
    const users = new Set(role.userRoles.map((ur: { userId: string }) => ur.userId));
    legacy.forEach((u: { id: string }) => users.add(u.id));

    res.json({
      id: role.id, orgId: role.orgId, key: role.key, name: role.name,
      description: role.description, status: role.status, scope: role.scope,
      isSystem: role.isSystem, isCustomized: role.isCustomized,
      permissions: role.rolePermissions.map((rp: { permission: { key: string } }) => rp.permission.key),
      userCount: users.size,
    });
  } catch (err) { next(err); }
}

interface CreateRoleBody {
  key?: string;
  name?: string;
  description?: string | null;
  permissions?: string[];
  status?: string;
}

export async function createRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { key, name, description, permissions = [], status = 'active' } = req.body as CreateRoleBody;
    const isAdminScope = req.query.scope === 'admin';

    if (!name || !key) { res.status(400).json({ error: 'key and name are required' }); return; }
    if (!/^[a-z0-9_]+$/.test(key)) {
      res.status(400).json({ error: 'key must be lowercase letters, digits, or underscores' });
      return;
    }

    // Only superadmin can create admin-scope roles
    if (isAdminScope && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Admin-scope roles require superadmin' });
      return;
    }

    const orgId = isAdminScope ? null : req.orgId;

    // Prevent collision with system role keys
    const collision = await prisma.role.findFirst({
      where: { orgId, key },
    });
    if (collision) { res.status(409).json({ error: `A role with key "${key}" already exists` }); return; }

    // Validate permission keys
    const perms = await prisma.permission.findMany({
      where: { key: { in: permissions } },
      select: { id: true, key: true, scope: true },
    });

    type PermRow = (typeof perms)[number];

    // Org-scope roles can't hold admin-scope perms
    const badScope = perms.filter((p: PermRow) => isAdminScope ? false : p.scope !== 'org');
    if (badScope.length) {
      res.status(400).json({ error: `Cannot assign admin-scope permissions to an org role: ${badScope.map((p: PermRow) => p.key).join(', ')}` });
      return;
    }

    const role = await prisma.role.create({
      data: {
        orgId,
        key,
        name,
        description: description || null,
        scope: isAdminScope ? 'admin' : 'org',
        status,
        isSystem: false,
        rolePermissions: {
          create: perms.map((p: PermRow) => ({ permissionId: p.id })),
        },
      },
    });

    logAudit(req, 'create', 'role', role.id, {
      key: role.key, name: role.name, scope: role.scope,
      permissionCount: perms.length,
      permissions,
    });

    res.status(201).json({ id: role.id, key: role.key, name: role.name });
  } catch (err) { next(err); }
}

interface UpdateRoleBody {
  name?: string;
  description?: string | null;
  permissions?: string[];
  status?: string;
}

export async function updateRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, description, permissions, status } = req.body as UpdateRoleBody;
    const role = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!role) { res.status(404).json({ error: 'Role not found' }); return; }

    // Scope guard.
    if (req.user?.role !== 'superadmin') {
      // Custom org role → must belong to caller's org
      if (role.orgId && role.orgId !== req.orgId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      // Admin-scope system role → superadmin only
      if (role.isSystem && role.scope === 'admin') {
        res.status(403).json({ error: 'Admin-scope system roles require superadmin' });
        return;
      }
    }

    const data: Prisma.RoleUpdateInput = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (status !== undefined && ['active','inactive'].includes(status)) data.status = status;

    await prisma.role.update({ where: { id: role.id }, data });

    // Flag system roles as customized via raw SQL.
    if (role.isSystem) {
      await prisma.$executeRaw`UPDATE roles SET "isCustomized" = true WHERE id = ${role.id}`
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('isCustomized flag update skipped:', message);
        });
    }

    let permissionDiff: { added: string[]; removed: string[] } | null = null;
    if (Array.isArray(permissions)) {
      const perms = await prisma.permission.findMany({
        where: { key: { in: permissions } },
        select: { id: true, scope: true, key: true },
      });
      type PermRow = (typeof perms)[number];
      const badScope = perms.filter((p: PermRow) => role.scope !== p.scope);
      if (badScope.length) {
        res.status(400).json({ error: `Permission scope mismatch: ${badScope.map((p: PermRow) => p.key).join(', ')}` });
        return;
      }

      // Snapshot existing permission keys for the diff
      const existingPerms = await prisma.rolePermission.findMany({
        where: { roleId: role.id },
        include: { permission: { select: { key: true } } },
      });
      type ExistingPermRow = (typeof existingPerms)[number];
      const before = existingPerms.map((rp: ExistingPermRow) => rp.permission.key).sort();
      const after  = perms.map((p: PermRow) => p.key).sort();
      const added   = after.filter((k: string) => !before.includes(k));
      const removed = before.filter((k: string) => !after.includes(k));
      if (added.length || removed.length) {
        permissionDiff = { added, removed };
      }

      // Replace all permissions
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (perms.length) {
        await prisma.rolePermission.createMany({
          data: perms.map((p: PermRow) => ({ roleId: role.id, permissionId: p.id })),
        });
      }
    }

    // Build before/after diff for role metadata fields
    const diff: Record<string, unknown> = {};
    const roleRec = role as unknown as Record<string, unknown>;
    const dataRec = data as unknown as Record<string, unknown>;
    for (const k of Object.keys(dataRec)) {
      if (String(roleRec[k] ?? '') !== String(dataRec[k] ?? '')) {
        diff[k] = { before: roleRec[k], after: dataRec[k] };
      }
    }
    if (permissionDiff) diff.permissions = permissionDiff;

    if (Object.keys(diff).length > 0) {
      logAudit(req, 'update', 'role', role.id, {
        key: role.key, name: role.name, changes: diff,
      });
    }

    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function deleteRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { userRoles: true } } },
    });
    if (!role) { res.status(404).json({ error: 'Role not found' }); return; }
    if (role.isSystem) { res.status(400).json({ error: 'System roles cannot be deleted' }); return; }

    if (req.user?.role !== 'superadmin') {
      if (!role.orgId || role.orgId !== req.orgId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    }

    if (role._count.userRoles > 0) {
      res.status(400).json({
        error: `Role is assigned to ${role._count.userRoles} user(s). Unassign before deleting.`,
      });
      return;
    }

    await prisma.role.delete({ where: { id: role.id } });
    logAudit(req, 'delete', 'role', role.id, { key: role.key, name: role.name });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── User-role assignment ───────────────────────────────────────────────
export async function getUserRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.params.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, orgId: true, role: true },
    });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    if (req.user?.role !== 'superadmin' && user.orgId !== req.orgId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const userRoles = await prisma.userRole.findMany({
      where: { userId },
      include: { role: { select: { id: true, key: true, name: true, scope: true, isSystem: true } } },
    });
    type UserRoleRow = (typeof userRoles)[number];
    res.json({
      legacyRole: user.role,
      roles: userRoles.map((ur: UserRoleRow) => ur.role),
    });
  } catch (err) { next(err); }
}

export async function setUserRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.params.userId;
    const { roleIds = [] } = req.body as { roleIds?: string[] };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, orgId: true, role: true },
    });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    if (req.user?.role !== 'superadmin' && user.orgId !== req.orgId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Validate the target roles exist and are assignable by this caller
    const targetRoles = await prisma.role.findMany({ where: { id: { in: roleIds } } });
    if (targetRoles.length !== roleIds.length) {
      res.status(400).json({ error: 'One or more roles not found' });
      return;
    }
    for (const r of targetRoles) {
      if (r.status !== 'active') {
        res.status(400).json({ error: `Role "${r.name}" is inactive` });
        return;
      }
      // Org admins can only assign roles in their own org (or global system roles)
      if (req.user?.role !== 'superadmin') {
        if (r.orgId && r.orgId !== req.orgId) {
          res.status(403).json({ error: `Cannot assign role "${r.name}" from another org` });
          return;
        }
        if (r.scope === 'admin') {
          res.status(403).json({ error: 'Admin-scope roles require superadmin' });
          return;
        }
      }
    }

    // Snapshot previous assignment for audit diff
    const previous = await prisma.userRole.findMany({
      where: { userId },
      include: { role: { select: { key: true, name: true } } },
    });
    type PreviousRow = (typeof previous)[number];
    const prevKeys = previous.map((ur: PreviousRow) => ur.role.key).sort();
    const nextKeys = targetRoles.map((r: { key: string }) => r.key).sort();
    const added   = nextKeys.filter((k: string) => !prevKeys.includes(k));
    const removed = prevKeys.filter((k: string) => !nextKeys.includes(k));

    // Replace the user's role set
    await prisma.userRole.deleteMany({ where: { userId } });
    if (roleIds.length) {
      await prisma.userRole.createMany({
        data: roleIds.map((roleId: string) => ({ userId, roleId })),
        skipDuplicates: true,
      });
    }

    if (added.length || removed.length) {
      logAudit(req, 'update', 'user_roles', userId, {
        changes: { roles: { added, removed } },
      });
    }

    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Current user — "me" endpoint for permission refresh ────────────────
export async function getMyPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { computeUserPermissions } = await import('../rbac/permissionService.js');
    const permissions = await computeUserPermissions(req.user as Parameters<typeof computeUserPermissions>[0]);
    res.json({
      id: req.user!.id, name: req.user!.name, email: req.user!.email,
      role: req.user!.role, orgId: req.user!.orgId, permissions,
    });
  } catch (err) { next(err); }
}
