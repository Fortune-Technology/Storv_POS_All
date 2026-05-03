/**
 * User Management Controller  —  /api/users
 *
 * Manages users within an org (invite, list, role change, remove).
 * All mutations are scoped to req.orgId.
 */

import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/postgres.js';
import { syncUserDefaultRole } from '../rbac/permissionService.js';
import { validatePassword, validatePhone } from '../utils/validators.js';
import { errMsg } from '../utils/typeHelpers.js';
import { logAudit } from '../services/auditService.js';

// Role keys that cannot be assigned via Invite / Role-change UI.
// Owner is set only on org creation; superadmin is platform-level.
const FIXED_ROLE_KEYS = ['owner', 'superadmin'];

// Roles that are restricted to exactly one store.
const SINGLE_STORE_ROLE_KEYS = new Set(['cashier']);

/**
 * Verify that `roleKey` is an assignable role (system or org-custom) for
 * this org. Returns the Role row or null.
 */
async function resolveAssignableRole(orgId: string | null | undefined, roleKey: string | undefined) {
  if (!roleKey) return null;
  if (FIXED_ROLE_KEYS.includes(roleKey)) return null;
  return prisma.role.findFirst({
    where: {
      key: roleKey,
      status: 'active',
      scope: 'org',
      OR: [
        { orgId: null, isSystem: true },      // built-in system roles
        { orgId },                            // org-specific custom roles
      ],
    },
  });
}

