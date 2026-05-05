/**
 * Direct sync endpoint — called by POS backend when Redis/BullMQ is unavailable.
 * This is the HTTP fallback for the BullMQ sync pipeline.
 * No auth required (internal service-to-service call).
 *
 * F32 (S71d follow-up) — both /sync and /sync/full now apply the per-store
 * storefront pricingConfig pipeline (markup → rounding → exclusion → margin
 * guard → untracked-stock policy) before writing EcomProduct. The transform
 * is fetched from POS backend's `/api/internal/storefront-pricing/:storeId`
 * endpoint (cached 60s per store) and run via the JS port of marketplaceMarkup
 * helpers in `utils/marketplaceMarkup.js`.
 *
 * Backwards-compatible: if no storefront config row exists for a store, the
 * pipeline returns the raw price unchanged.
 */

import { Router } from 'express';
import prisma from '../config/postgres.js';
import { setCachedInventory } from '../config/redis.js';
import { getStorefrontPricing, invalidateStorefrontPricing } from '../services/storefrontPricingClient.js';
import { computeMarketplacePrice } from '../utils/marketplaceMarkup.js';

const router = Router();

/**
 * F32 — cache invalidation hook. Called by POS backend after admin saves
 * storefront pricingConfig in EcomSetup. Without this, the 60s cache TTL means
 * config changes take up to a minute to take effect on the next sync.
 *
 * Auth: same shared INTERNAL_API_KEY as the POS-side internal endpoint. We
 * accept the header here too for consistency.
 *
 * POST /sync/invalidate-pricing
 *   body: { storeId }
 */
router.post('/sync/invalidate-pricing', (req, res) => {
  const provided = req.headers['x-internal-api-key'];
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected || !provided || provided !== expected) {
    return res.status(401).json({ error: 'Invalid or missing X-Internal-Api-Key' });
  }
  const { storeId } = req.body || {};
  if (!storeId) return res.status(400).json({ error: 'storeId required' });
  invalidateStorefrontPricing(storeId);
  res.json({ success: true, invalidated: storeId });
});

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * F32 — apply storefront pricing transform for ONE product against ONE store.
 *
 * Returns one of:
 *   { skipped: true, skipReason: '...', visible: false }   ← caller hides on storefront
 *   { skipped: false, retailPrice: number, qty: number, visible: true }
 *
 * Falls back to raw price (no markup) when pricing config can't be fetched.
 *
 * @param {string} storeId
 * @param {object} payload  POS sync payload (has defaultRetailPrice, departmentId, etc.)
 * @param {number|string} posProductId
 * @param {number|null} departmentId  POS department id (used for category markup + exclusion + velocity window)
 */
async function applyStorefrontTransform(storeId, payload, posProductId, departmentId) {
  const basePrice = Number(payload.retailPrice ?? payload.defaultRetailPrice ?? 0);
  const costPrice = payload.costPrice != null ? Number(payload.costPrice)
                  : payload.defaultCostPrice != null ? Number(payload.defaultCostPrice)
                  : null;
  const qoh = payload.quantityOnHand != null ? Number(payload.quantityOnHand) : 0;
  const hasActivePromo = payload.salePrice != null && Number(payload.salePrice) > 0;

  const config = await getStorefrontPricing(storeId);

  // No config or fetch failed → raw passthrough (backwards-compatible)
  if (!config) {
    return {
      skipped: false,
      retailPrice: basePrice || 0,
      qty: qoh > 0 ? qoh : 0,
      visible: !payload.hideFromEcom,
    };
  }

  const avgDaily = config.velocityMap?.[String(posProductId)] ?? 0;

  const result = computeMarketplacePrice({
    basePrice,
    costPrice,
    departmentId,
    productId: posProductId,
    hasActivePromo,
    quantityOnHand: qoh,
    avgDaily,
    config: config.pricingConfig,
  });

  if (result.skipped) {
    // Hidden on storefront — but we still upsert a row so the sync log + IDs
    // stay consistent. visible: false hides it from the public catalog.
    return {
      skipped: true,
      skipReason: result.skipReason,
      retailPrice: basePrice || 0,
      qty: 0,
      visible: false,
    };
  }

  return {
    skipped: false,
    retailPrice: result.price,
    qty: result.qty,
    // hideFromEcom from POS still hides; otherwise visible because not skipped
    visible: !payload.hideFromEcom,
  };
}

