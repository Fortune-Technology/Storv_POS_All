/**
 * Admin Controller  —  /api/admin
 *
 * System-level admin endpoints for superadmin users.
 * NOT scoped to any org — these manage ALL users, orgs, content.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {
  sendUserApproved,
  sendUserRejected,
  sendUserSuspended,
  sendTicketAssigned,
  sendTicketUnassigned,
  sendTicketStatusChangedToAssignee,
  sendTicketReplyToAssignee,
  type TicketSummary,
} from '../services/emailService.js';
import { sendImplementationPinEmail } from '../services/notifications/email.js';
import { grantHardwareAccess, revokeHardwareAccess } from '../services/implementationPin/service.js';
import { syncUserDefaultRole } from '../rbac/permissionService.js';
import { logAudit } from '../services/auditService.js';
import { computeDiff, hasChanges } from '../services/auditDiff.js';
import { validatePassword } from '../utils/validators.js';

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/dashboard */
export const getDashboardStats = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers, pendingUsers, totalOrgs, activeOrgs, openTickets,
      recentUsers, recentOrgs, recentTickets,
      usersByRole, orgsByPlan,
      signupUsers, signupOrgs,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'pending' } }),
      prisma.organization.count(),
      prisma.organization.count({ where: { isActive: true } }),
      prisma.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
      // Recent users
      prisma.user.findMany({
        take: 5, orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
      }),
      // Recent orgs
      prisma.organization.findMany({
        take: 5, orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, plan: true, createdAt: true, _count: { select: { users: true, stores: true } } },
      }),
      // Recent tickets
      prisma.supportTicket.findMany({
        take: 5, orderBy: { createdAt: 'desc' },
        select: { id: true, subject: true, status: true, priority: true, createdAt: true },
      }).catch(() => [] as Array<{ id: string; subject: string; status: string; priority: string; createdAt: Date }>),
      // Users by role
      prisma.user.groupBy({ by: ['role'], _count: true }).catch(() => [] as Array<{ role: string; _count: number }>),
      // Orgs by plan
      prisma.organization.groupBy({ by: ['plan'], _count: true }).catch(() => [] as Array<{ plan: string | null; _count: number }>),
      // Signups last 7 days (users)
      prisma.user.groupBy({
        by: ['createdAt'],
        where: { createdAt: { gte: sevenDaysAgo } },
        _count: true,
      }).catch(() => [] as Array<{ createdAt: Date; _count: number }>),
      // Signups last 7 days (orgs)
      prisma.organization.groupBy({
        by: ['createdAt'],
        where: { createdAt: { gte: sevenDaysAgo } },
        _count: true,
      }).catch(() => [] as Array<{ createdAt: Date; _count: number }>),
    ]);
    type RecentOrgRow = (typeof recentOrgs)[number];

    // Build 7-day chart data
    const usersByDay: Record<string, number> = {};
    for (const u of signupUsers as Array<{ createdAt: Date; _count: number }>) {
      const day = new Date(u.createdAt).toISOString().split('T')[0];
      usersByDay[day] = (usersByDay[day] || 0) + u._count;
    }
    const orgsByDay: Record<string, number> = {};
    for (const o of signupOrgs as Array<{ createdAt: Date; _count: number }>) {
      const day = new Date(o.createdAt).toISOString().split('T')[0];
      orgsByDay[day] = (orgsByDay[day] || 0) + o._count;
    }
    const chartData: Array<{ date: string; users: number; orgs: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split('T')[0];
      chartData.push({ date: key, users: usersByDay[key] || 0, orgs: orgsByDay[key] || 0 });
    }

    res.json({
      success: true,
      data: {
        totalUsers, pendingUsers, totalOrgs, activeOrgs, openTickets,
        recentUsers,
        recentOrgs: (recentOrgs as RecentOrgRow[]).map((o) => ({ ...o, userCount: o._count.users, storeCount: o._count.stores, _count: undefined })),
        recentTickets,
        chartData,
        usersByRole: (usersByRole as Array<{ role: string; _count: number }>).reduce<Record<string, number>>((acc, r) => { acc[r.role] = r._count; return acc; }, {}),
        orgsByPlan: (orgsByPlan as Array<{ plan: string | null; _count: number }>).reduce<Record<string, number>>((acc, p) => { acc[p.plan || 'none'] = p._count; return acc; }, {}),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// USER MANAGEMENT (cross-org)
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/users?status=pending&search=john&page=1&limit=25
 *
 * Optional `orgId` filter narrows to users in that org (via UserOrg or
 * legacy User.orgId). Optional `storeId` narrows to users bound to that
 * store via UserStore. Both are used by the unified Org→Store→User page
 * to render nested user lists.
 */
export const getAllUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { status?: string; search?: string; page?: string; limit?: string; orgId?: string; storeId?: string };
    const { status, search, orgId, storeId } = q;
    const page = q.page || '1';
    const limit = q.limit || '25';
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: Prisma.UserWhereInput = {};
    if (status) where.status = status;
    if (orgId) {
      where.OR = [
        { orgId },
        { orgs: { some: { orgId } } },
      ];
    }
    if (storeId) {
      where.stores = { some: { storeId } };
    }
    if (search) {
      const searchOR: Prisma.UserWhereInput[] = [
        { name:  { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
      // If we already used OR for orgId scoping, AND the search OR onto it.
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchOR }];
        delete where.OR;
      } else {
        where.OR = searchOR;
      }
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, phone: true,
          role: true, status: true, orgId: true, createdAt: true,
          // S78 — surface the hardware-access flag so admin user list can
          // render the toggle inline. The encrypted PIN is NEVER returned
          // here; only the boolean flag.
          canConfigureHardware: true,
          organization: { select: { id: true, name: true, slug: true, plan: true, isActive: true } },
          stores: { select: { store: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.user.count({ where }),
    ]);
    type UserRow = (typeof users)[number];

    interface StoreRel { store: { id: string; name: string } | null }
    const result = (users as UserRow[]).map((u) => ({
      ...u,
      stores: ((u.stores || []) as StoreRel[]).map((s) => s.store),
    }));

    res.json({ success: true, data: result, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/users/:id/approve */
export const approveUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data:  { status: 'active' },
      select: { id: true, name: true, email: true, status: true, orgId: true },
    });

    // Also activate the user's organization (if it was created during onboarding)
    if (user.orgId && user.orgId !== 'default') {
      await prisma.organization.update({
        where: { id: user.orgId },
        data:  { isActive: true },
      });
    }

    sendUserApproved(user.email, user.name);
    logAudit(req, 'approve', 'user', user.id, { name: user.name, email: user.email });
    res.json({ success: true, data: user, message: 'User approved successfully' });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/users/:id/suspend */
export const suspendUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data:  { status: 'suspended' },
      select: { id: true, name: true, email: true, status: true },
    });

    sendUserSuspended(user.email, user.name);
    logAudit(req, 'suspend', 'user', user.id, { name: user.name, email: user.email });
    res.json({ success: true, data: user, message: 'User suspended' });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/users/:id/reject */
export const rejectUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data:  { status: 'suspended' },
      select: { id: true, name: true, email: true, status: true, orgId: true },
    });

    // Deactivate the org too if it exists
    if (user.orgId && user.orgId !== 'default') {
      await prisma.organization.update({
        where: { id: user.orgId },
        data:  { isActive: false, deactivatedAt: new Date() },
      }).catch(() => { /* ignore if org doesn't exist */ });
    }

    sendUserRejected(user.email, user.name);
    logAudit(req, 'reject', 'user', user.id, { name: user.name, email: user.email });
    res.json({ success: true, data: user, message: 'User rejected' });
  } catch (error) {
    next(error);
  }
};

