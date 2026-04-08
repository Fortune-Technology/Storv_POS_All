/**
 * Direct sync endpoint — called by POS backend when Redis/BullMQ is unavailable.
 * This is the HTTP fallback for the BullMQ sync pipeline.
 * No auth required (internal service-to-service call).
 */

import { Router } from 'express';
import prisma from '../config/postgres.js';
import { setCachedInventory } from '../config/redis.js';

const router = Router();

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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

        for (const store of stores) {
          await prisma.ecomProduct.upsert({
            where: { storeId_posProductId: { storeId: store.storeId, posProductId: parseInt(entityId) } },
            update: {
              name: payload.name, slug, brand: payload.brand || null, imageUrl: payload.imageUrl || null,
              description: payload.ecomDescription || payload.description || null,
              tags: payload.ecomTags || [], departmentName: payload.departmentName || null,
              departmentSlug: payload.departmentName ? slugify(payload.departmentName) : null,
              retailPrice: payload.retailPrice || payload.defaultRetailPrice || 0,
              costPrice: payload.costPrice || payload.defaultCostPrice || null,
              taxable: payload.taxable ?? true, ebtEligible: payload.ebtEligible ?? false,
              ageRequired: payload.ageRequired || null, size: payload.size || null,
              visible: !payload.hideFromEcom, lastSyncedAt: new Date(),
            },
            create: {
              orgId, storeId: store.storeId, posProductId: parseInt(entityId),
              name: payload.name, slug, brand: payload.brand || null, imageUrl: payload.imageUrl || null,
              description: payload.ecomDescription || payload.description || null,
              tags: payload.ecomTags || [], departmentName: payload.departmentName || null,
              departmentSlug: payload.departmentName ? slugify(payload.departmentName) : null,
              retailPrice: payload.retailPrice || payload.defaultRetailPrice || 0,
              costPrice: payload.costPrice || payload.defaultCostPrice || null,
              taxable: payload.taxable ?? true, ebtEligible: payload.ebtEligible ?? false,
              ageRequired: payload.ageRequired || null, size: payload.size || null,
              visible: !payload.hideFromEcom, lastSyncedAt: new Date(),
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
      await prisma.ecomProduct.updateMany({
        where: { storeId, posProductId },
        data: { quantityOnHand: payload.quantityOnHand ?? null, inStock: payload.inStock !== false, retailPrice: payload.retailPrice || undefined, lastSyncedAt: new Date() },
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
          await prisma.ecomProduct.upsert({
            where: { storeId_posProductId: { storeId, posProductId: p.id } },
            update: {
              name: p.name, slug: pSlug, brand: p.brand || null, imageUrl: p.imageUrl || null,
              description: p.ecomDescription || p.description || null,
              tags: p.ecomTags || [],
              departmentName: p.department?.name || null,
              departmentSlug: p.department?.name ? slugify(p.department.name) : null,
              retailPrice: Number(p.defaultRetailPrice || 0),
              costPrice: p.defaultCostPrice ? Number(p.defaultCostPrice) : null,
              taxable: p.taxable ?? true, ebtEligible: p.ebtEligible ?? false,
              ageRequired: p.ageRequired || null, size: p.size || null,
              visible: true, inStock: true, lastSyncedAt: new Date(),
            },
            create: {
              orgId, storeId, posProductId: p.id,
              name: p.name, slug: pSlug, brand: p.brand || null, imageUrl: p.imageUrl || null,
              description: p.ecomDescription || p.description || null,
              tags: p.ecomTags || [],
              departmentName: p.department?.name || null,
              departmentSlug: p.department?.name ? slugify(p.department.name) : null,
              retailPrice: Number(p.defaultRetailPrice || 0),
              costPrice: p.defaultCostPrice ? Number(p.defaultCostPrice) : null,
              taxable: p.taxable ?? true, ebtEligible: p.ebtEligible ?? false,
              ageRequired: p.ageRequired || null, size: p.size || null,
              visible: true, inStock: true, lastSyncedAt: new Date(),
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

    res.json({ success: true, synced: { departments: deptCount, products: prodCount } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
