/**
 * scopeToTenant middleware
 *
 * Must run AFTER `protect` (which sets req.user with `orgs` + `stores.store.orgId`).
 *
 * Sets convenience properties on every request:
 *
 *   req.orgId        — Organization.id string | null  (derived from active store)
 *   req.tenantId     — alias for req.orgId (backward compat for catalog routes)
 *   req.tenantFilter — { orgId } | {}
 *   req.storeIds     — string[] of Store IDs the user can access
 *   req.storeId      — active store from X-Store-Id header or first assigned store
 *   req.storeFilter  — { storeId } | {}
 *   req.role         — effective role for the active org (from UserOrg)
 *   req.orgIds       — string[] of all orgs the user has UserOrg membership in
 *
 * ── How the active org is resolved ─────────────────────────────────────────
 *   1. Active store = X-Store-Id header if the user has access, else the
 *      first store the user is linked to.
 *   2. Active org = that store's orgId. This is the multi-org dispatch —
 *      switching the X-Store-Id header implicitly switches req.orgId, so
 *      every downstream controller (which reads `req.orgId`) gets correctly
 *      scoped data without any code changes.
 *   3. Fallback: if the user has no stores but is a legacy single-org user,
 *      use User.orgId (the home org) so onboarding flows still work.
 */

import type { RequestHandler } from 'express';
import prisma from '../config/postgres.js';

/* ── Core middleware ─────────────────────────────────────────────────────── */

export const scopeToTenant: RequestHandler = async (req, res, next) => {
  const user = req.user;
  if (!user) { next(); return; }

  // Org memberships (UserOrg) and direct store assignments (UserStore).
  const userOrgRows   = user.orgs   ?? [];
  const userStoreRows = user.stores ?? [];

  const membershipOrgIds = userOrgRows.map(r => r.orgId);
  const userStoreIds     = userStoreRows.map(r => r.storeId);

  // Roles that have cross-org access (platform-level) — they can read any org
  // via X-Tenant-Id override (see allowTenantOverride below).
  const isPlatformRole = user.role === 'superadmin';

  // Roles that have org-wide access (not restricted to specific stores).
  // These roles can see every store in the orgs they're members of, even
  // without an explicit UserStore row.
  const ORG_WIDE_ROLES = new Set(['superadmin', 'admin', 'owner']);

  // ── 1. Resolve active store ────────────────────────────────────────────
  const headerStoreIdRaw = req.headers['x-store-id'];
  const headerStoreId =
    typeof headerStoreIdRaw === 'string'
      ? headerStoreIdRaw
      : Array.isArray(headerStoreIdRaw) ? headerStoreIdRaw[0] : null;

  let activeStoreId: string | null = null;
  let activeStoreOrgId: string | null = null;

  if (headerStoreId) {
    // Direct match on UserStore — the most common path.
    const hit = userStoreRows.find(r => r.storeId === headerStoreId);
    if (hit) {
      activeStoreId = headerStoreId;
      activeStoreOrgId = hit.store?.orgId ?? null;
    } else if (ORG_WIDE_ROLES.has(user.role) || isPlatformRole) {
      // Org-wide role without an explicit UserStore row (admin/owner acting
      // on any store in one of their UserOrg memberships). Look up the
      // store's orgId so req.orgId resolves correctly — otherwise we'd
      // fall through to the user's primary org and serve cross-org data.
      try {
        const s = await prisma.store.findUnique({
          where: { id: headerStoreId },
          select: { id: true, orgId: true },
        });
        const allowed = s && (isPlatformRole || membershipOrgIds.includes(s.orgId));
        if (allowed && s) {
          activeStoreId    = s.id;
          activeStoreOrgId = s.orgId;
        }
      } catch {
        /* DB hiccup → fall through to UserOrg primary below */
      }
    }
  } else if (userStoreIds.length > 0) {
    // No header → first linked store.
    activeStoreId    = userStoreIds[0];
    activeStoreOrgId = userStoreRows[0]?.store?.orgId ?? null;
  }

  // ── 2. Resolve active org ──────────────────────────────────────────────
  // Priority: active store's orgId → UserOrg primary → User.orgId (legacy home).
  let activeOrgId: string | null = activeStoreOrgId;

  if (!activeOrgId) {
    const primary = userOrgRows.find(r => r.isPrimary);
    activeOrgId = primary?.orgId ?? userOrgRows[0]?.orgId ?? user.orgId ?? null;
  }

  // Platform superadmin override via X-Tenant-Id — handled here for consistency
  // (the dedicated allowTenantOverride middleware can still be used; this keeps
  // the behaviour identical without requiring the extra call).
  const tenantOverrideRaw = req.headers['x-tenant-id'];
  const tenantOverride =
    typeof tenantOverrideRaw === 'string'
      ? tenantOverrideRaw
      : Array.isArray(tenantOverrideRaw) ? tenantOverrideRaw[0] : null;
  if (tenantOverride && isPlatformRole) {
    activeOrgId = String(tenantOverride);
  }

  // ── 3. Resolve effective role for the active org ───────────────────────
  // Legacy home-org role stays the fallback so older code paths still work.
  const orgMembership = userOrgRows.find(r => r.orgId === activeOrgId);
  const effectiveRole = orgMembership?.role || user.role;

  // ── 4. Attach everything to req ────────────────────────────────────────
  req.orgId        = activeOrgId;
  req.tenantId     = activeOrgId;
  req.tenantFilter = activeOrgId ? { orgId: activeOrgId } : {};

  req.storeIds    = userStoreIds;
  req.storeId     = activeStoreId;
  req.storeFilter = activeStoreId ? { storeId: activeStoreId } : {};

  req.role   = effectiveRole;
  req.orgIds = membershipOrgIds;

  next();
};

/* ── Guard middleware ─────────────────────────────────────────────────────── */

export const requireTenant: RequestHandler = (req, res, next) => {
  if (!req.orgId) {
    res.status(403).json({
      error: 'This endpoint requires an organization account. Please contact support.',
    });
    return;
  }
  next();
};

/* ── Org existence guard ─────────────────────────────────────────────────── */

export const requireActiveTenant: RequestHandler = async (req, res, next) => {
  if (!req.orgId) {
    res.status(403).json({ error: 'No organization context.' });
    return;
  }

  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.orgId },
      select: { isActive: true, plan: true, trialEndsAt: true },
    });

    if (!org || !org.isActive) {
      res.status(403).json({ error: 'Organization account is inactive or suspended.' });
      return;
    }

    if (org.plan === 'trial' && org.trialEndsAt && org.trialEndsAt < new Date()) {
      res.status(402).json({
        error: 'Free trial has expired. Please upgrade to continue.',
        trialEndsAt: org.trialEndsAt,
      });
      return;
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
 * (scopeToTenant already honours X-Tenant-Id for superadmins; this exists
 * so routes that want to *require* the override can be explicit.)
 */
export const allowTenantOverride: RequestHandler = (req, res, next) => {
  const overrideRaw = req.headers['x-tenant-id'];
  const overrideId =
    typeof overrideRaw === 'string'
      ? overrideRaw
      : Array.isArray(overrideRaw) ? overrideRaw[0] : null;

  if (overrideId) {
    if (req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Tenant override requires superadmin role.' });
      return;
    }
    req.orgId        = overrideId;
    req.tenantId     = overrideId;
    req.tenantFilter = { orgId: overrideId };
  }

  next();
};