/**
 * Generate a cryptographically random 16-char password that satisfies the
 * policy in utils/validators.js (upper, lower, digit, special).
 */
function generateTempPassword(): string {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower   = 'abcdefghjkmnpqrstuvwxyz';
  const digits  = '23456789';
  const special = '!@#$%^&*-_+=';
  const all = upper + lower + digits + special;
  const pick = (set: string): string => set[crypto.randomInt(0, set.length)];
  // Guarantee one of each class, then fill to length 16
  const chars: string[] = [pick(upper), pick(lower), pick(digits), pick(special)];
  while (chars.length < 16) chars.push(pick(all));
  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/* POST /api/admin/users — create user */
interface CreateUserBody {
  name?: string;
  email?: string;
  phone?: string | null;
  role?: string;
  orgId?: string;
  status?: string;
}

export const createUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as CreateUserBody & { password?: string; storeId?: string };
    const { name, email, phone, role, orgId, status, password, storeId } = body;
    if (!name || !email || !orgId) { res.status(400).json({ error: 'Name, email, and organization are required' }); return; }

    // Only existing superadmins can mint new superadmin accounts. The route
    // guard already gates the whole admin panel to superadmin, but this is
    // belt-and-suspenders against any future relaxation of the route guard.
    if (role === 'superadmin' && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Only a superadmin can create another superadmin user.' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (existing) { res.status(400).json({ error: 'A user with this email already exists' }); return; }

    // If admin supplied a password, validate against the policy and use it.
    // Otherwise generate a random one and return it once for out-of-band delivery.
    let plainTemp: string | null = null;
    let chosen: string;
    if (password && password.length > 0) {
      const pwErr = validatePassword(password);
      if (pwErr) { res.status(400).json({ error: pwErr }); return; }
      chosen = password;
    } else {
      plainTemp = generateTempPassword();
      chosen = plainTemp;
    }
    const hashed = await bcrypt.hash(chosen, 12);
    const user = await prisma.user.create({
      data: {
        name:   name.trim(),
        email:  email.trim().toLowerCase(),
        phone:  phone || null,
        password: hashed,
        role:   role || 'staff',
        orgId,
        status: status || 'active',
        // Multi-org: seed the UserOrg membership row so the new user shows
        // up in the portal's user list immediately (portal filters by UserOrg).
        orgs: {
          create: {
            orgId,
            role:        role || 'staff',
            isPrimary:   true,
            invitedById: req.user?.id ?? null,
          },
        },
      },
      select: { id: true, name: true, email: true, role: true, status: true, orgId: true, createdAt: true },
    });

    // Optional: bind to a specific store. Used by the unified Org→Store→User
    // page when creating a user inside a particular store. Best-effort.
    if (storeId) {
      try {
        await prisma.userStore.create({ data: { userId: user.id, storeId } });
      } catch (err) {
        console.warn('createUser: failed to bind UserStore:', (err as Error).message);
      }
    }

    await syncUserDefaultRole(user.id).catch((err: Error) => console.warn('syncUserDefaultRole:', err.message));

    logAudit(req, 'create', 'user', user.id, {
      name: user.name,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
      storeId: storeId ?? null,
      adminCreated: true,
      passwordSetByAdmin: !plainTemp,
    });

    // If admin set the password explicitly, don't echo it back. If we
    // generated one, return it ONCE for out-of-band delivery.
    res.status(201).json({
      success: true,
      data: user,
      tempPassword: plainTemp,
      notice: plainTemp
        ? 'Deliver this temporary password to the user securely. It will not be shown again.'
        : 'User created with the password you supplied.',
    });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/users/:id — update user */
interface UpdateUserBody {
  name?: string;
  email?: string;
  phone?: string | null;
  role?: string;
  status?: string;
  orgId?: string;
  // S78 — superadmin-only flag. Flipping true → auto-generates a fresh
  // implementation PIN + emails the user. Flipping false → clears the PIN.
  canConfigureHardware?: boolean;
}

export const updateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as UpdateUserBody;
    const { name, email, phone, role, status, orgId, canConfigureHardware } = body;

    // Only existing superadmins can promote a user to superadmin.
    if (role === 'superadmin' && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Only a superadmin can promote a user to superadmin.' });
      return;
    }

    // S78 — only superadmins can grant hardware-configuration access.
    // The flag protects internal credentials, so the gate to grant it is
    // narrow on purpose — admin/owner can't elevate their own team here.
    if (canConfigureHardware !== undefined && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Only a superadmin can change canConfigureHardware.' });
      return;
    }

    // Snapshot before-state for the audit diff. Skip orgId on the patch
    // object (it's wired to a relation) — we'll capture the org change
    // separately in the diff payload.
    const before = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { name: true, email: true, phone: true, role: true, status: true, orgId: true, canConfigureHardware: true },
    });

    const data: Prisma.UserUpdateInput = {};
    if (name !== undefined)   data.name = name;
    if (email !== undefined)  data.email = email;
    if (phone !== undefined)  data.phone = phone;
    if (role !== undefined)   data.role = role;
    if (status !== undefined) data.status = status;
    if (orgId !== undefined)  data.organization = { connect: { id: orgId } };
    // S78 — flag toggle is handled via service helpers below (which also
    // generate / clear the encrypted PIN). Don't write it directly here.

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, role: true, status: true, orgId: true, canConfigureHardware: true },
    });

    // S78 — handle the canConfigureHardware flip AFTER the main update so
    // the order stays clean. grantHardwareAccess is idempotent (no-op if
    // already true) and revokeHardwareAccess is safe on a user that
    // never had it granted.
    if (canConfigureHardware !== undefined && canConfigureHardware !== before?.canConfigureHardware) {
      if (canConfigureHardware) {
        const newPin = await grantHardwareAccess(user.id);
        if (newPin) {
          // Fire welcome email — best-effort; the panel still surfaces the
          // PIN at /users/me/implementation-pin so a missed email isn't fatal.
          sendImplementationPinEmail(user.email, user.name, newPin, 'granted').catch((err) =>
            console.warn('[adminController.updateUser] grant email failed:', (err as Error).message)
          );
        }
      } else {
        await revokeHardwareAccess(user.id);
      }
    }

    // Keep the primary UserOrg row in sync with admin-made changes.
    if (orgId !== undefined || role !== undefined) {
      const effectiveRole = role !== undefined ? role : user.role;
      const effectiveOrg  = orgId !== undefined ? orgId : user.orgId;
      if (effectiveOrg) {
        await prisma.userOrg.upsert({
          where:  { userId_orgId: { userId: user.id, orgId: effectiveOrg } },
          create: { userId: user.id, orgId: effectiveOrg, role: effectiveRole, isPrimary: true, invitedById: req.user?.id ?? null },
          update: { role: effectiveRole, isPrimary: true },
        });
      }
    }

    if (role !== undefined) {
      await syncUserDefaultRole(user.id).catch((err: Error) => console.warn('syncUserDefaultRole:', err.message));
    }

    // Build a flat patch view (the same fields the client sent) for the diff.
    const patchView: Record<string, unknown> = {};
    if (name   !== undefined) patchView.name   = name;
    if (email  !== undefined) patchView.email  = email;
    if (phone  !== undefined) patchView.phone  = phone;
    if (role   !== undefined) patchView.role   = role;
    if (status !== undefined) patchView.status = status;
    if (orgId  !== undefined) patchView.orgId  = orgId;
    if (canConfigureHardware !== undefined) patchView.canConfigureHardware = canConfigureHardware;

    const diff = computeDiff(before as unknown as Record<string, unknown>, patchView);
    if (hasChanges(diff)) {
      logAudit(req, 'update', 'user', user.id, {
        name: user.name,
        email: user.email,
        adminAction: true,
        changes: diff,
      });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    const e = error as { code?: string };
    if (e.code === 'P2002') { res.status(400).json({ error: 'Email already in use' }); return; }
    next(error);
  }
};