router.post('/sync', async (req, res) => {
  try {
    const { orgId, storeId, entityType, entityId, action, payload } = req.body;

    if (!orgId || !entityType || !entityId || !action) {
      return res.status(400).json({ error: 'orgId, entityType, entityId, action required' });
    }

    // Record the sync event
    await prisma.syncEvent.create({
      data: { orgId, storeId, entityType, entityId: String(entityId), action, payload, status: 'processed', processedAt: new Date() },
    }).catch(() => {});

    if (entityType === 'product') {
      if (action === 'delete') {
        await prisma.ecomProduct.updateMany({
          where: { orgId, posProductId: parseInt(entityId) },
          data: { visible: false, inStock: false },
        });
      } else if (payload) {
        const stores = await prisma.ecomStore.findMany({ where: { orgId, enabled: true }, select: { storeId: true } });
        const slug = slugify(`${payload.name}-${entityId}`);
        const posProductId = parseInt(entityId);
        const departmentId = payload.departmentId ?? null;

        for (const store of stores) {
          // F32 — apply storefront pricing transform per store
          const transform = await applyStorefrontTransform(store.storeId, payload, posProductId, departmentId);

          await prisma.ecomProduct.upsert({
            where: { storeId_posProductId: { storeId: store.storeId, posProductId } },
            update: {
              name: payload.name, slug, brand: payload.brand || null, imageUrl: payload.imageUrl || null,
              description: payload.ecomDescription || payload.description || null,
              tags: payload.ecomTags || [], departmentName: payload.departmentName || null,
              departmentSlug: payload.departmentName ? slugify(payload.departmentName) : null,
              retailPrice: transform.retailPrice,
              costPrice: payload.costPrice || payload.defaultCostPrice || null,
              taxable: payload.taxable ?? true, ebtEligible: payload.ebtEligible ?? false,
              ageRequired: payload.ageRequired || null, size: payload.size || null,
              quantityOnHand: transform.qty,
              visible: transform.visible, lastSyncedAt: new Date(),
            },
            create: {
              orgId, storeId: store.storeId, posProductId,
              name: payload.name, slug, brand: payload.brand || null, imageUrl: payload.imageUrl || null,
              description: payload.ecomDescription || payload.description || null,
              tags: payload.ecomTags || [], departmentName: payload.departmentName || null,
              departmentSlug: payload.departmentName ? slugify(payload.departmentName) : null,
              retailPrice: transform.retailPrice,
              costPrice: payload.costPrice || payload.defaultCostPrice || null,
              taxable: payload.taxable ?? true, ebtEligible: payload.ebtEligible ?? false,
              ageRequired: payload.ageRequired || null, size: payload.size || null,
              quantityOnHand: transform.qty,
              visible: transform.visible, lastSyncedAt: new Date(),
            },
          });
        }
      }
    } else if (entityType === 'department') {
      if (action === 'delete') {
        await prisma.ecomDepartment.updateMany({ where: { orgId, posDepartmentId: parseInt(entityId) }, data: { visible: false } });
      } else if (payload) {
        const stores = await prisma.ecomStore.findMany({ where: { orgId, enabled: true }, select: { storeId: true } });
        const slug = slugify(payload.name);
        for (const store of stores) {
          await prisma.ecomDepartment.upsert({
            where: { storeId_posDepartmentId: { storeId: store.storeId, posDepartmentId: parseInt(entityId) } },
            update: { name: payload.name, slug, visible: payload.active !== false, lastSyncedAt: new Date() },
            create: { orgId, storeId: store.storeId, posDepartmentId: parseInt(entityId), name: payload.name, slug, visible: payload.active !== false, lastSyncedAt: new Date() },
          });
        }
      }
    } else if (entityType === 'inventory' && payload && storeId) {
      const posProductId = parseInt(String(entityId).split(':')[1] || entityId);

      // F32 — when retailPrice changes, re-apply storefront transform.
      // For pure stock-only updates (no retailPrice in payload), preserve
      // current retail and only update qty + inStock flags.
      let updateData = {
        quantityOnHand: payload.quantityOnHand ?? null,
        inStock: payload.inStock !== false,
        lastSyncedAt: new Date(),
      };
      if (payload.retailPrice != null) {
        const transform = await applyStorefrontTransform(storeId, payload, posProductId, payload.departmentId ?? null);
        updateData.retailPrice = transform.retailPrice;
        // Per-product visible flag also follows the transform (excluded → hidden)
        updateData.visible = transform.visible;
        // Use the transformed qty (smart QoH) when present
        if (transform.qty != null) updateData.quantityOnHand = transform.qty;
      }
      await prisma.ecomProduct.updateMany({
        where: { storeId, posProductId },
        data: updateData,
      });
      await setCachedInventory(storeId, posProductId, { qty: payload.quantityOnHand, inStock: payload.inStock !== false });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[direct-sync] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Full sync — pulls ALL products + departments from POS backend
 * and upserts into the ecom database.
 * Called from portal "Sync Now" button.
 *
 * F32 — applies the storefront pricing pipeline for every product upsert.
 * Single store scope (the X-Store-Id header), so we fetch the storefront
 * pricingConfig once at the start and reuse it for every product.
 */
router.post('/sync/full', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const storeId = req.headers['x-store-id'];
    const orgId = req.headers['x-org-id'];

    if (!storeId || !orgId) {
      return res.status(400).json({ error: 'X-Store-Id and X-Org-Id headers required' });
    }

    // Check ecom store exists
    const ecomStore = await prisma.ecomStore.findUnique({ where: { storeId } });
    if (!ecomStore || !ecomStore.enabled) {
      return res.status(400).json({ error: 'E-commerce not enabled for this store' });
    }

    const POS_URL = process.env.POS_BACKEND_URL || 'http://localhost:5000';

    // F32 — fetch storefront pricing config ONCE for this full sync.
    // The client caches anyway, but explicit fetch makes the data flow clearer.
    const pricingResp = await getStorefrontPricing(storeId);
    let skippedCount = 0;
    const skipReasons = {};

    // Fetch departments from POS
    let deptCount = 0;
    try {
      const deptResp = await fetch(`${POS_URL}/api/catalog/departments`, {
        headers: { Authorization: authHeader, 'X-Store-Id': storeId },
      });
      const deptData = await deptResp.json();
      const departments = deptData.data || deptData || [];

      for (const d of (Array.isArray(departments) ? departments : [])) {
        await prisma.ecomDepartment.upsert({
          where: { storeId_posDepartmentId: { storeId, posDepartmentId: d.id } },
          update: { name: d.name, slug: slugify(d.name), visible: d.active !== false, lastSyncedAt: new Date() },
          create: { orgId, storeId, posDepartmentId: d.id, name: d.name, slug: slugify(d.name), visible: d.active !== false, lastSyncedAt: new Date() },
        });
        deptCount++;
      }
    } catch (err) {
      console.error('[full-sync] Dept fetch failed:', err.message);
    }

    // Fetch products from POS (paginated)
    let prodCount = 0;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const prodResp = await fetch(`${POS_URL}/api/catalog/products?page=${page}&limit=200`, {
          headers: { Authorization: authHeader, 'X-Store-Id': storeId },
        });
        const prodData = await prodResp.json();
        const products = prodData.data || [];

        if (products.length === 0) { hasMore = false; break; }

        for (const p of products) {
          if (p.hideFromEcom || p.deleted) continue;

          const pSlug = slugify(`${p.name}-${p.id}`);

          // F32 — apply storefront pricing transform per product
          const transform = await applyStorefrontTransform(
            storeId,
            {
              defaultRetailPrice: p.defaultRetailPrice,
              defaultCostPrice: p.defaultCostPrice,
              departmentId: p.departmentId ?? p.department?.id ?? null,
              quantityOnHand: p.quantityOnHand ?? 0,
              salePrice: p.salePrice,
              hideFromEcom: p.hideFromEcom,
            },
            p.id,
            p.departmentId ?? p.department?.id ?? null,
          );

          if (transform.skipped) {
            skippedCount++;
            skipReasons[transform.skipReason] = (skipReasons[transform.skipReason] || 0) + 1;
          }

          await prisma.ecomProduct.upsert({
            where: { storeId_posProductId: { storeId, posProductId: p.id } },
            update: {
              name: p.name, slug: pSlug, brand: p.brand || null, imageUrl: p.imageUrl || null,
              description: p.ecomDescription || p.description || null,
              tags: p.ecomTags || [],
              departmentName: p.department?.name || null,
              departmentSlug: p.department?.name ? slugify(p.department.name) : null,
              retailPrice: transform.retailPrice,
              costPrice: p.defaultCostPrice ? Number(p.defaultCostPrice) : null,
              taxable: p.taxable ?? true, ebtEligible: p.ebtEligible ?? false,
              ageRequired: p.ageRequired || null, size: p.size || null,
              quantityOnHand: transform.qty,
              visible: transform.visible, inStock: transform.qty > 0, lastSyncedAt: new Date(),
            },
            create: {
              orgId, storeId, posProductId: p.id,
              name: p.name, slug: pSlug, brand: p.brand || null, imageUrl: p.imageUrl || null,
              description: p.ecomDescription || p.description || null,
              tags: p.ecomTags || [],
              departmentName: p.department?.name || null,
              departmentSlug: p.department?.name ? slugify(p.department.name) : null,
              retailPrice: transform.retailPrice,
              costPrice: p.defaultCostPrice ? Number(p.defaultCostPrice) : null,
              taxable: p.taxable ?? true, ebtEligible: p.ebtEligible ?? false,
              ageRequired: p.ageRequired || null, size: p.size || null,
              quantityOnHand: transform.qty,
              visible: transform.visible, inStock: transform.qty > 0, lastSyncedAt: new Date(),
            },
          });
          prodCount++;
        }

        page++;
        if (products.length < 200) hasMore = false;
      } catch (err) {
        console.error('[full-sync] Product fetch page', page, 'failed:', err.message);
        hasMore = false;
      }
    }

    res.json({
      success: true,
      synced: { departments: deptCount, products: prodCount },
      pricing: {
        configActive: pricingResp != null,
        skippedCount,
        skipReasons,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
