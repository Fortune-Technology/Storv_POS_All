/**
 * BullMQ sync worker — consumes product/department/inventory events
 * from the POS backend and writes them into the e-commerce database.
 *
 * This is the core of the POS → ecom data pipeline.
 */

import { Worker } from 'bullmq';
import { getRedisClient } from '@storv/redis';
import prisma from '../config/postgres.js';
import { setCachedInventory } from '../config/redis.js';
import { revalidateProduct, revalidateProductListing, revalidateDepartment } from '../services/revalidationService.js';

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/* ── Handlers ───────────────────────────────────────────────────────────── */

async function handleProductSync(data) {
  const { orgId, entityId, action, payload } = data;

  if (action === 'delete') {
    // Soft-delete: hide from storefront
    await prisma.ecomProduct.updateMany({
      where: { orgId, posProductId: parseInt(entityId) },
      data: { visible: false, inStock: false },
    });
    await revalidateProductListing();
    return;
  }

  if (!payload) return;

  // Upsert for every store that has ecom enabled
  const stores = await prisma.ecomStore.findMany({
    where: { orgId, enabled: true },
    select: { storeId: true, slug: true },
  });

  for (const store of stores) {
    const slug = slugify(`${payload.name}-${entityId}`);

    const ecomProduct = await prisma.ecomProduct.upsert({
      where: {
        storeId_posProductId: {
          storeId: store.storeId,
          posProductId: parseInt(entityId),
        },
      },
      update: {
        name: payload.name,
        slug,
        description: payload.ecomDescription || payload.description || null,
        brand: payload.brand || null,
        imageUrl: payload.imageUrl || null,
        tags: payload.ecomTags || [],
        departmentName: payload.departmentName || null,
        departmentSlug: payload.departmentName ? slugify(payload.departmentName) : null,
        retailPrice: payload.retailPrice || payload.defaultRetailPrice || 0,
        salePrice: payload.salePrice || null,
        saleStart: payload.saleStart || null,
        saleEnd: payload.saleEnd || null,
        costPrice: payload.costPrice || payload.defaultCostPrice || null,
        inStock: payload.inStock !== false,
        quantityOnHand: payload.quantityOnHand ?? null,
        trackInventory: payload.trackInventory ?? true,
        taxable: payload.taxable ?? true,
        taxClass: payload.taxClass || null,
        ebtEligible: payload.ebtEligible ?? false,
        ageRequired: payload.ageRequired || null,
        size: payload.size || null,
        weight: payload.weight || null,
        visible: payload.hideFromEcom ? false : undefined,
        lastSyncedAt: new Date(),
        syncVersion: { increment: 1 },
      },
      create: {
        orgId,
        storeId: store.storeId,
        posProductId: parseInt(entityId),
        name: payload.name,
        slug,
        description: payload.ecomDescription || payload.description || null,
        brand: payload.brand || null,
        imageUrl: payload.imageUrl || null,
        tags: payload.ecomTags || [],
        departmentName: payload.departmentName || null,
        departmentSlug: payload.departmentName ? slugify(payload.departmentName) : null,
        retailPrice: payload.retailPrice || payload.defaultRetailPrice || 0,
        costPrice: payload.costPrice || payload.defaultCostPrice || null,
        inStock: payload.inStock !== false,
        quantityOnHand: payload.quantityOnHand ?? null,
        trackInventory: payload.trackInventory ?? true,
        taxable: payload.taxable ?? true,
        taxClass: payload.taxClass || null,
        ebtEligible: payload.ebtEligible ?? false,
        ageRequired: payload.ageRequired || null,
        size: payload.size || null,
        weight: payload.weight || null,
        visible: !payload.hideFromEcom,
        lastSyncedAt: new Date(),
      },
    });

    await revalidateProduct(store.slug, ecomProduct.slug);
  }

  await revalidateProductListing();
}

async function handleDepartmentSync(data) {
  const { orgId, entityId, action, payload } = data;

  if (action === 'delete') {
    await prisma.ecomDepartment.updateMany({
      where: { orgId, posDepartmentId: parseInt(entityId) },
      data: { visible: false },
    });
    return;
  }

  if (!payload) return;

  const stores = await prisma.ecomStore.findMany({
    where: { orgId, enabled: true },
    select: { storeId: true },
  });

  const slug = slugify(payload.name);

  for (const store of stores) {
    await prisma.ecomDepartment.upsert({
      where: {
        storeId_posDepartmentId: {
          storeId: store.storeId,
          posDepartmentId: parseInt(entityId),
        },
      },
      update: {
        name: payload.name,
        slug,
        description: payload.description || null,
        visible: payload.active !== false,
        lastSyncedAt: new Date(),
      },
      create: {
        orgId,
        storeId: store.storeId,
        posDepartmentId: parseInt(entityId),
        name: payload.name,
        slug,
        description: payload.description || null,
        visible: payload.active !== false,
        lastSyncedAt: new Date(),
      },
    });
  }

  await revalidateDepartment(slug);
}

async function handleInventorySync(data) {
  const { orgId, storeId, entityId, payload } = data;

  if (!payload || !storeId) return;

  const posProductId = parseInt(entityId.split(':')[1] || entityId);

  // Update ecom DB
  await prisma.ecomProduct.updateMany({
    where: { storeId, posProductId },
    data: {
      quantityOnHand: payload.quantityOnHand ?? null,
      inStock: payload.inStock !== false,
      retailPrice: payload.retailPrice || undefined,
      lastSyncedAt: new Date(),
    },
  });

  // Update Redis cache
  await setCachedInventory(storeId, posProductId, {
    qty: payload.quantityOnHand,
    inStock: payload.inStock !== false,
  });
}

/* ── Worker ─────────────────────────────────────────────────────────────── */

let _worker = null;

export function startSyncWorker() {
  if (_worker) return _worker;

  _worker = new Worker(
    'ecom-sync',
    async (job) => {
      const { entityType } = job.data;

      // Record sync event
      const syncEvent = await prisma.syncEvent.create({
        data: {
          orgId: job.data.orgId,
          storeId: job.data.storeId || null,
          entityType,
          entityId: job.data.entityId,
          action: job.data.action,
          payload: job.data.payload,
          status: 'pending',
        },
      });

      try {
        switch (entityType) {
          case 'product':
            await handleProductSync(job.data);
            break;
          case 'department':
            await handleDepartmentSync(job.data);
            break;
          case 'inventory':
            await handleInventorySync(job.data);
            break;
          default:
            console.warn(`[sync-worker] Unknown entity type: ${entityType}`);
        }

        await prisma.syncEvent.update({
          where: { id: syncEvent.id },
          data: { status: 'processed', processedAt: new Date() },
        });
      } catch (err) {
        await prisma.syncEvent.update({
          where: { id: syncEvent.id },
          data: {
            status: 'failed',
            error: err.message,
            attempts: { increment: 1 },
          },
        });
        throw err; // BullMQ will retry based on job options
      }
    },
    {
      connection: getRedisClient(),
      concurrency: 5,
    }
  );

  _worker.on('completed', (job) => {
    console.log(`[sync-worker] ✓ ${job.name} processed`);
  });

  _worker.on('failed', (job, err) => {
    console.error(`[sync-worker] ✗ ${job.name} failed:`, err.message);
  });

  console.log('✓ E-commerce sync worker started');
  return _worker;
}

export function getSyncWorker() {
  return _worker;
}