/* DELETE /api/admin/users/:id — soft delete (suspend) */
export const softDeleteUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { status: 'suspended' },
      select: { id: true, name: true, email: true, status: true },
    });
    logAudit(req, 'delete', 'user', user.id, {
      name: user.name,
      email: user.email,
      reason: 'soft_delete_suspend',
    });
    res.json({ success: true, data: user, message: 'User suspended (soft delete)' });
  } catch (error) {
    next(error);
  }
};

/* POST /api/admin/users/:id/impersonate — login as user */
export const impersonateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, email: true, role: true, status: true, orgId: true,
                stores: { select: { storeId: true } } },
    });
    if (!target) { res.status(404).json({ error: 'User not found' }); return; }
    if (target.role === 'superadmin') { res.status(403).json({ error: 'Cannot impersonate another superadmin' }); return; }

    // Include orgId in the JWT payload — login tokens carry it (see
    // authController.generateToken callsites) and downstream services
    // (ecom-backend protect middleware in particular) read req.user.orgId
    // straight off the decoded token. Without it, impersonated sessions
    // hit 401 on cross-service calls because the X-Org-Id-header fallback
    // is fragile (omitted on direct fetches, lost across redirects).
    const token = jwt.sign(
      {
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
        orgId: target.orgId,
        impersonatedBy: req.user!.id,
      },
      process.env.JWT_SECRET as jwt.Secret,
      { expiresIn: '8h' } as jwt.SignOptions,
    );

    // Security-sensitive event — record exactly which superadmin assumed
    // which user's identity. Inferred actor = req.user (the superadmin).
    logAudit(req, 'impersonate', 'user', target.id, {
      targetName:  target.name,
      targetEmail: target.email,
      targetRole:  target.role,
      targetOrgId: target.orgId,
    });

    type StoreLink = { storeId: string };
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: target.id, name: target.name, email: target.email,
          role: target.role, status: target.status, orgId: target.orgId,
          storeIds: ((target.stores || []) as StoreLink[]).map((s) => s.storeId),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// ORGANIZATION MANAGEMENT
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/organizations?search=acme&page=1&limit=25 */
export const getAllOrganizations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { search?: string; page?: string; limit?: string };
    const { search } = q;
    const page = q.page || '1';
    const limit = q.limit || '25';
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: Prisma.OrganizationWhereInput = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [orgs, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        include: {
          _count: { select: { users: true, stores: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.organization.count({ where }),
    ]);

    res.json({ success: true, data: orgs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/organizations/:id */
export const updateOrganization = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { plan?: string; maxStores?: number | string; maxUsers?: number | string; isActive?: boolean };
    const { plan, maxStores, maxUsers, isActive } = body;

    const before = await prisma.organization.findUnique({
      where: { id: req.params.id },
      select: { plan: true, maxStores: true, maxUsers: true, isActive: true, name: true },
    });

    const data: Prisma.OrganizationUpdateInput = {};
    if (plan !== undefined)      data.plan = plan;
    if (maxStores !== undefined)  data.maxStores = parseInt(String(maxStores));
    if (maxUsers !== undefined)   data.maxUsers = parseInt(String(maxUsers));
    if (isActive !== undefined) {
      data.isActive = isActive;
      data.deactivatedAt = isActive ? null : new Date();
    }

    const org = await prisma.organization.update({
      where: { id: req.params.id },
      data,
    });

    // Build a flat patch view for the diff (skip deactivatedAt — derived).
    const patchView: Record<string, unknown> = {};
    if (plan !== undefined)      patchView.plan      = plan;
    if (maxStores !== undefined) patchView.maxStores = parseInt(String(maxStores));
    if (maxUsers !== undefined)  patchView.maxUsers  = parseInt(String(maxUsers));
    if (isActive !== undefined)  patchView.isActive  = isActive;

    const diff = computeDiff(before as unknown as Record<string, unknown>, patchView);
    if (hasChanges(diff)) {
      logAudit(req, 'update', 'organization', org.id, { name: org.name, changes: diff });
    }

    res.json({ success: true, data: org });
  } catch (error) {
    next(error);
  }
};

/* POST /api/admin/organizations — create org
 *
 * Optionally creates an owner user atomically when ownerEmail + ownerPassword
 * + ownerName are supplied (used by the unified Org→Store→User admin page so
 * a brand-new org has someone who can log in immediately).
 */
export const createOrganization = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as {
      name?: string; slug?: string; plan?: string; billingEmail?: string;
      maxStores?: number | string; maxUsers?: number | string;
      ownerName?: string; ownerEmail?: string; ownerPassword?: string;
    };
    const { name, slug, plan, billingEmail, maxStores, maxUsers, ownerName, ownerEmail, ownerPassword } = body;
    if (!name || !slug) { res.status(400).json({ error: 'Name and slug are required' }); return; }

    // If owner credentials are supplied, validate up-front before creating
    // the org so we don't end up with an orphan org if the owner save fails.
    let ownerHashed: string | null = null;
    if (ownerEmail || ownerPassword || ownerName) {
      if (!ownerEmail || !ownerPassword || !ownerName) {
        res.status(400).json({ error: 'Owner name, email, and password must all be provided together' }); return;
      }
      const pwErr = validatePassword(ownerPassword);
      if (pwErr) { res.status(400).json({ error: pwErr }); return; }
      const existing = await prisma.user.findUnique({ where: { email: ownerEmail.trim().toLowerCase() } });
      if (existing) { res.status(400).json({ error: 'A user with the owner email already exists' }); return; }
      ownerHashed = await bcrypt.hash(ownerPassword, 12);
    }

    const org = await prisma.organization.create({
      data: {
        name, slug,
        plan: plan || 'trial',
        billingEmail: billingEmail || null,
        maxStores: maxStores ? parseInt(String(maxStores)) : 1,
        maxUsers: maxUsers ? parseInt(String(maxUsers)) : 3,
      },
    });

    let owner = null;
    if (ownerHashed && ownerEmail && ownerName) {
      owner = await prisma.user.create({
        data: {
          name:     ownerName.trim(),
          email:    ownerEmail.trim().toLowerCase(),
          password: ownerHashed,
          role:     'owner',
          status:   'active',
          orgId:    org.id,
          orgs: { create: { orgId: org.id, role: 'owner', isPrimary: true, invitedById: req.user?.id ?? null } },
        },
        select: { id: true, name: true, email: true, role: true, status: true },
      });
      await syncUserDefaultRole(owner.id).catch((err: Error) => console.warn('syncUserDefaultRole:', err.message));
    }

    logAudit(req, 'create', 'organization', org.id, {
      name: org.name,
      slug: org.slug,
      plan: org.plan,
      ownerCreated: !!owner,
    });

    res.status(201).json({ success: true, data: org, owner });
  } catch (error) {
    const e = error as { code?: string };
    if (e.code === 'P2002') { res.status(400).json({ error: 'An organization with this slug already exists' }); return; }
    next(error);
  }
};

