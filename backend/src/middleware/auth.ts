import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import prisma from '../config/postgres.js';
import { scopeToTenant } from './scopeToTenant.js';

/**
 * JWT payload shape produced by /auth/login + /auth/signup.
 * Only `id` is required; the rest are nice-to-haves cached at issue time.
 */
interface JwtUserPayload {
  id: string;
  role?: string;
  orgId?: string | null;
  storeIds?: string[];
}

/**
 * `protect` — JWT auth gate. Loads the user (with `orgs` + `stores.store.orgId`
 * relations needed by `scopeToTenant`) and attaches it to `req.user`, then
 * delegates to `scopeToTenant` to derive org/store context from the request.
 */
export const protect: RequestHandler = async (req, res, next) => {
  let token: string | undefined;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    res.status(401).json({ error: 'Not authorized to access this route' });
    return;
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[auth] JWT_SECRET is not set');
      res.status(500).json({ error: 'Server misconfigured' });
      return;
    }

    const decoded = jwt.verify(token, secret) as JwtUserPayload;

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: {
        // Stores the user has direct access to; store.orgId is needed so
        // scopeToTenant can derive the active org from the active store.
        stores: {
          select: {
            storeId: true,
            store: { select: { orgId: true } },
          },
        },
        // All organisations the user has access to (multi-org support).
        // Each row carries the effective role for that specific org.
        orgs: {
          select: { orgId: true, role: true, isPrimary: true },
        },
      },
    });

    if (!user) {
      res.status(401).json({ error: 'Not authorized to access this route' });
      return;
    }

    // Check user account status — pending users can only access onboarding endpoints.
    // S77 added /api/vendor-onboarding to the allowlist so the new business
    // questionnaire is reachable BEFORE admin approves the user.
    // /api/auth/* is also allowed (e.g. verify-password, the InactivityLock unlock).
    if (user.status && user.status !== 'active') {
      const path = req.originalUrl || req.path;
      const isOnboardingRoute =
        path.startsWith('/api/tenants') ||
        path.startsWith('/api/stores') ||
        path.startsWith('/api/vendor-onboarding') ||
        path.startsWith('/api/contracts') ||  // S77 Phase 2 — contract signing
        path.startsWith('/api/auth');
      const isSuperadmin = user.role === 'superadmin';

      if (!isOnboardingRoute && !isSuperadmin) {
        res.status(403).json({ error: 'Account is not active. Please wait for administrator approval.' });
        return;
      }
    }

    req.user = user;
    scopeToTenant(req, res, next);
  } catch {
    res.status(401).json({ error: 'Not authorized to access this route' });
  }
};

/**
 * `authorize(...roles)` — role gate. Must run after `protect` + `scopeToTenant`.
 * Prefers the per-active-org effective role (set by scopeToTenant from UserOrg)
 * over the legacy home-org role stored on the User row.
 */
export const authorize = (...roles: string[]): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const effectiveRole = req.role || req.user?.role;
    if (!req.user || !effectiveRole || !roles.includes(effectiveRole)) {
      res.status(403).json({
        error: `User role ${effectiveRole} is not authorized to access this route`,
      });
      return;
    }
    next();
  };
};
