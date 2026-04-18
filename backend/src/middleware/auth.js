import jwt from 'jsonwebtoken';
import prisma from '../config/postgres.js';
import { scopeToTenant } from './scopeToTenant.js';

export const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Not authorized to access this route' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

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
      return res.status(401).json({ error: 'Not authorized to access this route' });
    }

    // Check user account status — pending users can only access onboarding endpoints
    if (user.status && user.status !== 'active') {
      const path = req.originalUrl || req.path;
      const isOnboardingRoute = path.startsWith('/api/tenants') || path.startsWith('/api/stores');
      const isSuperadmin = user.role === 'superadmin';

      if (!isOnboardingRoute && !isSuperadmin) {
        return res.status(403).json({ error: 'Account is not active. Please wait for administrator approval.' });
      }
    }

    req.user = user;
    scopeToTenant(req, res, next);
  } catch (err) {
    return res.status(401).json({ error: 'Not authorized to access this route' });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    // Prefer the per-active-org effective role (set by scopeToTenant from
    // UserOrg) over the legacy home-org role stored on the User row.
    const effectiveRole = req.role || req.user?.role;
    if (!req.user || !roles.includes(effectiveRole)) {
      return res.status(403).json({
        error: `User role ${effectiveRole} is not authorized to access this route`,
      });
    }
    next();
  };
};