/* DELETE /api/admin/organizations/:id — soft delete */
export const softDeleteOrganization = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const org = await prisma.organization.update({
      where: { id: req.params.id },
      data: { isActive: false, deactivatedAt: new Date() },
    });
    logAudit(req, 'delete', 'organization', org.id, {
      name: org.name,
      reason: 'soft_delete_deactivate',
    });
    res.json({ success: true, data: org, message: 'Organization deactivated' });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// STORE MANAGEMENT (cross-org)
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/stores?search=main&page=1&limit=25 */
export const getAllStores = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { search?: string; page?: string; limit?: string; orgId?: string };
    const { search, orgId } = q;
    const page = q.page || '1';
    const limit = q.limit || '25';
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where: Prisma.StoreWhereInput = {};
    if (orgId) where.orgId = orgId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [stores, total] = await Promise.all([
      prisma.store.findMany({
        where,
        include: {
          organization: { select: { id: true, name: true } },
          _count: { select: { users: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.store.count({ where }),
    ]);

    res.json({ success: true, data: stores, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    next(error);
  }
};

/* POST /api/admin/stores — create store
 *
 * Optionally creates a manager user atomically when managerEmail +
 * managerPassword + managerName are supplied. The new user is bound to
 * this specific store via UserStore.
 */
export const createStore = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as {
      name?: string; orgId?: string; address?: string; stationCount?: number | string;
      managerName?: string; managerEmail?: string; managerPassword?: string;
    };
    const { name, orgId, address, stationCount, managerName, managerEmail, managerPassword } = body;
    if (!name || !orgId) { res.status(400).json({ error: 'Name and organization are required' }); return; }

    let managerHashed: string | null = null;
    if (managerEmail || managerPassword || managerName) {
      if (!managerEmail || !managerPassword || !managerName) {
        res.status(400).json({ error: 'Manager name, email, and password must all be provided together' }); return;
      }
      const pwErr = validatePassword(managerPassword);
      if (pwErr) { res.status(400).json({ error: pwErr }); return; }
      const existing = await prisma.user.findUnique({ where: { email: managerEmail.trim().toLowerCase() } });
      if (existing) { res.status(400).json({ error: 'A user with the manager email already exists' }); return; }
      managerHashed = await bcrypt.hash(managerPassword, 12);
    }

    const store = await prisma.store.create({
      data: { name, orgId, address: address || null, stationCount: stationCount ? parseInt(String(stationCount)) : 1 },
    });

    let manager = null;
    if (managerHashed && managerEmail && managerName) {
      manager = await prisma.user.create({
        data: {
          name:     managerName.trim(),
          email:    managerEmail.trim().toLowerCase(),
          password: managerHashed,
          role:     'manager',
          status:   'active',
          orgId,
          orgs:   { create: { orgId, role: 'manager', isPrimary: true, invitedById: req.user?.id ?? null } },
          stores: { create: { storeId: store.id } },
        },
        select: { id: true, name: true, email: true, role: true, status: true },
      });
      await syncUserDefaultRole(manager.id).catch((err: Error) => console.warn('syncUserDefaultRole:', err.message));
    }

    logAudit(req, 'create', 'store', store.id, {
      name: store.name,
      orgId: store.orgId,
      address: store.address ?? null,
      adminCreated: true,
      managerCreated: !!manager,
    });

    res.status(201).json({ success: true, data: store, manager });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/stores/:id — update store */
export const updateStore = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { name?: string; address?: string; stationCount?: number | string; isActive?: boolean; orgId?: string };
    const { name, address, stationCount, isActive, orgId } = body;

    const before = await prisma.store.findUnique({
      where: { id: req.params.id },
      select: { name: true, address: true, stationCount: true, isActive: true, orgId: true },
    });

    const data: Prisma.StoreUpdateInput = {};
    if (name !== undefined)         data.name = name;
    if (address !== undefined)      data.address = address;
    if (stationCount !== undefined) data.stationCount = parseInt(String(stationCount));
    if (isActive !== undefined)     data.isActive = isActive;
    if (orgId !== undefined)        data.organization = { connect: { id: orgId } };

    const store = await prisma.store.update({ where: { id: req.params.id }, data });

    const patchView: Record<string, unknown> = {};
    if (name         !== undefined) patchView.name         = name;
    if (address      !== undefined) patchView.address      = address;
    if (stationCount !== undefined) patchView.stationCount = parseInt(String(stationCount));
    if (isActive     !== undefined) patchView.isActive     = isActive;
    if (orgId        !== undefined) patchView.orgId        = orgId;

    const diff = computeDiff(before as unknown as Record<string, unknown>, patchView);
    if (hasChanges(diff)) {
      logAudit(req, 'update', 'store', store.id, {
        name: store.name,
        adminAction: true,
        changes: diff,
      });
    }

    res.json({ success: true, data: store });
  } catch (error) {
    next(error);
  }
};

/* DELETE /api/admin/stores/:id — soft delete */
export const softDeleteStore = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const store = await prisma.store.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    logAudit(req, 'delete', 'store', store.id, {
      name: store.name,
      reason: 'soft_delete_deactivate',
    });
    res.json({ success: true, data: store, message: 'Store deactivated' });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// CMS PAGES
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/cms */
export const getCmsPages = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const pages = await prisma.cmsPage.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json({ success: true, data: pages });
  } catch (error) {
    next(error);
  }
};

/* POST /api/admin/cms */
interface CmsPageBody {
  slug?: string;
  title?: string;
  content?: string;
  metaTitle?: string;
  metaDesc?: string;
  published?: boolean;
  sortOrder?: number;
}

export const createCmsPage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as CmsPageBody;
    const { slug, title, content, metaTitle, metaDesc, published, sortOrder } = body;
    const page = await prisma.cmsPage.create({
      data: { slug: slug as string, title: title as string, content: content || '', metaTitle, metaDesc, published: !!published, sortOrder: sortOrder || 0 },
    });
    res.status(201).json({ success: true, data: page });
  } catch (error) {
    const e = error as { code?: string };
    if (e.code === 'P2002') { res.status(400).json({ error: 'A page with this slug already exists.' }); return; }
    next(error);
  }
};

