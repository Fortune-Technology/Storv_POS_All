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
        stores: {
          select: { storeId: true },
        },
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'Not authorized to access this route' });
    }

    req.user = user;
    scopeToTenant(req, res, next);
  } catch (err) {
    return res.status(401).json({ error: 'Not authorized to access this route' });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `User role ${req.user?.role} is not authorized to access this route`,
      });
    }
    next();
  };
};
