// @ts-nocheck — Phase 4 (April 2026): renamed from .js to .ts as part of the
//   tsconfig coverage expansion. Strict typing of seed scripts deferred to
//   Phase 5 (alongside the strict-Prisma-typing rollout). Remove this
//   directive when this file gets audited; expect ~3-15 implicit-any errors
//   on helper function params + map index access — all mechanical to fix.

/**
 * seedToday.js — Generate ~40-60 transactions for TODAY so the Live
 * Dashboard ("Today" KPIs) shows non-zero values immediately after seeding.
 *
 * Uses the existing Cashier user + random products. Idempotent per-day:
 * running twice just adds more transactions for today (no duplicate-key
 * problems because txNumber is auto-generated).
 *
 * Run: node prisma/seedToday.js [orgId] [storeId]
 * If orgId/storeId omitted, seeds into EVERY store in the DB.
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const prisma = new PrismaClient();

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const randF = (lo, hi) => Math.random() * (hi - lo) + lo;

async function seedForStore(orgId, storeId) {
  const products = await prisma.masterProduct.findMany({
    where: { orgId, active: true, deleted: false, defaultRetailPrice: { gt: 0 } },
    take: 200,
    select: { id: true, name: true, upc: true, defaultRetailPrice: true, defaultCostPrice: true, taxClass: true, departmentId: true, ebtEligible: true },
  });
  if (products.length === 0) {
    console.log(`    ⚠ No products for org=${orgId} — skipping`);
    return 0;
  }

  const cashier = await prisma.user.findFirst({ where: { orgId, role: 'cashier' } })
               || await prisma.user.findFirst({ where: { orgId } });
  if (!cashier) {
    console.log(`    ⚠ No users for org=${orgId} — skipping`);
    return 0;
  }

  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(6, 0, 0, 0);
  const count = rand(40, 60);
  const stamp = Date.now().toString(36);

  const data = [];
  for (let i = 0; i < count; i++) {
    // Spread across 6am → now
    const when = new Date(startOfDay.getTime() + Math.random() * (now - startOfDay));
    const n = rand(1, 5);
    const lineItems = [];
    let subtotal = 0, taxTotal = 0;
    for (let k = 0; k < n; k++) {
      const p = pick(products);
      const qty = rand(1, 3);
      const unit = Number(p.defaultRetailPrice);
      const line = qty * unit;
      const taxable = p.taxClass !== 'grocery';
      const tax = taxable ? line * 0.055 : 0;
      subtotal += line;
      taxTotal += tax;
      lineItems.push({
        productId: p.id, name: p.name, upc: p.upc, qty, unitPrice: unit,
        lineTotal: line, taxable, taxAmount: tax,
        costPrice: p.defaultCostPrice ? Number(p.defaultCostPrice) : null,
        departmentId: p.departmentId, ebtEligible: p.ebtEligible,
      });
    }
    const grand = subtotal + taxTotal;
    const tenderMethod = pick(['cash', 'cash', 'card', 'card', 'card']);
    const tendered = tenderMethod === 'cash' ? Math.ceil(grand + rand(0, 5)) : grand;
    data.push({
      orgId, storeId,
      txNumber: `TXN-TODAY-${stamp}-${String(i).padStart(4, '0')}`,
      cashierId: cashier.id,
      lineItems,
      subtotal,
      taxTotal,
      depositTotal: 0,
      ebtTotal: 0,
      grandTotal: grand,
      tenderLines: [{ method: tenderMethod, amount: tendered }],
      changeGiven: Math.max(0, tendered - grand),
      status: 'complete',
      createdAt: when,
      updatedAt: when,
    });
  }
  await prisma.transaction.createMany({ data });
  return count;
}

export async function seedToday(orgId, storeId) {
  console.log(`\n  📆 Seeding today's transactions...`);

  let targets = [];
  if (orgId && storeId) {
    targets = [{ orgId, storeId }];
  } else {
    const stores = await prisma.store.findMany({
      where: { isActive: true, organization: { slug: { not: 'system' } } },
      select: { id: true, orgId: true, name: true },
    });
    targets = stores.map(s => ({ orgId: s.orgId, storeId: s.id, name: s.name }));
  }

  let total = 0;
  for (const t of targets) {
    const n = await seedForStore(t.orgId, t.storeId);
    total += n;
    console.log(`  ✓ ${n} today-transactions for store=${t.storeId}${t.name ? ` (${t.name})` : ''}`);
  }
  console.log(`  ✓ ${total} today-transactions total`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [orgId, storeId] = process.argv.slice(2);
  seedToday(orgId, storeId)
    .catch((e) => { console.error('✗ seedToday failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