/* PUT /api/admin/cms/:id */
export const updateCmsPage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as CmsPageBody;
    const { slug, title, content, metaTitle, metaDesc, published, sortOrder } = body;
    const page = await prisma.cmsPage.update({
      where: { id: req.params.id },
      data: { slug, title, content, metaTitle, metaDesc, published, sortOrder },
    });
    res.json({ success: true, data: page });
  } catch (error) {
    next(error);
  }
};

/* DELETE /api/admin/cms/:id */
export const deleteCmsPage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.cmsPage.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Page deleted' });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// CAREER POSTINGS
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/careers */
export const getCareerPostings = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const careers = await prisma.careerPosting.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: careers });
  } catch (error) {
    next(error);
  }
};

interface CareerPostingBody {
  title?: string;
  department?: string;
  location?: string;
  type?: string;
  description?: string;
  published?: boolean;
}

/* POST /api/admin/careers */
export const createCareerPosting = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as CareerPostingBody;
    const { title, department, location, type, description, published } = body;
    const career = await prisma.careerPosting.create({
      data: { title: title as string, department: department as string, location: location as string, type: type as string, description: description || '', published: !!published },
    });
    res.status(201).json({ success: true, data: career });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/careers/:id */
export const updateCareerPosting = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as CareerPostingBody;
    const { title, department, location, type, description, published } = body;
    const career = await prisma.careerPosting.update({
      where: { id: req.params.id },
      data: { title, department, location, type, description, published },
    });
    res.json({ success: true, data: career });
  } catch (error) {
    next(error);
  }
};

/* DELETE /api/admin/careers/:id */
export const deleteCareerPosting = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.careerPosting.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Career posting deleted' });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// SUPPORT TICKETS
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/tickets?status=open&assignedToId=...&page=1&limit=25 */
export const getSupportTickets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { status?: string; page?: string; limit?: string; assignedToId?: string; mine?: string };
    const { status } = q;
    const page = q.page || '1';
    const limit = q.limit || '25';
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where: Prisma.SupportTicketWhereInput = {};
    if (status) where.status = status;

    // Assignment filter — supports "unassigned", a specific userId, or "mine"
    if (q.assignedToId === 'unassigned') {
      where.assignedToId = null;
    } else if (q.assignedToId) {
      where.assignedToId = q.assignedToId;
    } else if (q.mine === 'true' && req.user?.id) {
      where.assignedToId = req.user.id;
    }

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
        include: {
          assignedTo: { select: { id: true, name: true, email: true, role: true } },
        },
      }),
      prisma.supportTicket.count({ where }),
    ]);

    res.json({ success: true, data: tickets, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    next(error);
  }
};

/* GET /api/admin/users/assignable — list active admin/superadmin users for ticket assignment */
export const getAssignableUsers = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: {
        status: 'active',
        role:   { in: ['admin', 'superadmin'] },
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
};

/** Build a TicketSummary used by ticket-assignment email templates. */
function ticketSummary(t: { id: string; subject: string; status: string; priority: string; email: string; name: string | null }): TicketSummary {
  return { id: t.id, subject: t.subject, status: t.status, priority: t.priority, email: t.email, name: t.name };
}

/* PUT /api/admin/tickets/:id */
export const updateSupportTicket = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { status?: string; priority?: string; adminNotes?: string };
    const { status, priority, adminNotes } = body;

    const before = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
    });
    if (!before) { res.status(404).json({ error: 'Ticket not found' }); return; }

    const ticket = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: { status, priority, adminNotes },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
    });

    // If status changed AND there's an assignee AND they're not the one
    // making the change, notify them so they don't miss the update.
    if (status && status !== before.status && ticket.assignedTo && ticket.assignedTo.id !== req.user?.id) {
      sendTicketStatusChangedToAssignee(ticket.assignedTo.email, {
        ticket:        ticketSummary(ticket),
        assigneeName:  ticket.assignedTo.name || 'there',
        oldStatus:     before.status,
        newStatus:     status,
        changedByName: req.user?.name || 'A team member',
      }).catch((err: Error) => console.warn('sendTicketStatusChangedToAssignee:', err.message));
    }

    res.json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/tickets/:id/assign — assign / reassign / unassign */
export const assignTicket = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { assignedToId?: string | null };
    const newAssigneeId = body.assignedToId ?? null;

    const before = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
    });
    if (!before) { res.status(404).json({ error: 'Ticket not found' }); return; }

    // No-op when nothing changes
    if ((before.assignedToId ?? null) === newAssigneeId) {
      res.json({ success: true, data: before });
      return;
    }

    // Validate the new assignee — must be active admin/superadmin.
    let newAssignee: { id: string; name: string; email: string; role: string } | null = null;
    if (newAssigneeId) {
      const u = await prisma.user.findUnique({
        where: { id: newAssigneeId },
        select: { id: true, name: true, email: true, role: true, status: true },
      });
      if (!u || u.status !== 'active' || !['admin', 'superadmin'].includes(u.role)) {
        res.status(400).json({ error: 'Assignee must be an active admin or superadmin user.' });
        return;
      }
      newAssignee = { id: u.id, name: u.name, email: u.email, role: u.role };
    }

    // Append assignment-history entry to responses JSON
    const responses: Array<Record<string, unknown>> = Array.isArray(before.responses)
      ? [...((before.responses as unknown) as Array<Record<string, unknown>>)]
      : [];
    responses.push({
      type: 'assignment',
      from: before.assignedToId ?? null,
      to:   newAssigneeId,
      by:   req.user?.id ?? null,
      byName: req.user?.name ?? null,
      at:   new Date().toISOString(),
    });

    const ticket = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: {
        assignedToId: newAssigneeId,
        assignedAt:   newAssigneeId ? new Date() : null,
        assignedById: newAssigneeId ? (req.user?.id ?? null) : null,
        responses:    responses as unknown as Prisma.InputJsonValue,
      },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
    });

    const summary = ticketSummary(ticket);
    const changedByName = req.user?.name || 'A team member';

    // Email previous assignee if there was one and they're being replaced
    if (before.assignedTo && before.assignedTo.id !== newAssigneeId) {
      sendTicketUnassigned(before.assignedTo.email, {
        ticket:           summary,
        assigneeName:     before.assignedTo.name || 'there',
        reassignedToName: newAssignee?.name ?? null,
        changedByName,
      }).catch((err: Error) => console.warn('sendTicketUnassigned:', err.message));
    }

    // Email new assignee if there is one
    if (newAssignee) {
      sendTicketAssigned(newAssignee.email, {
        ticket:         summary,
        assigneeName:   newAssignee.name || 'there',
        assignedByName: changedByName,
      }).catch((err: Error) => console.warn('sendTicketAssigned:', err.message));
    }

    logAudit(req, 'assign', 'support_ticket', ticket.id, {
      from: before.assignedToId ?? null,
      to:   newAssigneeId,
      fromName: before.assignedTo?.name ?? null,
      toName:   newAssignee?.name ?? null,
    });

    res.json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
};

