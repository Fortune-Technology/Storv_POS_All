/**
 * Global type declarations for the backend.
 *
 * The big section here is the `Express.Request` augmentation: every route
 * handler downstream of `protect` + `scopeToTenant` sees these properties,
 * so we declare them once globally instead of asserting `req as any` in every
 * controller. When new middleware adds properties, append to this block.
 *
 * Convention: properties added by middleware are optional in the type because
 * a route that bypasses `protect` may not have them. Controllers that always
 * run after `protect` can assert non-null where needed.
 */

import type { Prisma, Organization } from '@prisma/client';

/**
 * The shape `protect` middleware loads onto `req.user`. Includes the relation
 * data `scopeToTenant` reads (orgs + stores.store.orgId).
 */
export type AuthedUser = Prisma.UserGetPayload<{
  include: {
    stores: {
      select: {
        storeId: true;
        store: { select: { orgId: true } };
      };
    };
    orgs: {
      select: { orgId: true; role: true; isPrimary: true };
    };
  };
}>;

/**
 * Extension of AuthedUser used by `attachPOSUser` middleware on /api/pos/*
 * routes. Carries the resolved POS credentials so controllers can call the
 * external POS without re-loading them.
 */
export interface POSUser extends AuthedUser {
  posUsername: string;
  posPassword: string;
  posConfig: {
    baseURL: string;
    securityCode: string;
    accessLevel: string;
  };
}

declare global {
  namespace Express {
    interface Request {
      // ── set by `protect` middleware ──
      user?: AuthedUser;

      // ── set by `scopeToTenant` middleware ──
      /** Active organization id (resolved from active store, or user's primary org). */
      orgId?: string | null;
      /** Alias for orgId — kept for backward compatibility with catalog routes. */
      tenantId?: string | null;
      /** Prisma `where` filter for org-scoping (`{ orgId } | {}`). */
      tenantFilter?: { orgId?: string };
      /** All store IDs the authenticated user has explicit UserStore access to. */
      storeIds?: string[];
      /** Active store id from `X-Store-Id` header, or first assigned store. */
      storeId?: string | null;
      /** Prisma `where` filter for store-scoping (`{ storeId } | {}`). */
      storeFilter?: { storeId?: string };
      /** Effective role for the active org (from UserOrg, falls back to User.role). */
      role?: string;
      /** All org ids the user has UserOrg membership in. */
      orgIds?: string[];

      // ── set by `requireActiveTenant` middleware ──
      /** Active org row, loaded if `requireActiveTenant` ran. */
      tenant?: Pick<Organization, 'isActive' | 'plan' | 'trialEndsAt'>;

      // ── set by `attachPOSUser` middleware (only on /api/pos/* routes) ──
      posUser?: POSUser;
    }
  }
}

// Empty export keeps this file in module mode so the `declare global` works.
export {};
