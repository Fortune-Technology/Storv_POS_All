/**
 * Store resolver middleware for public storefront routes.
 * Resolves a store slug (from URL params or hostname) into the
 * EcomStore record and attaches it to req.ecomStore.
 */

import prisma from '../config/postgres.js';

/**
 * Resolve store from :slug URL param.
 * Usage: router.get('/store/:slug/products', resolveStoreBySlug, listProducts)
 */
export const resolveStoreBySlug = async (req, res, next) => {
  const { slug } = req.params;

  if (!slug) {
    return res.status(400).json({ error: 'Store slug is required' });
  }

  try {
    const store = await prisma.ecomStore.findUnique({
      where: { slug },
      select: {
        id: true,
        orgId: true,
        storeId: true,
        storeName: true,
        slug: true,
        customDomain: true,
        enabled: true,
        branding: true,
        seoDefaults: true,
        socialLinks: true,
        fulfillmentConfig: true,
        timezone: true,
      },
    });

    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    if (!store.enabled) {
      return res.status(503).json({ error: 'This online store is currently unavailable' });
    }

    req.ecomStore = store;
    req.orgId = store.orgId;
    req.storeId = store.storeId;

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Resolve store from hostname (custom domain or subdomain).
 * Usage: app.use(resolveStoreByHost) — global middleware for storefront.
 */
export const resolveStoreByHost = async (req, res, next) => {
  const host = req.hostname;

  if (!host) return next();

  try {
    // Try custom domain first
    let store = await prisma.ecomStore.findUnique({
      where: { customDomain: host },
    });

    // Try subdomain pattern: {slug}.shop.thefortunetech.com
    if (!store) {
      const parts = host.split('.');
      if (parts.length >= 3 && parts[1] === 'shop') {
        store = await prisma.ecomStore.findUnique({
          where: { slug: parts[0] },
        });
      }
    }

    if (store && store.enabled) {
      req.ecomStore = store;
      req.orgId = store.orgId;
      req.storeId = store.storeId;
    }

    next();
  } catch (err) {
    next(err);
  }
};
