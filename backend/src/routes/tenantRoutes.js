/**
 * Tenant (Organization) routes  —  /api/tenants
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { requireTenant, requireActiveTenant } from '../middleware/scopeToTenant.js';
import prisma from '../config/postgres.js';
import { syncUserDefaultRole } from '../rbac/permissionService.js';

const router = Router();

const PLAN_LIMITS = {
  trial:      { maxStores: 1,    maxUsers: 3   },
  basic:      { maxStores: 3,    maxUsers: 10  },
  pro:        { maxStores: 25,   maxUsers: 100 },
  enterprise: { maxStores: 9999, maxUsers: 9999 },
};

/* ── POST /api/tenants  — create org + bind to calling user ─────────────── */
router.post('/', protect, async (req, res, next) => {
  try {
    const { name, slug, billingEmail, plan } = req.body;

    const org = await prisma.organization.create({
      data: {
        name,
        slug,
        billingEmail,
        plan: plan || 'trial',
      },
    });

    // Bind the creating user to this new org as owner.
    // Two writes:
    //   • user.orgId / user.role — legacy "home org" fields (back-compat)
    //   • UserOrg row             — multi-org access record (source of truth)
    await prisma.$transaction([
      prisma.user.update({
        where: { id: req.user.id },
        data:  { orgId: org.id, role: 'owner' },
      }),
      prisma.userOrg.upsert({
        where:  { userId_orgId: { userId: req.user.id, orgId: org.id } },
        create: { userId: req.user.id, orgId: org.id, role: 'owner', isPrimary: true },
        update: { role: 'owner', isPrimary: true },
      }),
    ]);

    // Re-sync their default system role (staff → owner)
    await syncUserDefaultRole(req.user.id).catch(err => console.warn('syncUserDefaultRole:', err.message));

    res.status(201).json(org);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'That organisation name/slug is already taken.' });
    }
    next(err);
  }
});

/* ── GET /api/tenants/me  — caller's own org ────────────────────────────── */
router.get('/me', protect, requireTenant, async (req, res, next) => {
  try {
    const org = await prisma.organization.findUnique({ where: { id: req.orgId } });
    if (!org) return res.status(404).json({ error: 'Organisation not found.' });
    res.json(org);
  } catch (err) {
    next(err);
  }
});

/* ── PUT /api/tenants/me  — update settings ─────────────────────────────── */
router.put('/me', protect, requireTenant, requireActiveTenant, async (req, res, next) => {
  try {
    const allowed = ['name', 'billingEmail', 'settings'];
    const data = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );

    const org = await prisma.organization.update({
      where: { id: req.orgId },
      data,
    });
    res.json(org);
  } catch (err) {
    next(err);
  }
});

/* ── PUT /api/tenants/me/plan  — change subscription plan ───────────────── */
router.put('/me/plan', protect, requireTenant, authorize('superadmin', 'admin', 'owner'), async (req, res, next) => {
  try {
    const VALID_PLANS = Object.keys(PLAN_LIMITS);
    const { plan } = req.body;

    if (!plan || !VALID_PLANS.includes(plan)) {
      return res.status(400).json({ error: `Invalid plan. Choose: ${VALID_PLANS.join(', ')}` });
    }

    const org = await prisma.organization.findUnique({ where: { id: req.orgId } });
    if (!org) return res.status(404).json({ error: 'Organisation not found.' });

    if (plan !== 'enterprise') {
      const limits = PLAN_LIMITS[plan];
      const [storeCount, userCount] = await Promise.all([
        prisma.store.count({ where: { orgId: req.orgId, isActive: true } }),
        prisma.user.count({ where: { orgId: req.orgId } }),
      ]);

      if (storeCount > limits.maxStores) {
        return res.status(409).json({
          error: `Cannot downgrade: you have ${storeCount} active store(s) but the ${plan} plan allows ${limits.maxStores}.`,
        });
      }
      if (userCount > limits.maxUsers) {
        return res.status(409).json({
          error: `Cannot downgrade: you have ${userCount} user(s) but the ${plan} plan allows ${limits.maxUsers}.`,
        });
      }
    }

    const limits = PLAN_LIMITS[plan];
    const updated = await prisma.organization.update({
      where: { id: req.orgId },
      data: {
        plan,
        maxStores: limits.maxStores,
        maxUsers:  limits.maxUsers,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/* ── DELETE /api/tenants/me  — owner deletes their own org ──────────────── */
router.delete('/me', protect, requireTenant, authorize('superadmin', 'owner'), async (req, res, next) => {
  try {
    const { confirmName } = req.body;

    const org = await prisma.organization.findUnique({ where: { id: req.orgId } });
    if (!org) return res.status(404).json({ error: 'Organisation not found.' });

    // Require the user to confirm by typing the org name exactly
    if (!confirmName || confirmName.trim() !== org.name.trim()) {
      return res.status(400).json({ error: 'Organisation name does not match. Deletion cancelled.' });
    }

    // Soft-delete the org
    await prisma.organization.update({
      where: { id: req.orgId },
      data:  { isActive: false, deactivatedAt: new Date() },
    });

    res.json({ message: 'Organisation deleted successfully.' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Organisation not found.' });
    next(err);
  }
});

/* ── GET /api/tenants/:id  — superadmin inspect ─────────────────────────── */
router.get('/:id', protect, authorize('superadmin'), async (req, res, next) => {
  try {
    const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!org) return res.status(404).json({ error: 'Organisation not found.' });
    res.json(org);
  } catch (err) {
    next(err);
  }
});

/* ── DELETE /api/tenants/:id  — soft-delete (superadmin only) ───────────── */
router.delete('/:id', protect, authorize('superadmin'), async (req, res, next) => {
  try {
    const org = await prisma.organization.update({
      where: { id: req.params.id },
      data:  { isActive: false, deactivatedAt: new Date() },
    });
    res.json({ message: 'Organisation deactivated.', org });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Organisation not found.' });
    next(err);
  }
});

export default router;
