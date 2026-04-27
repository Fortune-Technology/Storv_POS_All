// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * seedCatalogExtras.js — Seeds the Catalog extras:
 *   • Product Groups (4 template classification groups)
 *   • Promotions (6 across all promoTypes)
 *   • StoreProduct inventory snapshots (50 random products with stock)
 *   • LabelQueue (15 pending print jobs)
 *
 * Idempotent per scope.
 *
 * Usage: node prisma/seedCatalogExtras.js [orgId] [storeId]
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const prisma = new PrismaClient();

const ORG_ID   = process.argv[2] || 'default';
const STORE_ID = process.argv[3] || 'default-store';

const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export async function seedCatalogExtras(orgId = ORG_ID, storeId = STORE_ID) {
  console.log(`\n  📦 Seeding catalog extras for org=${orgId} store=${storeId}...`);

  /* ── Product Groups ───────────────────────────────────────── */
  const pgExisting = await prisma.productGroup.count({ where: { orgId } });
  if (pgExisting >= 4) {
    console.log(`  ✓ Product groups already exist (${pgExisting}) — backfilling missing descriptions`);
    // Backfill descriptions on existing groups if missing
    const existingGroups = await prisma.productGroup.findMany({ where: { orgId, description: null } });
    for (const g of existingGroups) {
      const spec = ({
        '12oz Can Beer':    'Standard 12oz aluminum cans of domestic beer sold in 12-packs — $14.99 retail with 21+ age gate.',
        '750ml Red Wine':   '750 ml glass-bottle red wines priced at $12.99. Shelf template covers Cabernet, Merlot, and Pinot Noir.',
        '20oz Soda Bottle': 'Single-serve 20oz PET soda bottles sold at the register cooler. EBT-eligible, $2.49 retail.',
        'Cigarette Pack':   '20-count cigarette hard-packs behind the counter. 21+ age required at every scan. $11.99 retail.',
      })[g.name];
      if (spec) await prisma.productGroup.update({ where: { id: g.id }, data: { description: spec } });
    }
  } else {
    const depts = await prisma.department.findMany({ where: { orgId } });
    const byCode = Object.fromEntries(depts.map(d => [d.code, d.id]));
    const groups = [
      { name: '12oz Can Beer',     description: 'Standard 12oz aluminum cans of domestic beer sold in 12-packs — $14.99 retail with 21+ age gate.', color: '#f59e0b', taxable: true, taxClass: 'alcohol', ageRequired: 21, ebtEligible: false, size: '12oz', sizeUnit: 'oz', pack: 12, casePacks: 2, sellUnitSize: 12, defaultRetailPrice: 14.99, defaultCostPrice: 10.49, department: 'BEER' },
      { name: '750ml Red Wine',    description: '750 ml glass-bottle red wines priced at $12.99. Shelf template covers Cabernet, Merlot, and Pinot Noir.', color: '#8b5cf6', taxable: true, taxClass: 'alcohol', ageRequired: 21, ebtEligible: false, size: '750', sizeUnit: 'ml', pack: 1, casePacks: 12, sellUnitSize: 1, defaultRetailPrice: 12.99, defaultCostPrice: 8.49,  department: 'WINE' },
      { name: '20oz Soda Bottle',  description: 'Single-serve 20oz PET soda bottles sold at the register cooler. EBT-eligible, $2.49 retail.', color: '#34d399', taxable: true, taxClass: 'grocery', ageRequired: null, ebtEligible: true,  size: '20',  sizeUnit: 'oz', pack: 1, casePacks: 24, sellUnitSize: 1, defaultRetailPrice: 2.49,  defaultCostPrice: 1.10,  department: 'BVNALC' },
      { name: 'Cigarette Pack',    description: '20-count cigarette hard-packs behind the counter. 21+ age required at every scan. $11.99 retail.', color: '#6b7280', taxable: true, taxClass: 'tobacco', ageRequired: 21, ebtEligible: false, size: '20',  sizeUnit: 'ct', pack: 1, casePacks: 10, sellUnitSize: 1, defaultRetailPrice: 11.99, defaultCostPrice: 8.99,  department: 'TOBAC' },
    ];
    let created = 0;
    for (const g of groups) {
      const exists = await prisma.productGroup.findFirst({ where: { orgId, name: g.name } });
      if (exists) continue;
      const { department, ...data } = g;
      await prisma.productGroup.create({
        data: {
          orgId,
          ...data,
          departmentId: byCode[department] ?? null,
          autoSync: true,
          active: true,
        },
      });
      created++;
    }
    console.log(`  ✓ ${created} product groups seeded`);
  }

  /* ── Promotions ───────────────────────────────────────────── */
  const promoExisting = await prisma.promotion.count({ where: { orgId } });
  if (promoExisting >= 5) {
    console.log(`  ✓ Promotions already exist (${promoExisting}) — skipping`);
  } else {
    const depts = await prisma.department.findMany({ where: { orgId } });
    const byCode = Object.fromEntries(depts.map(d => [d.code, d.id]));
    const samples = await prisma.masterProduct.findMany({ where: { orgId, active: true }, take: 50, select: { id: true, departmentId: true } });
    const beerIds  = samples.filter(p => p.departmentId === byCode.BEER).map(p => p.id);
    const snackIds = samples.filter(p => p.departmentId === byCode.SNACKS).map(p => p.id);
    const now  = new Date();
    const soon = new Date(Date.now() + 30 * 86400000);

    const promos = [
      { name: 'Summer Beer Sale',     promoType: 'sale',      description: '10% off all 12-pack beer', productIds: beerIds.slice(0, 5),  departmentIds: [],               dealConfig: { discountType: 'pct', discountValue: 10 },                    badgeLabel: '10% OFF',  badgeColor: '#f59e0b' },
      { name: 'Snack BOGO',           promoType: 'bogo',      description: 'Buy one, get one 50% off', productIds: snackIds.slice(0, 8), departmentIds: [],               dealConfig: { buyQty: 1, getQty: 1, getDiscountPct: 50 },                 badgeLabel: 'BOGO 50%', badgeColor: '#3b82f6' },
      { name: 'Volume Soda Deal',     promoType: 'volume',    description: '3 for $5 on 20oz sodas',    productIds: [],                    departmentIds: [byCode.BVNALC], dealConfig: { thresholds: [{ qty: 3, price: 5.00 }] },                    badgeLabel: '3 FOR $5', badgeColor: '#34d399' },
      { name: 'Candy + Soda Combo',   promoType: 'combo',     description: 'Candy + Soda for $3',       productIds: snackIds.slice(0, 3), departmentIds: [],               dealConfig: { comboItems: [{ deptCode: 'SNACKS' }, { deptCode: 'BVNALC' }], price: 3 }, badgeLabel: '$3 COMBO', badgeColor: '#ec4899' },
      { name: 'Mix & Match Chips',    promoType: 'mix_match', description: '2 bags of chips for $6',    productIds: snackIds.slice(0, 10),departmentIds: [],               dealConfig: { qty: 2, price: 6.00 },                                       badgeLabel: '2 FOR $6', badgeColor: '#a855f7' },
      { name: 'Weekend Wine Sale',    promoType: 'sale',      description: '15% off selected wines',    productIds: [],                    departmentIds: [byCode.WINE],  dealConfig: { discountType: 'pct', discountValue: 15 },                    badgeLabel: '15% OFF',  badgeColor: '#8b5cf6' },
    ].filter(p => p.productIds.length > 0 || p.departmentIds.length > 0);

    let created = 0;
    for (const p of promos) {
      const exists = await prisma.promotion.findFirst({ where: { orgId, name: p.name } });
      if (exists) continue;
      await prisma.promotion.create({
        data: { orgId, ...p, startDate: now, endDate: soon, active: true },
      });
      created++;
    }
    console.log(`  ✓ ${created} promotions seeded`);
  }

  /* ── StoreProduct inventory snapshots ─────────────────────── */
  const spExisting = await prisma.storeProduct.count({ where: { orgId, storeId } });
  if (spExisting >= 40) {
    console.log(`  ✓ Store product inventory already exists (${spExisting}) — skipping`);
  } else {
    const products = await prisma.masterProduct.findMany({
      where: { orgId, active: true, deleted: false },
      take: 80,
    });
    let created = 0;
    for (const p of products) {
      const exists = await prisma.storeProduct.findUnique({
        where: { storeId_masterProductId: { storeId, masterProductId: p.id } },
      });
      if (exists) continue;
      const qty = rand(0, 120);
      await prisma.storeProduct.create({
        data: {
          orgId, storeId, masterProductId: p.id,
          retailPrice: p.defaultRetailPrice,
          costPrice:   p.defaultCostPrice,
          quantityOnHand: qty,
          quantityOnOrder: qty < 10 ? rand(20, 60) : 0,
          inStock: qty > 0,
          active: true,
          lastStockUpdate: new Date(),
        },
      });
      created++;
    }
    console.log(`  ✓ ${created} store product inventory rows seeded`);
  }

  /* ── Label Queue ──────────────────────────────────────────── */
  const lqExisting = await prisma.labelQueue.count({ where: { orgId, storeId, status: 'pending' } });
  if (lqExisting >= 10) {
    console.log(`  ✓ Label queue entries already exist (${lqExisting} pending) — skipping`);
  } else {
    const products = await prisma.masterProduct.findMany({
      where: { orgId, active: true, defaultRetailPrice: { gt: 0 } },
      take: 20,
    });
    const reasons = ['price_change', 'new_product', 'sale_started', 'manual'];
    let created = 0;
    for (const p of products.slice(0, 15)) {
      const oldPrice = Number(p.defaultRetailPrice);
      const newPrice = Math.round(oldPrice * (0.85 + Math.random() * 0.3) * 100) / 100;
      try {
        await prisma.labelQueue.create({
          data: {
            orgId, storeId, masterProductId: p.id,
            reason: pick(reasons),
            oldPrice, newPrice,
            status: 'pending',
          },
        });
        created++;
      } catch { /* unique conflict — skip */ }
    }
    console.log(`  ✓ ${created} label queue entries seeded`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedCatalogExtras()
    .catch((e) => { console.error('✗ seedCatalogExtras failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
