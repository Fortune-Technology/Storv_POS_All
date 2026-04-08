/**
 * E-commerce database seed script.
 *
 * Creates a demo store with sample departments and products
 * so the storefront can be tested immediately.
 *
 * Usage: cd ecom-backend && node prisma/seed.js
 *
 * Prerequisites:
 *   - ecom database exists and schema is pushed (npx prisma db push)
 *   - POS database has at least one org + store (run POS seed first)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding e-commerce database...\n');

  // ── 1. Check if POS has an org/store we can reference ──────────────
  // We'll use dummy IDs — in production these come from the POS database.
  // Replace with your actual orgId and storeId if you have POS data.
  const ORG_ID = process.env.SEED_ORG_ID || 'demo-org';
  const STORE_ID = process.env.SEED_STORE_ID || 'demo-store';

  console.log(`  Using orgId:   ${ORG_ID}`);
  console.log(`  Using storeId: ${STORE_ID}\n`);

  // ── 2. Create or update the EcomStore ──────────────────────────────
  const store = await prisma.ecomStore.upsert({
    where: { storeId: STORE_ID },
    update: { enabled: true },
    create: {
      orgId: ORG_ID,
      storeId: STORE_ID,
      storeName: 'Demo Convenience Store',
      slug: 'demo',
      enabled: true,
      branding: {
        logoText: 'Demo Store',
        primaryColor: '#16a34a',
        secondaryColor: '#0f172a',
        fontFamily: 'Inter, sans-serif',
      },
      seoDefaults: {
        metaTitle: 'Demo Convenience Store — Shop Online',
        metaDescription: 'Fresh groceries, snacks, beverages and more. Order online for pickup or delivery.',
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
  console.log(`  ✓ EcomStore created: "${store.storeName}" (slug: ${store.slug})`);

  // ── 3. Create departments ──────────────────────────────────────────
  const departments = [
    { name: 'Beverages', slug: 'beverages', posDepartmentId: 1 },
    { name: 'Snacks', slug: 'snacks', posDepartmentId: 2 },
    { name: 'Dairy & Frozen', slug: 'dairy-frozen', posDepartmentId: 3 },
    { name: 'Grocery', slug: 'grocery', posDepartmentId: 4 },
    { name: 'Health & Beauty', slug: 'health-beauty', posDepartmentId: 5 },
    { name: 'Household', slug: 'household', posDepartmentId: 6 },
  ];

  for (const dept of departments) {
    await prisma.ecomDepartment.upsert({
      where: { storeId_posDepartmentId: { storeId: STORE_ID, posDepartmentId: dept.posDepartmentId } },
      update: { name: dept.name, slug: dept.slug, visible: true },
      create: {
        orgId: ORG_ID,
        storeId: STORE_ID,
        posDepartmentId: dept.posDepartmentId,
        name: dept.name,
        slug: dept.slug,
        visible: true,
      },
    });
  }
  console.log(`  ✓ ${departments.length} departments created`);

  // ── 4. Create sample products ──────────────────────────────────────
  const products = [
    // Beverages
    { name: 'Coca-Cola 2L', slug: 'coca-cola-2l', brand: 'Coca-Cola', retailPrice: 2.49, departmentName: 'Beverages', departmentSlug: 'beverages', posProductId: 101, tags: ['soda', 'drink'] },
    { name: 'Pepsi 12-Pack Cans', slug: 'pepsi-12-pack', brand: 'Pepsi', retailPrice: 6.99, departmentName: 'Beverages', departmentSlug: 'beverages', posProductId: 102, tags: ['soda', 'drink', 'value-pack'] },
    { name: 'Poland Spring Water 24-Pack', slug: 'poland-spring-24', brand: 'Poland Spring', retailPrice: 4.99, departmentName: 'Beverages', departmentSlug: 'beverages', posProductId: 103, tags: ['water', 'hydration'] },
    { name: 'Red Bull Energy Drink', slug: 'red-bull-energy', brand: 'Red Bull', retailPrice: 3.49, departmentName: 'Beverages', departmentSlug: 'beverages', posProductId: 104, tags: ['energy', 'drink'] },
    { name: 'Tropicana Orange Juice 52oz', slug: 'tropicana-oj-52', brand: 'Tropicana', retailPrice: 4.29, departmentName: 'Beverages', departmentSlug: 'beverages', posProductId: 105, tags: ['juice', 'breakfast'] },

    // Snacks
    { name: 'Doritos Nacho Cheese Party Size', slug: 'doritos-nacho-party', brand: 'Doritos', retailPrice: 5.49, departmentName: 'Snacks', departmentSlug: 'snacks', posProductId: 201, tags: ['chips', 'party'] },
    { name: 'Lay\'s Classic Potato Chips', slug: 'lays-classic', brand: 'Lay\'s', retailPrice: 3.99, departmentName: 'Snacks', departmentSlug: 'snacks', posProductId: 202, tags: ['chips'] },
    { name: 'Snickers Bar King Size', slug: 'snickers-king', brand: 'Snickers', retailPrice: 2.29, departmentName: 'Snacks', departmentSlug: 'snacks', posProductId: 203, tags: ['candy', 'chocolate'] },
    { name: 'Nature Valley Granola Bars 12ct', slug: 'nature-valley-12', brand: 'Nature Valley', retailPrice: 4.49, departmentName: 'Snacks', departmentSlug: 'snacks', posProductId: 204, tags: ['granola', 'healthy'] },
    { name: 'Oreo Cookies Family Size', slug: 'oreo-family', brand: 'Oreo', retailPrice: 5.99, departmentName: 'Snacks', departmentSlug: 'snacks', posProductId: 205, tags: ['cookies', 'family'] },

    // Dairy & Frozen
    { name: 'Whole Milk 1 Gallon', slug: 'whole-milk-gallon', brand: 'Store Brand', retailPrice: 3.79, departmentName: 'Dairy & Frozen', departmentSlug: 'dairy-frozen', posProductId: 301, tags: ['milk', 'dairy'] },
    { name: 'Large Eggs 12ct', slug: 'large-eggs-12', brand: 'Store Brand', retailPrice: 2.99, departmentName: 'Dairy & Frozen', departmentSlug: 'dairy-frozen', posProductId: 302, tags: ['eggs', 'breakfast'] },
    { name: 'Ben & Jerry\'s Half Baked Pint', slug: 'ben-jerrys-half-baked', brand: 'Ben & Jerry\'s', retailPrice: 5.99, departmentName: 'Dairy & Frozen', departmentSlug: 'dairy-frozen', posProductId: 303, tags: ['ice-cream', 'frozen'] },
    { name: 'Greek Yogurt Variety Pack', slug: 'greek-yogurt-variety', brand: 'Chobani', retailPrice: 6.49, departmentName: 'Dairy & Frozen', departmentSlug: 'dairy-frozen', posProductId: 304, tags: ['yogurt', 'healthy'] },

    // Grocery
    { name: 'Wonder Bread White', slug: 'wonder-bread-white', brand: 'Wonder', retailPrice: 3.49, departmentName: 'Grocery', departmentSlug: 'grocery', posProductId: 401, tags: ['bread', 'bakery'] },
    { name: 'Barilla Spaghetti 16oz', slug: 'barilla-spaghetti', brand: 'Barilla', retailPrice: 1.79, departmentName: 'Grocery', departmentSlug: 'grocery', posProductId: 402, tags: ['pasta', 'italian'] },
    { name: 'Prego Traditional Pasta Sauce', slug: 'prego-traditional', brand: 'Prego', retailPrice: 2.99, departmentName: 'Grocery', departmentSlug: 'grocery', posProductId: 403, tags: ['sauce', 'italian'] },
    { name: 'Campbell\'s Chicken Noodle Soup', slug: 'campbells-chicken-noodle', brand: 'Campbell\'s', retailPrice: 1.49, departmentName: 'Grocery', departmentSlug: 'grocery', posProductId: 404, tags: ['soup', 'canned'] },

    // Health & Beauty
    { name: 'Advil Ibuprofen 24ct', slug: 'advil-24', brand: 'Advil', retailPrice: 7.99, departmentName: 'Health & Beauty', departmentSlug: 'health-beauty', posProductId: 501, tags: ['medicine', 'pain-relief'] },
    { name: 'Colgate Toothpaste 6oz', slug: 'colgate-6oz', brand: 'Colgate', retailPrice: 3.49, departmentName: 'Health & Beauty', departmentSlug: 'health-beauty', posProductId: 502, tags: ['dental', 'hygiene'] },

    // Household
    { name: 'Bounty Paper Towels 6-Roll', slug: 'bounty-6roll', brand: 'Bounty', retailPrice: 12.99, departmentName: 'Household', departmentSlug: 'household', posProductId: 601, tags: ['cleaning', 'paper'] },
    { name: 'Glad Trash Bags 30ct', slug: 'glad-trash-30', brand: 'Glad', retailPrice: 8.49, departmentName: 'Household', departmentSlug: 'household', posProductId: 602, tags: ['cleaning', 'bags'] },
  ];

  for (const p of products) {
    await prisma.ecomProduct.upsert({
      where: { storeId_posProductId: { storeId: STORE_ID, posProductId: p.posProductId } },
      update: {
        name: p.name,
        slug: p.slug,
        brand: p.brand,
        retailPrice: p.retailPrice,
        departmentName: p.departmentName,
        departmentSlug: p.departmentSlug,
        tags: p.tags,
        visible: true,
        inStock: true,
        quantityOnHand: Math.floor(Math.random() * 100) + 10,
        lastSyncedAt: new Date(),
      },
      create: {
        orgId: ORG_ID,
        storeId: STORE_ID,
        posProductId: p.posProductId,
        name: p.name,
        slug: p.slug,
        brand: p.brand,
        retailPrice: p.retailPrice,
        departmentName: p.departmentName,
        departmentSlug: p.departmentSlug,
        tags: p.tags,
        visible: true,
        inStock: true,
        trackInventory: true,
        quantityOnHand: Math.floor(Math.random() * 100) + 10,
        lastSyncedAt: new Date(),
      },
    });
  }
  console.log(`  ✓ ${products.length} products created`);

  // ── 5. Create default CMS pages ────────────────────────────────────
  const pages = [
    {
      slug: 'about',
      title: 'About Us',
      pageType: 'about',
      published: true,
      content: {
        sections: [
          { type: 'text', heading: 'Our Story', body: 'We are a family-owned convenience store serving our community since 2010. We offer fresh products, competitive prices, and friendly service.' },
          { type: 'text', heading: 'Our Mission', body: 'To provide our neighborhood with quality groceries, snacks, and household essentials at affordable prices, with the convenience of online ordering.' },
        ],
      },
    },
    {
      slug: 'contact',
      title: 'Contact Us',
      pageType: 'contact',
      published: true,
      content: {
        sections: [
          { type: 'contact-info', phone: '(555) 123-4567', email: 'hello@demostore.com', address: '123 Main Street, Anytown, USA' },
          { type: 'hours', hours: 'Monday - Sunday: 8:00 AM - 10:00 PM' },
        ],
      },
    },
  ];

  for (const pg of pages) {
    await prisma.ecomPage.upsert({
      where: { storeId_slug: { storeId: STORE_ID, slug: pg.slug } },
      update: { title: pg.title, content: pg.content, published: pg.published },
      create: {
        orgId: ORG_ID,
        storeId: STORE_ID,
        slug: pg.slug,
        title: pg.title,
        pageType: pg.pageType,
        content: pg.content,
        published: pg.published,
      },
    });
  }
  console.log(`  ✓ ${pages.length} CMS pages created`);

  console.log('\n✅ E-commerce seed complete!');
  console.log(`\n  Visit: http://localhost:3000?store=demo`);
  console.log(`  API:   http://localhost:5005/api/store/demo`);
  console.log(`         http://localhost:5005/api/store/demo/products`);
  console.log(`         http://localhost:5005/api/store/demo/departments\n`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
