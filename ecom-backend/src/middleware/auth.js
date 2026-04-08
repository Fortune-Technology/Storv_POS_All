/**
 * JWT authentication middleware for the ecom-backend.
 * Shares the same JWT_SECRET as the POS backend.
 *
 * Extracts orgId from JWT payload (added in POS auth login/signup).
 * Reads storeId from X-Store-Id header.
 */

import jwt from 'jsonwebtoken';

export const protect = (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Not authorized — no token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      id: decoded.id,
      orgId: decoded.orgId || null,
      role: decoded.role,
      name: decoded.name,
      email: decoded.email,
    };

    req.orgId = decoded.orgId || null;

    // Active store from X-Store-Id header
    const headerStoreId = req.headers['x-store-id'] || null;
    req.storeId = headerStoreId || null;

    // Fallback: read orgId from X-Org-Id header if not in JWT (legacy tokens)
    if (!req.orgId && req.headers['x-org-id']) {
      req.orgId = req.headers['x-org-id'];
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Not authorized — invalid token' });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Role ${req.user?.role} is not authorized for this route`,
      });
    }
    next();
  };
};
