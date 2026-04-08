/**
 * Guard middleware: ensures the active store has e-commerce enabled.
 * Must run after auth middleware (needs req.storeId).
 */

import prisma from '../config/postgres.js';

export const requireEcomEnabled = async (req, res, next) => {
  if (!req.storeId) {
    return res.status(400).json({ error: 'X-Store-Id header is required' });
  }

  try {
    const store = await prisma.ecomStore.findUnique({
      where: { storeId: req.storeId },
      select: { enabled: true },
    });

    if (!store) {
      return res.status(404).json({
        error: 'E-commerce is not set up for this store. Enable it in Store Setup.',
      });
    }

    if (!store.enabled) {
      return res.status(403).json({
        error: 'E-commerce is disabled for this store.',
      });
    }

    next();
  } catch (err) {
    next(err);
  }
};