/* POST /api/admin/tickets */
export const createSupportTicket = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as {
      email?: string; name?: string; subject?: string; body?: string;
      priority?: string; orgId?: string; userId?: string;
    };
    const { email, name, subject, body: bodyText, priority = 'normal', orgId, userId } = body;
    if (!email?.trim()) { res.status(400).json({ error: 'email is required' }); return; }
    if (!subject?.trim()) { res.status(400).json({ error: 'subject is required' }); return; }
    if (!bodyText?.trim()) { res.status(400).json({ error: 'body is required' }); return; }

    const ticket = await prisma.supportTicket.create({
      data: {
        email: email.trim(),
        name: name?.trim(),
        subject: subject.trim(),
        body: bodyText.trim(),
        priority,
        orgId: orgId || null,
        userId: userId || null,
        status: 'open',
        responses: [] as unknown as Prisma.InputJsonValue,
      },
    });
    res.status(201).json({ success: true, data: ticket });
  } catch (error) { next(error); }
};

/* DELETE /api/admin/tickets/:id */
export const deleteSupportTicket = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.supportTicket.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) { next(error); }
};

interface TicketResponseEntry {
  by: string;
  byType: 'admin' | 'store';
  message: string;
  date: string;
}

/* POST /api/admin/tickets/:id/reply */
export const addAdminTicketReply = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { message?: string };
    const { message } = body;
    if (!message?.trim()) { res.status(400).json({ error: 'message is required' }); return; }

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
    });
    if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }

    const responses: TicketResponseEntry[] = Array.isArray(ticket.responses)
      ? [...((ticket.responses as unknown) as TicketResponseEntry[])]
      : [];
    responses.push({
      by:     req.user?.name || 'Support Team',
      byType: 'admin',
      message: message.trim(),
      date:   new Date().toISOString(),
    });

    const updated = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: {
        responses: responses as unknown as Prisma.InputJsonValue,
        status: ticket.status === 'open' ? 'in_progress' : ticket.status,
      },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
    });

    // Notify the assignee if someone OTHER than them posted the reply
    // (e.g. another admin chimes in, or the requester replied via the
    // org-side ticket flow — assignee needs to know).
    if (updated.assignedTo && updated.assignedTo.id !== req.user?.id) {
      sendTicketReplyToAssignee(updated.assignedTo.email, {
        ticket:        ticketSummary(updated),
        assigneeName:  updated.assignedTo.name || 'there',
        replyFromName: req.user?.name || 'A team member',
        replyText:     message.trim(),
      }).catch((err: Error) => console.warn('sendTicketReplyToAssignee:', err.message));
    }

    res.json({ success: true, data: updated });
  } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// SYSTEM CONFIG
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/config */
export const getSystemConfig = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const configs = await prisma.systemConfig.findMany({ orderBy: { key: 'asc' } });
    res.json({ success: true, data: configs });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/config */
export const updateSystemConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { key?: string; value?: string; description?: string };
    const { key, value, description } = body;
    const config = await prisma.systemConfig.upsert({
      where: { key: key as string },
      update: { value, description },
      create: { key: key as string, value: value as string, description },
    });
    res.json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/analytics/dashboard */
export const getAnalyticsDashboard = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalUsers, totalOrgs, totalStores, totalTransactions, recentUsers, recentOrgs, ticketStats] = await Promise.all([
      prisma.user.count(),
      prisma.organization.count(),
      prisma.store.count(),
      prisma.transaction.count().catch(() => 0),
      // User signups by day (last 30 days)
      prisma.user.groupBy({
        by: ['createdAt'],
        where: { createdAt: { gte: thirtyDaysAgo } },
        _count: true,
      }).catch(() => [] as Array<{ createdAt: Date; _count: number }>),
      // Org signups by day (last 30 days)
      prisma.organization.groupBy({
        by: ['createdAt'],
        where: { createdAt: { gte: thirtyDaysAgo } },
        _count: true,
      }).catch(() => [] as Array<{ createdAt: Date; _count: number }>),
      // Ticket stats
      prisma.supportTicket.groupBy({
        by: ['status'],
        _count: true,
      }).catch(() => [] as Array<{ status: string; _count: number }>),
    ]);

    // Aggregate user signups by date
    const userSignupsByDay: Record<string, number> = {};
    for (const u of recentUsers as Array<{ createdAt: Date; _count: number }>) {
      const day = new Date(u.createdAt).toISOString().split('T')[0];
      userSignupsByDay[day] = (userSignupsByDay[day] || 0) + u._count;
    }

    // Aggregate org signups by date
    const orgSignupsByDay: Record<string, number> = {};
    for (const o of recentOrgs as Array<{ createdAt: Date; _count: number }>) {
      const day = new Date(o.createdAt).toISOString().split('T')[0];
      orgSignupsByDay[day] = (orgSignupsByDay[day] || 0) + o._count;
    }

    // Build chart data (last 30 days)
    const chartData: Array<{ date: string; users: number; orgs: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split('T')[0];
      chartData.push({
        date: key,
        users: userSignupsByDay[key] || 0,
        orgs: orgSignupsByDay[key] || 0,
      });
    }

    res.json({
      success: true,
      data: {
        totalUsers, totalOrgs, totalStores, totalTransactions,
        chartData,
        ticketStats: (ticketStats as Array<{ status: string; _count: number }>).reduce<Record<string, number>>((acc, t) => { acc[t.status] = t._count; return acc; }, {}),
      },
    });
  } catch (error) {
    next(error);
  }
};

