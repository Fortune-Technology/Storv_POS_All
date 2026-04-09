/**
 * E-commerce Seed Script
 *
 * Creates a demo ecom store with products synced from the POS database,
 * sample CMS pages, and a test customer.
 *
 * Usage:
 *   cd ecom-backend && node prisma/seed.js
 *
 * Options:
 *   SEED_ORG_ID=xxx    — POS org ID (auto-detected if not set)
 *   SEED_STORE_ID=xxx  — POS store ID (auto-detected if not set)
 *   POS_DATABASE_URL=xxx — POS database URL (reads from ../backend/.env if not set)
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ecom = new PrismaClient();

// Try to load POS database URL from backend/.env
let POS_DB_URL = process.env.POS_DATABASE_URL;
if (!POS_DB_URL) {
  try {
    const backendEnv = fs.readFileSync(path.join(__dirname, '../../backend/.env'), 'utf-8');
    const match = backendEnv.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
    if (match) POS_DB_URL = match[1];
  } catch {}
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function main() {
  console.log('\n🌱 Seeding e-commerce database...\n');

  // ── 1. Try to connect to POS database to auto-detect org/store ─────
  let orgId = process.env.SEED_ORG_ID;
  let storeId = process.env.SEED_STORE_ID;
  let storeName = 'Demo Store';
  let posProducts = [];
  let posDepartments = [];

  if (POS_DB_URL) {
    try {
      const { PrismaClient: POSClient } = await import('../../backend/node_modules/@prisma/client/index.js');
      const pos = new POSClient({ datasources: { db: { url: POS_DB_URL } } });

      // Get first org + store
      if (!orgId) {
        const org = await pos.organization.findFirst({ where: { isActive: true } });
        if (org) orgId = org.id;
      }
      if (!storeId && orgId) {
        const store = await pos.store.findFirst({ where: { orgId, isActive: true } });
        if (store) { storeId = store.id; storeName = store.name; }
      }

      // Fetch departments + products
      if (orgId) {
        posDepartments = await pos.department.findMany({ where: { orgId, active: true }, orderBy: { sortOrder: 'asc' } });
        posProducts = await pos.masterProduct.findMany({
          where: { orgId, active: true, deleted: false, hideFromEcom: false },
          include: { department: { select: { name: true } } },
          take: 200,
        });

        // Get store-level prices if available
        if (storeId) {
          const storeProducts = await pos.storeProduct.findMany({ where: { orgId, storeId } });
          const spMap = {};
          storeProducts.forEach(sp => { spMap[sp.masterProductId] = sp; });
          posProducts = posProducts.map(p => ({ ...p, _sp: spMap[p.id] }));
        }
      }

      await pos.$disconnect();
      console.log(`  ✓ Connected to POS database — found ${posProducts.length} products, ${posDepartments.length} departments`);
    } catch (err) {
      console.log(`  ⚠ Could not connect to POS database: ${err.message}`);
      console.log('  → Using demo data instead\n');
    }
  }

  // Fallback IDs
  if (!orgId) orgId = 'demo-org';
  if (!storeId) storeId = 'demo-store';

  console.log(`  Org ID:   ${orgId}`);
  console.log(`  Store ID: ${storeId}`);
  console.log(`  Store:    ${storeName}\n`);

  const slug = slugify(storeName);

  // ── 2. Create EcomStore ────────────────────────────────────────────
  const store = await ecom.ecomStore.upsert({
    where: { storeId },
    update: { enabled: true, storeName },
    create: {
      orgId, storeId, storeName, slug, enabled: true,
      branding: {
        logoText: storeName,
        primaryColor: '#16a34a',
        fontFamily: "'Inter', sans-serif",
      },
      seoDefaults: {
        metaTitle: `${storeName} — Shop Online`,
        metaDescription: `Fresh groceries, snacks, beverages and more from ${storeName}. Order online for pickup or delivery.`,
      },
      fulfillmentConfig: {
        pickupEnabled: true,
        deliveryEnabled: true,
        minOrderAmount: 10,
        deliveryFee: 3.99,
        pickupHours: 'Mon-Sun 8AM-10PM',
      },
    },
  });
  console.log(`  ✓ EcomStore: "${store.storeName}" (slug: ${store.slug})`);

  // ── 3. Sync departments ────────────────────────────────────────────
  const deptSources = posDepartments.length > 0 ? posDepartments : [
    { id: 1, name: 'Beverages', active: true },
    { id: 2, name: 'Snacks', active: true },
    { id: 3, name: 'Dairy & Frozen', active: true },
    { id: 4, name: 'Grocery', active: true },
    { id: 5, name: 'Health & Beauty', active: true },
    { id: 6, name: 'Household', active: true },
  ];

  let deptCount = 0;
  for (const d of deptSources) {
    await ecom.ecomDepartment.upsert({
      where: { storeId_posDepartmentId: { storeId, posDepartmentId: d.id } },
      update: { name: d.name, slug: slugify(d.name), visible: d.active !== false, lastSyncedAt: new Date() },
      create: { orgId, storeId, posDepartmentId: d.id, name: d.name, slug: slugify(d.name), visible: d.active !== false, lastSyncedAt: new Date() },
    });
    deptCount++;
  }
  console.log(`  ✓ ${deptCount} departments synced`);

  // ── 4. Sync products ───────────────────────────────────────────────
  const prodSources = posProducts.length > 0 ? posProducts : getDemoProducts();

  let prodCount = 0;
  for (const p of prodSources) {
    const sp = p._sp;
    const retailPrice = Number(sp?.retailPrice || p.defaultRetailPrice || 0);
    const costPrice = sp?.costPrice || p.defaultCostPrice ? Number(sp?.costPrice || p.defaultCostPrice) : null;
    const pSlug = slugify(`${p.name}-${p.id}`);

    await ecom.ecomProduct.upsert({
      where: { storeId_posProductId: { storeId, posProductId: p.id } },
      update: {
        name: p.name, slug: pSlug, brand: p.brand || null, imageUrl: p.imageUrl || null,
        description: p.ecomDescription || p.description || null,
        tags: p.ecomTags || [], departmentName: p.department?.name || null,
        departmentSlug: p.department?.name ? slugify(p.department.name) : null,
        retailPrice, costPrice, taxable: p.taxable ?? true, ebtEligible: p.ebtEligible ?? false,
        ageRequired: p.ageRequired || null, size: p.size || null,
        visible: true, inStock: true,
        quantityOnHand: sp?.quantityOnHand != null ? Number(sp.quantityOnHand) : Math.floor(Math.random() * 80) + 10,
        lastSyncedAt: new Date(),
      },
      create: {
        orgId, storeId, posProductId: p.id,
        name: p.name, slug: pSlug, brand: p.brand || null, imageUrl: p.imageUrl || null,
        description: p.ecomDescription || p.description || null,
        tags: p.ecomTags || [], departmentName: p.department?.name || null,
        departmentSlug: p.department?.name ? slugify(p.department.name) : null,
        retailPrice, costPrice, taxable: p.taxable ?? true, ebtEligible: p.ebtEligible ?? false,
        ageRequired: p.ageRequired || null, size: p.size || null,
        visible: true, inStock: true,
        quantityOnHand: Math.floor(Math.random() * 80) + 10,
        lastSyncedAt: new Date(),
      },
    });
    prodCount++;
  }
  console.log(`  ✓ ${prodCount} products synced`);

  // ── 5. Create CMS pages ────────────────────────────────────────────
  const pages = [
    {
      slug: 'home', title: 'Home', pageType: 'home', templateId: 'centered-hero', published: true,
      content: { sections: {
        hero: { heading: `Welcome to ${storeName}`, subheading: 'Fresh groceries, snacks, and everyday essentials — delivered to your door or ready for pickup.', ctaText: 'Shop Now', image: '' },
        departments: { heading: 'Shop by Category' },
        products: { heading: 'Featured Products' },
      }},
    },
    {
      slug: 'about', title: 'About', pageType: 'about', templateId: 'story-mission', published: true,
      content: { sections: {
        story: { heading: 'Our Story', text: `${storeName} started as a small family-owned store with a big dream: to bring quality products and genuine care to our neighborhood. Over the years, we have grown into a trusted community hub where families find everything they need.` },
        mission: { heading: 'Our Mission', text: 'To provide our community with high-quality products at fair prices, delivered with genuine care and exceptional service.' },
      }},
    },
    {
      slug: 'contact', title: 'Contact', pageType: 'contact', templateId: 'contact-split', published: true,
      content: { sections: {
        info: { phone: '(555) 123-4567', email: `hello@${slug}.com`, address: '123 Main Street, Anytown, USA' },
        hours: { hours: 'Mon-Sat 7AM-10PM, Sun 8AM-9PM' },
      }},
    },
  ];

  for (const pg of pages) {
    await ecom.ecomPage.upsert({
      where: { storeId_slug: { storeId, slug: pg.slug } },
      update: { title: pg.title, templateId: pg.templateId, content: pg.content, published: pg.published },
      create: { orgId, storeId, ...pg },
    });
  }
  console.log(`  ✓ ${pages.length} CMS pages created (Home, About, Contact)`);

  // ── 6. Create test customer ────────────────────────────────────────
  const testEmail = 'test@example.com';
  const existing = await ecom.ecomCustomer.findUnique({ where: { storeId_email: { storeId, email: testEmail } } });
  if (!existing) {
    await ecom.ecomCustomer.create({
      data: {
        orgId, storeId, email: testEmail,
        firstName: 'Test', lastName: 'User', name: 'Test User',
        phone: '(555) 000-1234',
        passwordHash: await bcrypt.hash('test123', 10),
      },
    });
    console.log(`  ✓ Test customer: test@example.com / test123`);
  } else {
    console.log(`  ✓ Test customer already exists: test@example.com`);
  }

  // ── Done ───────────────────────────────────────────────────────────
  console.log(`\n✅ E-commerce seed complete!`);
  console.log(`\n  Storefront:  http://localhost:3000?store=${slug}`);
  console.log(`  Store API:   http://localhost:5005/api/store/${slug}`);
  console.log(`  Products:    http://localhost:5005/api/store/${slug}/products`);
  console.log(`  Test login:  test@example.com / test123\n`);
}

function getDemoProducts() {
  return [
    { id: 101, name: 'Coca-Cola 2L', brand: 'Coca-Cola', defaultRetailPrice: 2.49, department: { name: 'Beverages' }, taxable: true, ebtEligible: true, ecomTags: ['soda', 'drink'] },
    { id: 102, name: 'Pepsi 12-Pack Cans', brand: 'Pepsi', defaultRetailPrice: 6.99, department: { name: 'Beverages' }, taxable: true, ebtEligible: true, ecomTags: ['soda'] },
    { id: 103, name: 'Poland Spring Water 24-Pack', brand: 'Poland Spring', defaultRetailPrice: 4.99, department: { name: 'Beverages' }, taxable: true, ebtEligible: true, ecomTags: ['water'] },
    { id: 104, name: 'Red Bull Energy Drink', brand: 'Red Bull', defaultRetailPrice: 3.49, department: { name: 'Beverages' }, taxable: true, ebtEligible: false, ecomTags: ['energy'] },
    { id: 201, name: 'Doritos Nacho Cheese Party Size', brand: 'Doritos', defaultRetailPrice: 5.49, department: { name: 'Snacks' }, taxable: true, ebtEligible: true, ecomTags: ['chips'] },
    { id: 202, name: "Lay's Classic Potato Chips", brand: "Lay's", defaultRetailPrice: 3.99, department: { name: 'Snacks' }, taxable: true, ebtEligible: true, ecomTags: ['chips'] },
    { id: 203, name: 'Snickers Bar King Size', brand: 'Snickers', defaultRetailPrice: 2.29, department: { name: 'Snacks' }, taxable: true, ebtEligible: true, ecomTags: ['candy'] },
    { id: 204, name: 'Nature Valley Granola Bars 12ct', brand: 'Nature Valley', defaultRetailPrice: 4.49, department: { name: 'Snacks' }, taxable: true, ebtEligible: true, ecomTags: ['granola'] },
    { id: 301, name: 'Whole Milk 1 Gallon', brand: 'Store Brand', defaultRetailPrice: 3.79, department: { name: 'Dairy & Frozen' }, taxable: false, ebtEligible: true, ecomTags: ['milk'] },
    { id: 302, name: 'Large Eggs 12ct', brand: 'Store Brand', defaultRetailPrice: 2.99, department: { name: 'Dairy & Frozen' }, taxable: false, ebtEligible: true, ecomTags: ['eggs'] },
    { id: 401, name: 'Wonder Bread White', brand: 'Wonder', defaultRetailPrice: 3.49, department: { name: 'Grocery' }, taxable: false, ebtEligible: true, ecomTags: ['bread'] },
    { id: 402, name: 'Barilla Spaghetti 16oz', brand: 'Barilla', defaultRetailPrice: 1.79, department: { name: 'Grocery' }, taxable: false, ebtEligible: true, ecomTags: ['pasta'] },
    { id: 501, name: 'Advil Ibuprofen 24ct', brand: 'Advil', defaultRetailPrice: 7.99, department: { name: 'Health & Beauty' }, taxable: true, ebtEligible: false, ecomTags: ['medicine'] },
    { id: 601, name: 'Bounty Paper Towels 6-Roll', brand: 'Bounty', defaultRetailPrice: 12.99, department: { name: 'Household' }, taxable: true, ebtEligible: false, ecomTags: ['cleaning'] },
  ];
}

main()
  .catch((e) => { console.error('\n❌ Seed failed:', e.message); process.exit(1); })
  .finally(async () => { await ecom.$disconnect(); });