/* ── GET /api/users  — list all users in this org ───────────────────────── */
export const getTenantUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.orgId) {
      res.status(403).json({ error: 'No organisation context.' });
      return;
    }

    // Multi-org: a user is "in this org" if they have a UserOrg row pointing
    // at req.orgId. The legacy `users.orgId` column (home org) is also
    // included so owners who haven't been backfilled yet still show up.
    type MembershipRow = { userId: string; role: string };
    const memberships = (await prisma.userOrg.findMany({
      where: { orgId: req.orgId },
      select: { userId: true, role: true },
    })) as MembershipRow[];
    const memberIds = memberships.map((m) => m.userId);
    const memberRoleByUserId: Record<string, string> = Object.fromEntries(
      memberships.map((m) => [m.userId, m.role]),
    );

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { id:    { in: memberIds } },          // explicit UserOrg membership
          { orgId: req.orgId },                   // legacy home-org users
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,        // legacy home-org role (kept for back-compat)
        orgId: true,       // legacy home-org id
        posPin: true,
        createdAt: true,
        stores: {
          select: {
            store: { select: { id: true, name: true, address: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Effective role in *this* org: UserOrg.role if present, else legacy role.
    type UserRowLike = {
      id: string;
      role: string | null;
      posPin: string | null;
      stores: Array<{ store: { id: string; name: string; address: string | null } }>;
      [k: string]: unknown;
    };
    const result = (users as UserRowLike[]).map((u) => ({
      ...u,
      _id: u.id,
      hasPIN: !!u.posPin,
      posPin: undefined,
      role: memberRoleByUserId[u.id] || u.role, // per-org effective role
      homeRole: u.role, // original legacy role, for admin visibility
      stores: u.stores.map((us) => ({ ...us.store, _id: us.store.id })),
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/users/invite  — create & add user to org ─────────────────── */
export const inviteUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.orgId) {
      res.status(403).json({ error: 'No organisation context.' });
      return;
    }

    const [userCount, org] = await Promise.all([
      prisma.user.count({ where: { orgId: req.orgId } }),
      prisma.organization.findUnique({
        where: { id: req.orgId },
        select: { maxUsers: true, plan: true },
      }),
    ]);

    if (userCount >= (org?.maxUsers ?? 5)) {
      res.status(402).json({
        error: `Your ${org?.plan} plan allows ${org?.maxUsers} users. Upgrade to invite more.`,
      });
      return;
    }

    const { firstName, lastName, name, email, phone, role, storeIds, password, pin } = req.body;

    // Require either firstName+lastName or legacy name, plus email
    if ((!firstName && !lastName && !name) || !email) {
      res.status(400).json({ error: 'Name and email are required.' });
      return;
    }

    // Email format validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Invalid email address format.' });
      return;
    }

    // Phone format validation (if provided)
    if (phone && !/^\+?[\d\s\-\(\)]{7,15}$/.test(phone.replace(/\s/g, ''))) {
      res.status(400).json({ error: 'Invalid phone number format.' });
      return;
    }

    const effectiveRole = role || 'cashier';
    const roleRow = await resolveAssignableRole(req.orgId, effectiveRole);
    if (!roleRow) {
      res.status(400).json({
        error: `Role "${effectiveRole}" is not assignable. Create it in Roles & Permissions or pick an active role.`,
      });
      return;
    }

    const storeList: string[] = Array.isArray(storeIds) ? storeIds.filter(Boolean) : [];
    if (SINGLE_STORE_ROLE_KEYS.has(effectiveRole) && storeList.length !== 1) {
      res.status(400).json({ error: `The "${roleRow.name}" role must be assigned to exactly one store.` });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      res.status(400).json({ error: 'A user with this email already exists.' });
      return;
    }

    // Build full name — prefer split fields, fall back to legacy combined name
    const nameFull = firstName && lastName
      ? `${firstName.trim()} ${lastName.trim()}`
      : (name || '').trim();

    // Password: use provided password or generate a temp one
    const tempPassword: string | null = password ? null : (Math.random().toString(36).slice(-8) + '!A1');
    const hashed = await bcrypt.hash(password || tempPassword || '', 12);

    // PIN: hash if provided and valid
    let posPin: string | null = null;
    if (pin && /^\d{4,6}$/.test(pin)) {
      posPin = await bcrypt.hash(pin, 12);
    }

    const user = await prisma.user.create({
      data: {
        name:     nameFull,
        email:    email.toLowerCase().trim(),
        phone:    phone || null,
        password: hashed,
        posPin,
        role:     effectiveRole,
        orgId:    req.orgId,
        stores:   storeList.length > 0
          ? { create: storeList.map((sid: string) => ({ storeId: sid })) }
          : undefined,
        orgs: {
          create: {
            orgId:       req.orgId,
            role:        effectiveRole,
            isPrimary:   true,
            invitedById: req.user?.id ?? null,
          },
        },
      },
    });

    await syncUserDefaultRole(user.id).catch((e: unknown) =>
      console.warn('syncUserDefaultRole:', errMsg(e)),
    );

    logAudit(req, 'create', 'user', user.id, {
      name:     user.name,
      email:    user.email,
      role:     user.role,
      storeIds: storeList,
      invited:  true,
    });

    const responseBody: { user: Record<string, unknown>; tempPassword?: string } = {
      user: {
        id:        user.id,
        _id:       user.id,
        name:      user.name,
        email:     user.email,
        role:      user.role,
        orgId:     user.orgId,
        hasPIN:    !!user.posPin,
        createdAt: user.createdAt,
      },
    };

    // Only include tempPassword in response if the caller did NOT supply a password
    if (tempPassword) {
      responseBody.tempPassword = tempPassword;
    }

    res.status(201).json(responseBody);
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/users/:id/role  — update role + store assignments ──────────── */
export const updateUserRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { role, storeIds } = req.body;

    if (role) {
      const rr = await resolveAssignableRole(req.orgId, role);
      if (!rr) {
        res.status(400).json({ error: `Role "${role}" is not assignable.` });
        return;
      }
    }

    const target = await prisma.user.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
    });
    if (!target) {
      res.status(404).json({ error: 'User not found in your organisation.' });
      return;
    }
    if (target.role === 'owner') {
      res.status(403).json({ error: 'Cannot change the role of the organisation owner.' });
      return;
    }

    const effectiveRole = role || target.role;
    const storeList: string[] | undefined = Array.isArray(storeIds) ? storeIds.filter(Boolean) : undefined;

    if (storeList !== undefined && SINGLE_STORE_ROLE_KEYS.has(effectiveRole) && storeList.length !== 1) {
      res.status(400).json({ error: `The "${effectiveRole}" role must be assigned to exactly one store.` });
      return;
    }

    const data: Record<string, unknown> = {};
    if (role) data.role = role;

    // Replace store assignments atomically
    if (storeList !== undefined) {
      await prisma.userStore.deleteMany({ where: { userId: req.params.id } });
      if (storeList.length > 0) {
        await prisma.userStore.createMany({
          data: storeList.map((sid: string) => ({ userId: req.params.id, storeId: sid })),
        });
      }
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true, name: true, email: true, role: true,
        stores: { select: { store: { select: { id: true, name: true } } } },
      },
    });

    // Keep the UserOrg row in sync with the new role for this org. Only
    // affects the current org — roles in other orgs (if any) are untouched.
    if (role) {
      await prisma.userOrg.upsert({
        where:  { userId_orgId: { userId: req.params.id, orgId: req.orgId } },
        create: { userId: req.params.id, orgId: req.orgId, role, isPrimary: true },
        update: { role },
      });
      await syncUserDefaultRole(updated.id).catch((e: unknown) =>
        console.warn('syncUserDefaultRole:', errMsg(e)),
      );
    }

    // Build a field-level diff so the audit log shows exactly what shifted —
    // role change, store-list change, or both. Skip the audit row when the
    // request was effectively a no-op (caller hit save with no changes).
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    if (role && role !== target.role) {
      changes.role = { before: target.role, after: role };
    }
    if (storeList !== undefined) {
      changes.storeIds = { before: '[updated]', after: storeList };
    }
    if (Object.keys(changes).length > 0) {
      logAudit(req, 'update', 'user', updated.id, {
        name: updated.name,
        email: updated.email,
        changes,
      });
    }

    res.json({
      ...updated,
      _id: updated.id,
      stores: updated.stores.map((us: { store: { id: string; name: string } }) => ({
        ...us.store,
        _id: us.store.id,
      })),
    });
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/users/:id  — revoke access to this org ────────────────── */
// Multi-org: we only revoke access to the *current* org, not the user
// account itself. If the user is a member of other orgs they keep those.
// If this was their last membership they become access-less (but the account
// is retained so history and any in-flight tokens are preserved).
export const removeUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.params.id === req.user?.id) {
      res.status(400).json({ error: 'You cannot remove yourself.' });
      return;
    }

    // Find the target user's membership in THIS org.
    const membership = await prisma.userOrg.findUnique({
      where: { userId_orgId: { userId: req.params.id, orgId: req.orgId } },
      include: { user: { select: { name: true, orgId: true } } },
    });

    if (!membership) {
      // Fallback: older accounts whose home-org matches but have no UserOrg row.
      const legacy = await prisma.user.findFirst({
        where: { id: req.params.id, orgId: req.orgId },
        select: { id: true, name: true, role: true },
      });
      if (!legacy) {
        res.status(404).json({ error: 'User not found in your organisation.' });
        return;
      }
      if (legacy.role === 'owner') {
        res.status(403).json({ error: 'Cannot remove the organisation owner.' });
        return;
      }
      // Nothing to delete from UserOrg; just strip UserStore rows for this org.
      await prisma.userStore.deleteMany({
        where: { userId: req.params.id, store: { orgId: req.orgId } },
      });
      logAudit(req, 'delete', 'user', legacy.id, {
        name: legacy.name,
        legacy: true,
        reason: 'removed_from_org',
      });
      res.json({ message: `${legacy.name} has been removed from the organisation.` });
      return;
    }

    if (membership.role === 'owner') {
      res.status(403).json({ error: 'Cannot remove the organisation owner.' });
      return;
    }

    // Revoke access: UserOrg row + any UserStore rows whose store lives in this org.
    await prisma.$transaction([
      prisma.userOrg.delete({
        where: { userId_orgId: { userId: req.params.id, orgId: req.orgId } },
      }),
      prisma.userStore.deleteMany({
        where: { userId: req.params.id, store: { orgId: req.orgId } },
      }),
    ]);

    logAudit(req, 'delete', 'user', req.params.id, {
      name: membership.user.name,
      role: membership.role,
      reason: 'removed_from_org',
    });

    res.json({ message: `${membership.user.name} has been removed from the organisation.` });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// SELF-SERVICE PROFILE — any authenticated user can manage their OWN