/* GET /api/admin/analytics/organizations */
export const getOrgAnalytics = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgs = await prisma.organization.findMany({
      include: {
        _count: { select: { users: true, stores: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    type OrgRow = (typeof orgs)[number];

    // For each org, get transaction count
    const enriched = await Promise.all(
      (orgs as OrgRow[]).map(async (org) => {
        const txCount = await prisma.transaction.count({
          where: { store: { orgId: org.id } },
        }).catch(() => 0);
        return { ...org, transactionCount: txCount };
      }),
    );

    res.json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
};

/* GET /api/admin/analytics/stores */
export const getStorePerformance = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stores = await prisma.store.findMany({
      include: {
        organization: { select: { name: true } },
        _count: { select: { users: true, customers: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    type StoreRow = (typeof stores)[number];

    // Enrich with transaction count per store (transactions are linked via storeId)
    const enriched = await Promise.all(
      (stores as StoreRow[]).map(async (store) => {
        const txCount = await prisma.transaction.count({
          where: { storeId: store.id },
        }).catch(() => 0);
        return {
          ...store,
          transactionCount: txCount,
          stationCount: store.stationCount || 0,
        };
      }),
    );

    res.json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
};

/* GET /api/admin/analytics/users */
export const getUserActivity = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Role distribution
    const roleDistribution = await prisma.user.groupBy({
      by: ['role'],
      _count: true,
    });

    // Status distribution
    const statusDistribution = await prisma.user.groupBy({
      by: ['status'],
      _count: true,
    });

    // Recent signups (last 20)
    const recentSignups = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, organization: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // User signup trend (last 12 weeks)
    const twelveWeeksAgo = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000);
    const weeklySignups = await prisma.user.findMany({
      where: { createdAt: { gte: twelveWeeksAgo } },
      select: { createdAt: true },
    });
    type SignupRow = (typeof weeklySignups)[number];

    const byWeek: Record<string, number> = {};
    (weeklySignups as SignupRow[]).forEach((u) => {
      const d = new Date(u.createdAt);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().split('T')[0];
      byWeek[key] = (byWeek[key] || 0) + 1;
    });

    type GroupRow = { role?: string; status?: string; _count: number };
    res.json({
      success: true,
      data: {
        roleDistribution: (roleDistribution as GroupRow[]).map((r) => ({ role: r.role, count: r._count })),
        statusDistribution: (statusDistribution as GroupRow[]).map((s) => ({ status: s.status, count: s._count })),
        recentSignups,
        weeklySignups: Object.entries(byWeek).map(([week, count]) => ({ week, count })).sort((a, b) => a.week.localeCompare(b.week)),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// JOB APPLICATIONS (Admin)
// ─────────────────────────────────────────────────────────────

/* GET /api/admin/careers/:id/applications */
export const getJobApplications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { status?: string };
    const { status } = q;
    const where: Prisma.JobApplicationWhereInput = { careerPostingId: req.params.id };
    if (status) where.status = status;

    const applications = await prisma.jobApplication.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const posting = await prisma.careerPosting.findUnique({
      where: { id: req.params.id },
      select: { title: true, department: true },
    });

    res.json({ success: true, data: applications, posting });
  } catch (error) {
    next(error);
  }
};

/* PUT /api/admin/applications/:id */
export const updateJobApplication = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { status?: string; adminNotes?: string };
    const { status, adminNotes } = body;
    const application = await prisma.jobApplication.update({
      where: { id: req.params.id },
      data: { status, adminNotes },
    });
    res.json({ success: true, data: application });
  } catch (error) {
    next(error);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — PAYMENT HISTORY (cross-org)
// ═════════════════════════════════════════════════════════════════════════════

export const adminListPaymentHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as {
      orgId?: string; storeId?: string; type?: string; status?: string;
      dateFrom?: string; dateTo?: string;
      page?: string; limit?: string;
    };
    const { orgId, storeId, type, status, dateFrom, dateTo } = q;
    const p = q.page || '1';
    const l = q.limit || '50';
    const where: Prisma.PaymentTransactionWhereInput = {};
    if (orgId)  where.orgId   = orgId;
    if (storeId) where.storeId = storeId;
    if (type)    where.type    = type;
    if (status)  where.status  = status;
    if (dateFrom || dateTo) {
      const range: Prisma.DateTimeFilter = {};
      if (dateFrom) range.gte = new Date(dateFrom);
      if (dateTo)   range.lte = new Date(dateTo);
      where.createdAt = range;
    }

    const [total, rows] = await Promise.all([
      prisma.paymentTransaction.count({ where }),
      prisma.paymentTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:  (Number(p) - 1) * Number(l),
        take:  Number(l),
        select: {
          id: true, orgId: true, storeId: true, provider: true,
          retref: true, authCode: true, respCode: true, respText: true,
          lastFour: true, acctType: true, entryMode: true,
          amount: true, capturedAmount: true,
          type: true, status: true,
          signatureCaptured: true,
          invoiceNumber: true, posTransactionId: true, originalRetref: true,
          createdAt: true, updatedAt: true,
        },
      }),
    ]);
    type PayRow = (typeof rows)[number];

    const orgIds = [...new Set((rows as PayRow[]).map((r) => r.orgId))];
    interface OrgIdName { id: string; name: string }
    const orgs   = await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
    const orgMap = Object.fromEntries((orgs as OrgIdName[]).map((o) => [o.id, o.name]));
    const data   = (rows as PayRow[]).map((r) => ({ ...r, orgName: orgMap[r.orgId] || r.orgId }));

    res.json({ success: true, data, meta: { total, page: Number(p), limit: Number(l), pages: Math.ceil(total / Number(l)) } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — BILLING: PLANS
// ═════════════════════════════════════════════════════════════════════════════

/* GET /api/admin/billing/plans */
export const adminListPlans = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      include: { addons: true },
      orderBy: { sortOrder: 'asc' },
    });
    type PlanRow = (typeof plans)[number];
    // Return { plans, addons } — frontend reads r.data.plans and r.data.addons
    const addons = (plans as PlanRow[]).flatMap((p) => p.addons);
    res.json({ plans, addons });
  } catch (err) { next(err); }
};

interface CreatePlanBody {
  name?: string;
  slug?: string;
  description?: string;
  basePrice?: number | string;
  pricePerStore?: number | string;
  pricePerRegister?: number | string;
  includedStores?: number;
  includedRegisters?: number;
  trialDays?: number;
  isPublic?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

/* POST /api/admin/billing/plans */
export const adminCreatePlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as CreatePlanBody;
    const {
      name, slug, description, basePrice,
      pricePerStore, pricePerRegister,
      includedStores, includedRegisters,
      trialDays, isPublic, isActive, sortOrder,
    } = body;
    const plan = await prisma.subscriptionPlan.create({
      data: {
        name: name as string,
        slug: slug as string,
        description: description || null,
        basePrice: basePrice as number,
        pricePerStore:     pricePerStore     ?? 0,
        pricePerRegister:  pricePerRegister  ?? 0,
        includedStores:    includedStores    ?? 1,
        includedRegisters: includedRegisters ?? 1,
        trialDays:         trialDays         ?? 14,
        isPublic:          isPublic          !== false,
        isActive:          isActive          !== false,
        sortOrder:         sortOrder         ?? 0,
      },
      include: { addons: true },
    });
    res.status(201).json(plan);
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === 'P2002') { res.status(400).json({ error: 'A plan with this slug already exists.' }); return; }
    next(err);
  }
};

/* PUT /api/admin/billing/plans/:id */
export const adminUpdatePlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Whitelist columns that actually exist on SubscriptionPlan. The legacy
    // PlansTab form sends `includedAddons` (UI-only — addons are a join table)
    // and S78 sends `moduleIds` which lives on PlanModule. Both must be
    // dropped here before the update reaches Prisma.
    const body = (req.body || {}) as Record<string, unknown>;
    const allowed: (keyof Prisma.SubscriptionPlanUpdateInput)[] = [
      'name', 'slug', 'description',
      'basePrice', 'pricePerStore', 'pricePerRegister',
      'includedStores', 'includedRegisters', 'trialDays',
      'isPublic', 'isActive', 'sortOrder',
      // S78 fields
      'tagline', 'annualPrice', 'isCustomPriced', 'currency',
      'maxUsers', 'highlighted', 'isDefault',
    ];
    const data: Prisma.SubscriptionPlanUpdateInput = {};
    for (const key of allowed) {
      if (body[key] !== undefined) (data as any)[key] = body[key];
    }
    const plan = await prisma.subscriptionPlan.update({
      where:   { id: req.params.id },
      data,
      include: { addons: true },
    });
    res.json(plan);
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === 'P2002') { res.status(400).json({ error: 'A plan with this slug already exists.' }); return; }
    next(err);
  }
};

