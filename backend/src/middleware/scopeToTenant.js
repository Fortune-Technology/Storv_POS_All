/**
 * scopeToTenant middleware
 *
 * Must run AFTER `protect` (which sets req.user).
 *
 * Sets convenience properties on every request so controllers
 * never have to re-derive them:
 *
 *   req.orgId        — Organization.id string | null
 *   req.tenantId     — alias for req.orgId (backward compat for catalog routes)
 *   req.tenantFilter — { orgId } | {}
 *   req.storeIds     — string[] of Store IDs the user can access
 *   req.storeId      — active store from X-Store-Id header or first store
 *   req.storeFilter  — { storeId } | {}
 *
 * Usage in a controller:
 *
 *   const invoices = await prisma.invoice.findMany({
 *     where: { orgId: req.orgId, status: 'complete' },
 *   });
 */

import prisma from '../config/postgres.js';

/* ── Core middleware ─────────────────────────────────────────────────────── */

/**
 * Attach org/store context to req.
 * Always calls next() — non-blocking, backward-compatible.
 */
export const scopeToTenant = (req, res, next) => {
  const orgId = req.user?.orgId ?? null;

  req.orgId        = orgId;
  req.tenantId     = orgId;           // backward compat alias
  req.tenantFilter = orgId ? { orgId } : {};

  // All stores this user is linked to (from UserStore junction)
  const userStoreIds = (req.user?.stores ?? []).map(s => s.storeId);
  req.storeIds = userStoreIds;

  // Roles that have org-wide access (not restricted to specific stores)
  const isOrgWide = ['superadmin', 'admin', 'owner'].includes(req.user?.role);

  // Active store: prefer X-Store-Id header, then first assigned store
  const headerStoreId = req.headers['x-store-id'] ?? null;

  let activeStoreId = null;

  if (headerStoreId) {
    const allowed = isOrgWide || userStoreIds.includes(headerStoreId);
    if (allowed) {
      activeStoreId = headerStoreId;
    }
  } else if (userStoreIds.length > 0) {
    activeStoreId = userStoreIds[0];
  }

  req.storeId     = activeStoreId;
  req.storeFilter = activeStoreId ? { storeId: activeStoreId } : {};

  next();
};

/* ── Guard middleware ─────────────────────────────────────────────────────── */

/**
 * Rejects requests where orgId is null.
 */
export const requireTenant = (req, res, next) => {
  if (!req.orgId) {
    return res.status(403).json({
      error: 'This endpoint requires an organization account. Please contact support.',
    });
  }
  next();
};

/* ── Org existence guard ─────────────────────────────────────────────────── */

/**
 * Verify the org is active — use on billing-sensitive routes.
 */
export const requireActiveTenant = async (req, res, next) => {
  if (!req.orgId) {
    return res.status(403).json({ error: 'No organization context.' });
  }

  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.orgId },
      select: { isActive: true, plan: true, trialEndsAt: true },
    });

    if (!org || !org.isActive) {
      return res.status(403).json({ error: 'Organization account is inactive or suspended.' });
    }

    if (org.plan === 'trial' && org.trialEndsAt && org.trialEndsAt < new Date()) {
      return res.status(402).json({
        error: 'Free trial has expired. Please upgrade to continue.',
        trialEndsAt: org.trialEndsAt,
      });
    }

    req.tenant = org;
    next();
  } catch (err) {
    next(err);
  }
};

/* ── Cross-tenant guard (superadmin only) ────────────────────────────────── */

/**
 * Allow superadmins to inspect any org via X-Tenant-Id header.
 */
export const allowTenantOverride = (req, res, next) => {
  const overrideId = req.headers['x-tenant-id'];

  if (overrideId) {
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Tenant override requires superadmin role.' });
    }
    req.orgId        = overrideId;
    req.tenantId     = overrideId;
    req.tenantFilter = { orgId: overrideId };
  }

  next();
};
