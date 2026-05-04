/**
 * S73 Smoke — Expiry tracking + Dead-stock + Inventory-report audit.
 *
 * Three groups of assertions:
 *   1. Expiry CRUD: set, list with status buckets, summary, clear
 *   2. Dead-stock: products with inventory but no sales in N days
 *   3. Audit: existing /reports/hub/inventory still returns the expected
 *      shape with the dead/low/over/out classifier intact (no regression)
 *
 * Self-cleaning. Uses the dev Future Foods org.
 */

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const p = new PrismaClient();
const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_to_a_long_random_secret';
const TAG = 'S73-' + Date.now();

const tests = [];
function test(name, ok, detail) {
  tests.push({ name, ok, detail });
  if (ok) console.log(`  ✓ ${name}`);
  else    console.error(`  ✗ ${name}: ${detail}`);
}

console.log('\n=== S73 — Expiry + Dead-Stock + Inventory Report Audit ===\n');

// ── Setup ─────────────────────────────────────────────────────
const org = await p.organization.findFirst({
  where: { name: { contains: 'Future Foods' } },
  select: { id: true },
});
const user = await p.user.findFirst({
  where: { orgId: org.id, role: { in: ['owner', 'admin'] }, status: 'active' },
  select: { id: true, email: true },
});
const store = await p.store.findFirst({ where: { orgId: org.id }, select: { id: true } });
const TOKEN = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1h' });
console.log(`User: ${user.email} · org: ${org.id} · store: ${store.id}\n`);