// identity (name, phone, password). Email and role changes are deliberately
// excluded — those require admin action (email change has verification /
// invitation implications; role change is an RBAC decision).
//
// Used by the portal's "My Profile" tab in AccountHub — accessible to
// every logged-in user regardless of `users.view`, so staff/cashiers can
// update their own details without needing admin to edit them.
// ─────────────────────────────────────────────────────────────────────────

// ── GET /api/users/me ───────────────────────────────────────────────────
export const getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authorized' });
      return;
    }
    const user = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: {
        id: true, name: true, email: true, phone: true,
        role: true, status: true, orgId: true,
        storeLatitude: true, storeLongitude: true, storeTimezone: true, storeAddress: true,
        createdAt: true,
        posPin: true,   // boolean indicator only — hashed value never returned
      },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    type OrgRow = {
      role: string;
      isPrimary: boolean;
      organization: { id: string; name: string; slug: string };
    };
    const orgs = (await prisma.userOrg.findMany({
      where: { userId: user.id },
      select: {
        role: true,
        isPrimary: true,
        organization: { select: { id: true, name: true, slug: true } },
      },
    })) as OrgRow[];

    res.json({
      ...user,
      posPin: undefined, // never leak the hash
      hasPin: !!user.posPin, // just surface presence
      orgs: orgs.map((o) => ({
        orgId: o.organization.id,
        orgName: o.organization.name,
        orgSlug: o.organization.slug,
        role: o.role,
        isPrimary: o.isPrimary,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// ── PUT /api/users/me ───────────────────────────────────────────────────
// Body: { name?, phone? }
// Deliberately narrow — email/role/orgId changes go through admin flows.
export const updateMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authorized' });
      return;
    }
    const { name, phone } = req.body;
    const patch: Record<string, unknown> = {};

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (trimmed.length < 2) {
        res.status(400).json({ error: 'Name must be at least 2 characters.' });
        return;
      }
      if (trimmed.length > 100) {
        res.status(400).json({ error: 'Name must be 100 characters or fewer.' });
        return;
      }
      patch.name = trimmed;
    }

    if (phone !== undefined) {
      const cleaned: string | null = phone === null || phone === '' ? null : String(phone).trim();
      // validatePhone returns null on success, an error string on failure.
      // Empty/null passes through as "optional".
      if (cleaned) {
        const phoneErr = validatePhone(cleaned);
        if (phoneErr) {
          res.status(400).json({ error: phoneErr });
          return;
        }
      }
      patch.phone = cleaned;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'Nothing to update.' });
      return;
    }

    // Capture the before-state for the audit diff before we mutate.
    const before = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { name: true, phone: true },
    });

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: patch,
      select: { id: true, name: true, email: true, phone: true, role: true, orgId: true },
    });

    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const k of Object.keys(patch)) {
      const b = (before as Record<string, unknown> | null)?.[k];
      const a = patch[k];
      if (String(b ?? '') !== String(a ?? '')) changes[k] = { before: b ?? null, after: a ?? null };
    }
    if (Object.keys(changes).length > 0) {
      logAudit(req, 'update', 'user_profile', updated.id, {
        email: updated.email,
        self: true,
        changes,
      });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

// ── PUT /api/users/me/password ──────────────────────────────────────────
// Body: { currentPassword, newPassword }
// Requires current password — even a stolen session can't pivot to a
// password rotation without knowing the current secret.
export const changeMyPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authorized' });
      return;
    }
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current and new password are required.' });
      return;
    }

    const pwErr = validatePassword(newPassword);
    if (pwErr) {
      res.status(400).json({ error: pwErr });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, password: true },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      res.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }

    // Reject no-op rotations — blocks accidental "type same password twice"
    // and nudges toward an actual rotation.
    const sameAsOld = await bcrypt.compare(newPassword, user.password);
    if (sameAsOld) {
      res.status(400).json({ error: 'New password must be different from current password.' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: newHash } });

    // Security event — never log the password value, just that it rotated.
    logAudit(req, 'password_change', 'user', user.id, { self: true });

    res.json({ success: true, message: 'Password updated.' });
  } catch (err) {
    next(err);
  }
};
