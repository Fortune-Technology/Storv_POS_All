/**
 * User Management Controller  —  /api/users
 *
 * Manages users within an org (invite, list, role change, remove).
 * All mutations are scoped to req.orgId.
 */

import bcrypt from 'bcryptjs';
import prisma from '../config/postgres.js';

const ALLOWED_ROLES = ['admin', 'manager', 'cashier'];

/* ── GET /api/users  — list all users in this org ───────────────────────── */
export const getTenantUsers = async (req, res, next) => {
  try {
    if (!req.orgId) {
      return res.status(403).json({ error: 'No organisation context.' });
    }

    const users = await prisma.user.findMany({
      where: { orgId: req.orgId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
        stores: {
          select: {
            store: { select: { id: true, name: true, address: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Flatten store list + add _id alias for frontend compat
    const result = users.map(u => ({
      ...u,
      _id:    u.id,
      stores: u.stores.map(us => ({ ...us.store, _id: us.store.id })),
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/users/invite  — create & add user to org ─────────────────── */
export const inviteUser = async (req, res, next) => {
  try {
    if (!req.orgId) {
      return res.status(403).json({ error: 'No organisation context.' });
    }

    const [userCount, org] = await Promise.all([
      prisma.user.count({ where: { orgId: req.orgId } }),
      prisma.organization.findUnique({
        where: { id: req.orgId },
        select: { maxUsers: true, plan: true },
      }),
    ]);

    if (userCount >= (org?.maxUsers ?? 5)) {
      return res.status(402).json({
        error: `Your ${org?.plan} plan allows ${org?.maxUsers} users. Upgrade to invite more.`,
      });
    }

    const { name, email, phone, role, storeIds } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }

    const effectiveRole = role || 'cashier';
    if (!ALLOWED_ROLES.includes(effectiveRole)) {
      return res.status(400).json({ error: `Invalid role. Choose: ${ALLOWED_ROLES.join(', ')}` });
    }

    const storeList = Array.isArray(storeIds) ? storeIds.filter(Boolean) : [];
    if (effectiveRole === 'cashier' && storeList.length !== 1) {
      return res.status(400).json({ error: 'Cashiers must be assigned to exactly one store.' });
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return res.status(400).json({ error: 'A user with this email already exists.' });
    }

    const tempPassword = Math.random().toString(36).slice(-8) + '!A1';
    const hashed = await bcrypt.hash(tempPassword, 12);

    const user = await prisma.user.create({
      data: {
        name:     name.trim(),
        email:    email.toLowerCase().trim(),
        phone:    phone || null,
        password: hashed,
        role:     effectiveRole,
        orgId:    req.orgId,
        stores: storeList.length > 0
          ? { create: storeList.map(sid => ({ storeId: sid })) }
          : undefined,
      },
    });

    res.status(201).json({
      user: {
        id:        user.id,
        _id:       user.id,
        name:      user.name,
        email:     user.email,
        role:      user.role,
        orgId:     user.orgId,
        createdAt: user.createdAt,
      },
      tempPassword, // Share manually until email integration is live
    });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/users/:id/role  — update role + store assignments ──────────── */
export const updateUserRole = async (req, res, next) => {
  try {
    const { role, storeIds } = req.body;

    if (role && !ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Choose: ${ALLOWED_ROLES.join(', ')}` });
    }

    const target = await prisma.user.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
    });
    if (!target) return res.status(404).json({ error: 'User not found in your organisation.' });
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'Cannot change the role of the organisation owner.' });
    }

    const effectiveRole = role || target.role;
    const storeList = Array.isArray(storeIds) ? storeIds.filter(Boolean) : undefined;

    if (storeList !== undefined && effectiveRole === 'cashier' && storeList.length !== 1) {
      return res.status(400).json({ error: 'Cashiers must be assigned to exactly one store.' });
    }

    const data = {};
    if (role) data.role = role;

    // Replace store assignments atomically
    if (storeList !== undefined) {
      await prisma.userStore.deleteMany({ where: { userId: req.params.id } });
      if (storeList.length > 0) {
        await prisma.userStore.createMany({
          data: storeList.map(sid => ({ userId: req.params.id, storeId: sid })),
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

    res.json({ ...updated, _id: updated.id, stores: updated.stores.map(us => ({ ...us.store, _id: us.store.id })) });
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/users/:id  — remove user from org ─────────────────────── */
export const removeUser = async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot remove yourself.' });
    }

    const user = await prisma.user.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
    });
    if (!user) return res.status(404).json({ error: 'User not found in your organisation.' });
    if (user.role === 'owner') {
      return res.status(403).json({ error: 'Cannot remove the organisation owner.' });
    }

    // Detach from org + remove store assignments
    await prisma.$transaction([
      prisma.userStore.deleteMany({ where: { userId: req.params.id } }),
      prisma.user.update({
        where: { id: req.params.id },
        data: { orgId: 'detached' },
      }),
    ]);

    res.json({ message: `${user.name} has been removed from the organisation.` });
  } catch (err) {
    next(err);
  }
};