/* DELETE /api/admin/billing/plans/:id */
export const adminDeletePlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.subscriptionPlan.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/* POST /api/admin/billing/addons */
export const adminCreateAddon = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const addon = await prisma.planAddon.create({ data: req.body as Prisma.PlanAddonCreateInput });
    res.status(201).json(addon);
  } catch (err) { next(err); }
};

/* PUT /api/admin/billing/addons/:id */
export const adminUpdateAddon = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const addon = await prisma.planAddon.update({
      where: { id: req.params.id },
      data:  req.body as Prisma.PlanAddonUpdateInput,
    });
    res.json(addon);
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — BILLING: SUBSCRIPTIONS
// ═════════════════════════════════════════════════════════════════════════════

/* GET /api/admin/billing/subscriptions */
export const adminListSubscriptions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { status?: string; page?: string; limit?: string };
    const { status } = q;
    const page = q.page || '1';
    const limit = q.limit || '50';
    const where: Prisma.OrgSubscriptionWhereInput = {};
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      prisma.orgSubscription.findMany({
        where,
        include: {
          plan:         true,
          organization: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip:    (Number(page) - 1) * Number(limit),
        take:    Number(limit),
      }),
      prisma.orgSubscription.count({ where }),
    ]);
    res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

/* GET /api/admin/billing/subscriptions/:orgId */
export const adminGetSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sub = await prisma.orgSubscription.findUnique({
      where:   { orgId: req.params.orgId },
      include: {
        plan:         { include: { addons: true } },
        organization: { select: { id: true, name: true } },
        invoices:     { orderBy: { createdAt: 'desc' }, take: 24 },
      },
    });
    res.json(sub || null);
  } catch (err) { next(err); }
};

/* PUT /api/admin/billing/subscriptions/:orgId */
export const adminUpsertSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.params.orgId;
    const data  = { ...(req.body as Record<string, unknown>) };
    const sub   = await prisma.orgSubscription.upsert({
      where:   { orgId },
      update:  data as Prisma.OrgSubscriptionUpdateInput,
      create:  { orgId, ...data } as unknown as Prisma.OrgSubscriptionCreateInput,
      include: { plan: { include: { addons: true } } },
    });
    res.json(sub);
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — BILLING: INVOICES
// ═════════════════════════════════════════════════════════════════════════════

/* GET /api/admin/billing/invoices */
export const adminListInvoices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { orgId?: string; status?: string; page?: string; limit?: string };
    const { orgId, status } = q;
    const page = q.page || '1';
    const limit = q.limit || '50';
    const where: Prisma.BillingInvoiceWhereInput = {};
    if (status) where.status = status;
    if (orgId) {
      const sub = await prisma.orgSubscription.findUnique({ where: { orgId } });
      if (!sub) { res.json({ data: [], total: 0 }); return; }
      where.subscriptionId = sub.id;
    }

    const [data, total] = await Promise.all([
      prisma.billingInvoice.findMany({
        where,
        include: {
          subscription: {
            include: { organization: { select: { id: true, name: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip:    (Number(page) - 1) * Number(limit),
        take:    Number(limit),
      }),
      prisma.billingInvoice.count({ where }),
    ]);
    res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

/* POST /api/admin/billing/invoices/:id/write-off */
export const adminWriteOffInvoice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as { notes?: string };
    const invoice = await prisma.billingInvoice.update({
      where: { id: req.params.id },
      data:  {
        status: 'written_off',
        notes:  body.notes || 'Written off by admin',
      },
    });
    res.json(invoice);
  } catch (err) { next(err); }
};

/* POST /api/admin/billing/invoices/:id/retry */
export const adminRetryInvoiceNow = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const invoice = await prisma.billingInvoice.findUnique({
      where:   { id: req.params.id },
      include: {
        subscription: {
          include: {
            plan:         { include: { addons: true } },
            organization: true,
          },
        },
      },
    });
    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

    const { chargeSubscription } = await import('../services/billingService.js');
    // chargeSubscription is currently a 0-arg stub that always throws (pending
    // Dejavoo Transact integration). Cast preserves the future-wired
    // (subscription, amount, invoiceNumber) signature.
    const charge = chargeSubscription as unknown as (
      sub: typeof invoice.subscription,
      amount: number,
      invoiceNumber: string | null,
    ) => Promise<{ retref?: string; authcode?: string }>;
    try {
      const result = await charge(
        invoice.subscription,
        Number(invoice.totalAmount),
        invoice.invoiceNumber,
      );
      await prisma.billingInvoice.update({
        where: { id: invoice.id },
        data:  {
          status:        'paid',
          paidAt:        new Date(),
          retref:        result.retref,
          authcode:      result.authcode,
          attempts:      { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });
      await prisma.orgSubscription.update({
        where: { id: invoice.subscription.id },
        data:  { status: 'active', retryCount: 0, lastFailedAt: null, nextRetryAt: null },
      });
      res.json({ ok: true, retref: result.retref });
    } catch (payErr) {
      await prisma.billingInvoice.update({
        where: { id: invoice.id },
        data:  { status: 'failed', attempts: { increment: 1 }, lastAttemptAt: new Date() },
      });
      res.status(402).json({ error: (payErr as Error).message });
    }
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — EQUIPMENT: PRODUCTS
// ═════════════════════════════════════════════════════════════════════════════

/* GET /api/admin/billing/equipment/products */
export const adminListEquipmentProducts = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const products = await prisma.equipmentProduct.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(products);
  } catch (err) { next(err); }
};

/* POST /api/admin/billing/equipment/products */
export const adminCreateEquipmentProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const product = await prisma.equipmentProduct.create({ data: req.body as Prisma.EquipmentProductCreateInput });
    res.status(201).json(product);
  } catch (err) { next(err); }
};

/* PUT /api/admin/billing/equipment/products/:id */
export const adminUpdateEquipmentProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const product = await prisma.equipmentProduct.update({
      where: { id: req.params.id },
      data:  req.body as Prisma.EquipmentProductUpdateInput,
    });
    res.json(product);
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — EQUIPMENT: ORDERS
// ═════════════════════════════════════════════════════════════════════════════

/* GET /api/admin/billing/equipment/orders */
export const adminListEquipmentOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as { status?: string; page?: string; limit?: string };
    const { status } = q;
    const page = q.page || '1';
    const limit = q.limit || '50';
    const where: Prisma.EquipmentOrderWhereInput = {};
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      prisma.equipmentOrder.findMany({
        where,
        include: { items: { include: { product: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip:    (Number(page) - 1) * Number(limit),
        take:    Number(limit),
      }),
      prisma.equipmentOrder.count({ where }),
    ]);
    res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

/* PUT /api/admin/billing/equipment/orders/:id */
export const adminUpdateEquipmentOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const order = await prisma.equipmentOrder.update({
      where: { id: req.params.id },
      data:  req.body as Prisma.EquipmentOrderUpdateInput,
    });
    res.json(order);
  } catch (err) { next(err); }
};
