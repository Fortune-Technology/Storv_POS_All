/**
 * E-commerce store management controller.
 * Used by portal (authenticated) to configure the online store.
 */

import prisma from '../config/postgres.js';

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/* ── Get / Create / Update Store Config ─────────────────────────────────── */

export const getEcomStore = async (req, res) => {
  try {
    const store = await prisma.ecomStore.findUnique({
      where: { storeId: req.storeId },
    });

    res.json({ success: true, data: store });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const enableEcomStore = async (req, res) => {
  try {
    const { storeName, slug: customSlug } = req.body;

    if (!storeName) {
      return res.status(400).json({ error: 'storeName is required' });
    }
    if (!req.storeId) {
      return res.status(400).json({ error: 'Please select a store first (X-Store-Id header missing). Choose a store from the store switcher in the portal.' });
    }
    if (!req.orgId) {
      return res.status(400).json({ error: 'Organization context missing. Please log out and log back in.' });
    }

    const slug = customSlug ? slugify(customSlug) : slugify(storeName);

    const store = await prisma.ecomStore.upsert({
      where: { storeId: req.storeId },
      update: {
        storeName,
        slug,
        enabled: true,
      },
      create: {
        orgId: req.orgId,
        storeId: req.storeId,
        storeName,
        slug,
        enabled: true,
      },
    });

    res.json({ success: true, data: store });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Store slug is already taken. Choose a different name.' });
    }
    res.status(500).json({ error: err.message });
  }
};

export const disableEcomStore = async (req, res) => {
  try {
    const store = await prisma.ecomStore.update({
      where: { storeId: req.storeId },
      data: { enabled: false },
    });

    res.json({ success: true, data: store });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateEcomStore = async (req, res) => {
  try {
    const { branding, seoDefaults, socialLinks, fulfillmentConfig, timezone } = req.body;

    const data = {};
    if (branding !== undefined) data.branding = branding;
    if (seoDefaults !== undefined) data.seoDefaults = seoDefaults;
    if (socialLinks !== undefined) data.socialLinks = socialLinks;
    if (fulfillmentConfig !== undefined) data.fulfillmentConfig = fulfillmentConfig;
    if (timezone !== undefined) data.timezone = timezone;

    const store = await prisma.ecomStore.update({
      where: { storeId: req.storeId },
      data,
    });

    res.json({ success: true, data: store });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