async function api(method, path, body) {
  const res = await fetch(`${BACKEND}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'X-Store-Id': store.id,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

const cleanup = { products: [] };

try {
  // ── Fixture: 3 test products ─────────────────────────────────
  console.log('--- Fixture ---');
  const PRODUCTS = [
    { name: `${TAG} Milk (expired)`,   upc: '777' + (Date.now() + 1).toString().slice(-9), expDays: -2,  qoh: 5 },
    { name: `${TAG} Yogurt (today)`,   upc: '777' + (Date.now() + 2).toString().slice(-9), expDays: 0,   qoh: 8 },
    { name: `${TAG} Cheese (5d)`,      upc: '777' + (Date.now() + 3).toString().slice(-9), expDays: 5,   qoh: 12 },
  ];

  for (const def of PRODUCTS) {
    const r = await api('POST', '/catalog/products', {
      name: def.name,
      upc: def.upc,
      defaultRetailPrice: 4.99,
      defaultCostPrice: 2.5,
      unitPack: 1,
      packInCase: 1,
      taxable: true,
      taxClass: 'grocery',
      active: true,
      trackInventory: true,
    });
    const id = r.body?.data?.id;
    cleanup.products.push(id);

    // Set inventory (StoreProduct row needed)
    await p.storeProduct.upsert({
      where: { storeId_masterProductId: { storeId: store.id, masterProductId: id } },
      create: { orgId: org.id, storeId: store.id, masterProductId: id, quantityOnHand: def.qoh, active: true, inStock: true },
      update: { quantityOnHand: def.qoh },
    });
  }
  test('Created 3 fixture products with inventory', cleanup.products.length === 3 && cleanup.products.every(Boolean),
    JSON.stringify(cleanup.products));

  // ── 1. Expiry CRUD ──────────────────────────────────────────
  console.log('\n--- 1. Expiry CRUD ---');

  // Set expiry for each
  for (let i = 0; i < PRODUCTS.length; i++) {
    const def = PRODUCTS[i];
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + def.expDays);
    expiryDate.setHours(12, 0, 0, 0); // noon to avoid TZ drift
    const r = await api('PUT', `/catalog/expiry/${cleanup.products[i]}`, {
      expiryDate: expiryDate.toISOString(),
      expiryNotes: `Smoke test - ${def.expDays}d`,
    });
    test(`PUT /expiry/${i} → 200 with expiryDate`,
      r.status === 200 && r.body?.success && r.body?.data?.expiryDate,
      JSON.stringify(r.body));
  }

  // List with default window=14
  const listRes = await api('GET', '/catalog/expiry');
  const items = listRes.body?.data || [];
  const ours = items.filter(it => cleanup.products.includes(it.productId));
  test('GET /expiry returns all 3 fixture products',
    ours.length === 3, JSON.stringify({ found: ours.length, total: items.length }));

  const expired = ours.find(it => it.status === 'expired');
  const today = ours.find(it => it.status === 'today');
  const approaching = ours.find(it => it.status === 'approaching');
  test('Status buckets — expired classified correctly',
    !!expired && expired.daysUntilExpiry < 0, JSON.stringify(expired));
  test('Status buckets — today classified correctly',
    !!today && Math.abs(today.daysUntilExpiry) <= 1, JSON.stringify(today));
  test('Status buckets — 5-day product classified as approaching',
    !!approaching && approaching.daysUntilExpiry === 5, JSON.stringify(approaching));

  // Filter by status
  const filteredRes = await api('GET', '/catalog/expiry?status=expired');
  const filteredItems = (filteredRes.body?.data || []).filter(it => cleanup.products.includes(it.productId));
  test('GET /expiry?status=expired filters correctly',
    filteredItems.length === 1 && filteredItems[0].status === 'expired',
    JSON.stringify({ count: filteredItems.length }));

  // Summary
  const summaryRes = await api('GET', '/catalog/expiry/summary');
  test('GET /expiry/summary returns bucket counts',
    summaryRes.status === 200 && summaryRes.body?.data?.expired?.count >= 1,
    JSON.stringify(summaryRes.body?.data));
  test('Summary includes valueAtRisk for expired bucket',
    typeof summaryRes.body?.data?.expired?.valueAtRisk === 'number',
    JSON.stringify(summaryRes.body?.data?.expired));

  // Clear one
  const clearRes = await api('DELETE', `/catalog/expiry/${cleanup.products[0]}`);
  test('DELETE /expiry → 200',
    clearRes.status === 200 && clearRes.body?.data?.cleared === true,
    JSON.stringify(clearRes.body));

  // Verify cleared
  const afterClear = await api('GET', `/catalog/expiry?includeUntracked=true&q=${encodeURIComponent(TAG)}`);
  const clearedItem = (afterClear.body?.data || []).find(it => it.productId === cleanup.products[0]);
  test('After clear: expiryDate is null',
    clearedItem && clearedItem.expiryDate == null,
    JSON.stringify(clearedItem));

  // Validation
  const badRes = await api('PUT', `/catalog/expiry/${cleanup.products[0]}`, {
    expiryDate: 'not-a-date',
  });
  test('Invalid expiryDate → 400',
    badRes.status === 400, JSON.stringify(badRes.body));

  const missing = await api('PUT', '/catalog/expiry/99999999', {
    expiryDate: new Date().toISOString(),
  });
  test('Missing productId → 404',
    missing.status === 404, JSON.stringify(missing.body));

  // ── 2. Dead-stock ──────────────────────────────────────────
  console.log('\n--- 2. Dead-stock query ---');
  // Our 3 products have inventory but zero sales — they should be in deadstock
  const ds = await api('GET', '/catalog/dead-stock?days=30');
  test('GET /dead-stock returns success',
    ds.status === 200 && ds.body?.success, JSON.stringify(ds.body?.error || 'ok'));
  const dsItems = (ds.body?.data || []).filter(it => cleanup.products.includes(it.id));
  test('Dead-stock includes our 3 fixture products (no sales, has stock)',
    dsItems.length === 3,
    JSON.stringify({ found: dsItems.length, totalDeadStock: ds.body?.data?.length }));
  test('Dead-stock items include valueAtRisk',
    dsItems.length > 0 && dsItems.every(it => typeof it.retailValueAtRisk === 'number'),
    JSON.stringify(dsItems[0]));
  test('Dead-stock meta includes totalRetailValueAtRisk + count',
    typeof ds.body?.meta?.totalRetailValueAtRisk === 'number'
      && typeof ds.body?.meta?.deadStockCount === 'number',
    JSON.stringify(ds.body?.meta));

  // Days param works — our products have NO sales in 365 days, so days=365 should still find them
  const ds365 = await api('GET', '/catalog/dead-stock?days=365');
  const ds365Ours = (ds365.body?.data || []).filter(it => cleanup.products.includes(it.id));
  test('Days param accepted — days=365 still finds zero-sale fixture products',
    ds365Ours.length === 3, JSON.stringify({ found: ds365Ours.length }));

  // ── 3. Existing inventory report audit ────────────────────
  console.log('\n--- 3. Inventory report audit (no regression) ---');
  const invRes = await api('GET', '/reports/hub/inventory');
  test('GET /reports/hub/inventory → 200 with inventory + stats',
    invRes.status === 200 && Array.isArray(invRes.body?.inventory) && typeof invRes.body?.stats?.deadStock === 'number',
    JSON.stringify({ status: invRes.status, sampleStats: invRes.body?.stats }));
  test('/reports/hub/inventory stats include all 4 buckets',
    typeof invRes.body?.stats?.outOfStock === 'number'
      && typeof invRes.body?.stats?.lowStock === 'number'
      && typeof invRes.body?.stats?.deadStock === 'number'
      && typeof invRes.body?.stats?.overStock === 'number',
    JSON.stringify(invRes.body?.stats));
  // Filter type=dead works
  const deadFiltered = await api('GET', '/reports/hub/inventory?type=dead');
  test('/reports/hub/inventory?type=dead returns only dead-stock items',
    deadFiltered.status === 200
      && Array.isArray(deadFiltered.body?.inventory)
      && deadFiltered.body.inventory.every(p => p.stockStatus === 'dead'),
    JSON.stringify({
      count: deadFiltered.body?.inventory?.length,
      sample: deadFiltered.body?.inventory?.[0]?.stockStatus,
    }));

} finally {
  // ── Cleanup ─────────────────────────────────────────────────
  console.log('\n--- Cleanup ---');
  try {
    for (const id of cleanup.products) {
      if (id) {
        await p.labelQueue.deleteMany({ where: { masterProductId: id } });
        await p.productUpc.deleteMany({ where: { masterProductId: id } });
        await p.storeProduct.deleteMany({ where: { masterProductId: id } });
        await p.masterProduct.delete({ where: { id } });
      }
    }
    console.log(`  • Deleted ${cleanup.products.length} product(s)`);
  } catch (err) {
    console.error('  • Cleanup error (ignored):', err.message);
  }
  await p.$disconnect();
}

const passed = tests.filter(t => t.ok).length;
const total = tests.length;
console.log(`\n=== S73 Result: ${passed}/${total} tests passed ===\n`);
process.exit(passed === total ? 0 : 1);
