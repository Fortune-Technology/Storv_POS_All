/**
 * Manual sync: copies products and departments from the POS database
 * to the ecom database for a specific store.
 *
 * Usage:
 *   cd ecom-backend
 *   node prisma/syncFromPOS.js
 *
 * Env vars (or edit below):
 *   POS_DATABASE_URL — POS database connection string
 *   STORE_ID — the POS store ID to sync
 *   STORE_SLUG — the ecom store slug
 */

import { PrismaClient } from '@prisma/client';
import { PrismaClient as POSPrismaClient } from '../../backend/node_modules/@prisma/client/index.js';
import dotenv from 'dotenv';

dotenv.config();

// Connect to ecom database
const ecom = new PrismaClient();

// Connect to POS database (uses the POS backend's DATABASE_URL)
const pos = new POSPrismaClient({
  datasources: {
    db: { url: process.env.POS_DATABASE_URL || 'postgresql://postgres:J@ivik2001@localhost:5432/Store_Veu' },
  },
});

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function main() {
  // Find the ecom store
  const ecomStore = await ecom.ecomStore.findFirst({ where: { enabled: true } });
  if (!ecomStore) {
    console.error('No enabled ecom store found. Enable e-commerce from the portal first.');
    process.exit(1);
  }

  const { orgId, storeId, slug } = ecomStore;
  console.log(`\nSyncing POS → Ecom for store: ${ecomStore.storeName} (${slug})\n`);

  // Sync departments
  const departments = await pos.department.findMany({
    where: { orgId, active: true },
    orderBy: { sortOrder: 'asc' },
  });

  let deptCount = 0;
  for (const d of departments) {
    await ecom.ecomDepartment.upsert({
      where: { storeId_posDepartmentId: { storeId, posDepartmentId: d.id } },
      update: { name: d.name, slug: slugify(d.name), visible: true, lastSyncedAt: new Date() },
      create: { orgId, storeId, posDepartmentId: d.id, name: d.name, slug: slugify(d.name), visible: true, lastSyncedAt: new Date() },
    });
    deptCount++;
  }
  console.log(`  ✓ ${deptCount} departments synced`);

  // Sync products (not hidden from ecom, active, not deleted)
  const products = await pos.masterProduct.findMany({
    where: { orgId, active: true, deleted: false, hideFromEcom: false },
    include: { department: { select: { name: true } } },
  });

  // Also get store-level overrides
  const storeProducts = await pos.storeProduct.findMany({
    where: { orgId, storeId },
  });
  const spMap = {};
  for (const sp of storeProducts) spMap[sp.masterProductId] = sp;

  let prodCount = 0;
  for (const p of products) {
    const sp = spMap[p.id];
    const retailPrice = sp?.retailPrice || p.defaultRetailPrice || 0;
    const costPrice = sp?.costPrice || p.defaultCostPrice || null;
    const slug = slugify(`${p.name}-${p.id}`);

    await ecom.ecomProduct.upsert({
      where: { storeId_posProductId: { storeId, posProductId: p.id } },
      update: {
        name: p.name, slug, brand: p.brand, imageUrl: p.imageUrl,
        description: p.ecomDescription || p.description,
        tags: p.ecomTags || [],
        departmentName: p.department?.name || null,
        departmentSlug: p.department?.name ? slugify(p.department.name) : null,
        retailPrice: Number(retailPrice),
        costPrice: costPrice ? Number(costPrice) : null,
        salePrice: sp?.salePrice ? Number(sp.salePrice) : null,
        inStock: sp?.inStock !== false,
        quantityOnHand: sp?.quantityOnHand != null ? Number(sp.quantityOnHand) : null,
        taxable: p.taxable, ebtEligible: p.ebtEligible, ageRequired: p.ageRequired,
        size: p.size, visible: true, lastSyncedAt: new Date(),
      },
      create: {
        orgId, storeId, posProductId: p.id,
        name: p.name, slug, brand: p.brand, imageUrl: p.imageUrl,
        description: p.ecomDescription || p.description,
        tags: p.ecomTags || [],
        departmentName: p.department?.name || null,
        departmentSlug: p.department?.name ? slugify(p.department.name) : null,
        retailPrice: Number(retailPrice),
        costPrice: costPrice ? Number(costPrice) : null,
        inStock: sp?.inStock !== false,
        quantityOnHand: sp?.quantityOnHand != null ? Number(sp.quantityOnHand) : null,
        taxable: p.taxable, ebtEligible: p.ebtEligible, ageRequired: p.ageRequired,
        size: p.size, visible: true, lastSyncedAt: new Date(),
      },
    });
    prodCount++;
  }
  console.log(`  ✓ ${prodCount} products synced`);
  console.log(`\n✅ Sync complete! Visit: http://localhost:3000?store=${slug}\n`);
}

main()
  .catch(e => { console.error('Sync failed:', e.message); process.exit(1); })
  .finally(async () => { await ecom.$disconnect(); await pos.$disconnect(); });
