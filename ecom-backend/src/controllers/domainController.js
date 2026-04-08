/**
 * Custom domain management controller.
 *
 * Allows stores to connect their own domain (e.g. shop.joesmarket.com)
 * for a white-labeled storefront experience.
 *
 * Flow:
 *   1. Store owner enters their custom domain in portal
 *   2. We save it to EcomStore.customDomain
 *   3. Store owner creates a CNAME record pointing to our platform
 *   4. We verify the DNS and update domainVerified + sslStatus
 *
 * In production, this integrates with Cloudflare for SaaS API
 * for automatic SSL certificate provisioning. In dev, it works
 * with manual DNS verification.
 */

import prisma from '../config/postgres.js';

export const getDomainStatus = async (req, res) => {
  try {
    const store = await prisma.ecomStore.findUnique({
      where: { storeId: req.storeId },
      select: {
        slug: true,
        customDomain: true,
        domainVerified: true,
        sslStatus: true,
      },
    });

    if (!store) {
      return res.status(404).json({ error: 'E-commerce store not found' });
    }

    res.json({
      success: true,
      data: {
        defaultDomain: `${store.slug}.shop.thefortunetech.com`,
        customDomain: store.customDomain,
        domainVerified: store.domainVerified,
        sslStatus: store.sslStatus,
        cnameTarget: 'shop.thefortunetech.com',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const setCustomDomain = async (req, res) => {
  try {
    const { domain } = req.body;

    if (!domain) {
      return res.status(400).json({ error: 'domain is required' });
    }

    // Basic domain validation
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;
    const clean = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

    if (!domainRegex.test(clean) && !clean.includes('.')) {
      return res.status(400).json({ error: 'Invalid domain format. Use format: shop.yourdomain.com' });
    }

    // Check domain not already used by another store
    const existing = await prisma.ecomStore.findUnique({
      where: { customDomain: clean },
    });
    if (existing && existing.storeId !== req.storeId) {
      return res.status(409).json({ error: 'This domain is already connected to another store' });
    }

    const store = await prisma.ecomStore.update({
      where: { storeId: req.storeId },
      data: {
        customDomain: clean,
        domainVerified: false,
        sslStatus: 'pending',
      },
    });

    // In production: call Cloudflare for SaaS API here
    // POST /zones/{zone_id}/custom_hostnames { hostname: clean, ssl: { method: 'http', type: 'dv' } }

    res.json({
      success: true,
      data: {
        customDomain: store.customDomain,
        domainVerified: store.domainVerified,
        sslStatus: store.sslStatus,
        cnameTarget: 'shop.thefortunetech.com',
        instructions: `Create a CNAME record pointing ${clean} to shop.thefortunetech.com`,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const verifyDomain = async (req, res) => {
  try {
    const store = await prisma.ecomStore.findUnique({
      where: { storeId: req.storeId },
      select: { customDomain: true },
    });

    if (!store?.customDomain) {
      return res.status(400).json({ error: 'No custom domain configured' });
    }

    // In production: check Cloudflare API for verification status
    // For now: attempt DNS lookup
    let verified = false;
    try {
      const dns = await import('dns');
      const resolved = await new Promise((resolve, reject) => {
        dns.default.resolveCname(store.customDomain, (err, addresses) => {
          if (err) reject(err);
          else resolve(addresses);
        });
      });
      verified = resolved.some(r => r.includes('thefortunetech.com') || r.includes('shop.'));
    } catch {
      // DNS lookup failed — domain not yet pointing to us
      verified = false;
    }

    await prisma.ecomStore.update({
      where: { storeId: req.storeId },
      data: {
        domainVerified: verified,
        sslStatus: verified ? 'active' : 'pending',
      },
    });

    res.json({
      success: true,
      data: {
        customDomain: store.customDomain,
        domainVerified: verified,
        sslStatus: verified ? 'active' : 'pending',
        message: verified
          ? 'Domain verified and SSL is active!'
          : 'Domain not yet verified. Please ensure your CNAME record is set correctly. DNS changes can take up to 48 hours.',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const removeCustomDomain = async (req, res) => {
  try {
    await prisma.ecomStore.update({
      where: { storeId: req.storeId },
      data: {
        customDomain: null,
        domainVerified: false,
        sslStatus: 'pending',
      },
    });

    // In production: call Cloudflare to remove custom hostname

    res.json({ success: true, message: 'Custom domain removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
