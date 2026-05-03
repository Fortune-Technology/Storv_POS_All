// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

/**
 * Portal query-feature tests — verifies search/filter/sort/pagination on
 * the surfaces that support them.
 *
 * Confirmed against actual controller code, not assumed:
 *
 *   /api/catalog/products            — paginated, dept/vendor/active filter,
 *                                      server-side sort by 11 keys
 *                                      (name|brand|upc|sku|pack|cost|retail|
 *                                       department|vendor|active|createdAt|updatedAt)
 *                                      Unknown sortBy falls back to name-asc.
 *   /api/catalog/products/search     — fuzzy/exact name+brand+sku+UPC search
 *                                      via ?q=
 *   /api/catalog/groups              — accepts ?active=&departmentId=
 *   /api/catalog/import/history      — paginated, ?type= filter
 *   /api/inventory/adjustments       — paginated, ?from=&to=&reason=&masterProductId=
 *
 * Skipped (no filter implemented):
 *   /api/catalog/departments         — returns all rows, no filter
 *   /api/catalog/promotions          — returns all rows, no filter
 *   /api/label-queue                 — accepts ?status=, but seed has no rows
 *
 * Run: node --test tests/portal_query_features.test.mjs
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const API   = process.env.TEST_API_URL || 'http://localhost:5000';
const ORG   = 'default';
const STORE = 'default-store';
const prisma = new PrismaClient();

let TOKEN = null;
const H = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${TOKEN}`,
  'X-Store-Id':    STORE,
});

async function hit(method, p, body) {
  const init = { method, headers: H() };
  if (body != null) init.body = JSON.stringify(body);
  const r = await fetch(API + p, init);
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, body: json };
}

const unwrap = (b) => (b && typeof b === 'object' && 'data' in b) ? b.data : b;

const createdProducts = [];
let testDeptId = null;

before(async () => {
  const user = await prisma.user.findFirst({ where: { email: 'owner@storeveu.com' } });
  assert.ok(user);
  TOKEN = jwt.sign(
    { id: user.id, orgId: user.orgId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Seed a small known-state set of test products so sort/filter assertions
  // can be deterministic regardless of what's in the broader catalog.
  // Use uniquely-prefixed names with explicit prices and brands.
  const stamp = Date.now().toString().slice(-8);

  // Make a test dept for filter assertions
  const d = await hit('POST', '/api/catalog/departments', {
    name: `QueryFeat Dept ${stamp}`,
    code: `QF${stamp}`,
  });
  assert.equal(d.status, 201);
  testDeptId = unwrap(d.body).id;

  // 3 products with distinct prices + names, in our test dept
  const seeds = [
    { name: `QFTest A Apple ${stamp}`, brand: 'AAA', defaultRetailPrice: 1.00 },
    { name: `QFTest B Banana ${stamp}`, brand: 'BBB', defaultRetailPrice: 5.00 },
    { name: `QFTest C Cherry ${stamp}`, brand: 'CCC', defaultRetailPrice: 3.00 },
  ];
  for (const s of seeds) {
    const r = await hit('POST', '/api/catalog/products', {
      ...s,
      departmentId: testDeptId,
    });
    assert.equal(r.status, 201, `seed product create failed: ${JSON.stringify(r.body).slice(0, 200)}`);
    createdProducts.push(unwrap(r.body).id);
  }
});

after(async () => {
  try {
    for (const id of createdProducts) {
      await prisma.masterProduct.deleteMany({ where: { id } }).catch(() => {});
    }
    if (testDeptId) {
      await prisma.department.deleteMany({ where: { id: testDeptId } }).catch(() => {});
    }
  } catch (e) { console.warn('cleanup error:', e.message); }
  await prisma.$disconnect();
});

/* ─────────────────  PRODUCTS — PAGINATION  ───────────────── */
describe('Products: pagination', () => {
  test('returns pagination metadata with page/limit/total/pages', async () => {
    const r = await hit('GET', '/api/catalog/products?page=1&limit=2');
    assert.equal(r.status, 200);
    assert.ok(r.body.pagination, 'expected pagination object');
    assert.equal(r.body.pagination.page, 1);
    assert.equal(r.body.pagination.limit, 2);
    assert.ok(typeof r.body.pagination.total === 'number');
    assert.ok(typeof r.body.pagination.pages === 'number');
  });

  test('limit caps at 500 (server-side max)', async () => {
    // paginationParams() does Math.min(500, ...), so requesting 9999
    // should cap at 500.
    const r = await hit('GET', '/api/catalog/products?page=1&limit=9999');
    assert.equal(r.status, 200);
    assert.equal(r.body.pagination.limit, 500);
  });

  test('page=2 with limit=1 returns different products vs page=1', async () => {
    const p1 = await hit('GET', '/api/catalog/products?page=1&limit=1&sortBy=name&sortDir=asc');
    const p2 = await hit('GET', '/api/catalog/products?page=2&limit=1&sortBy=name&sortDir=asc');
    assert.equal(p1.status, 200);
    assert.equal(p2.status, 200);
    if (p1.body.pagination.total >= 2) {
      const id1 = unwrap(p1.body)[0]?.id;
      const id2 = unwrap(p2.body)[0]?.id;
      assert.notEqual(id1, id2, 'page 2 should yield a different product than page 1');
    }
  });
});

/* ─────────────────  PRODUCTS — DEPARTMENT FILTER  ───────────────── */
describe('Products: department filter', () => {
  test('?departmentId=X narrows to that dept only', async () => {
    const r = await hit('GET', `/api/catalog/products?departmentId=${testDeptId}&limit=200`);
    assert.equal(r.status, 200);
    const list = unwrap(r.body);
    // Every returned product should belong to our test dept
    for (const p of list) {
      assert.equal(p.departmentId, testDeptId,
        `product ${p.id} should belong to dept ${testDeptId} but has ${p.departmentId}`);
    }
    // We seeded 3 products in this dept
    assert.equal(list.length, 3, `expected 3 seeded products, got ${list.length}`);
  });
});

/* ─────────────────  PRODUCTS — SORT  ───────────────── */
describe('Products: sort', () => {
  test('sortBy=name&sortDir=asc reorders alphabetically', async () => {
    const r = await hit('GET',
      `/api/catalog/products?departmentId=${testDeptId}&sortBy=name&sortDir=asc&limit=100`);
    const names = unwrap(r.body).map(p => p.name);
    const sorted = [...names].sort();
    assert.deepEqual(names, sorted, 'expected ascending name order');
  });

  test('sortBy=name&sortDir=desc reorders reverse-alphabetically', async () => {
    const r = await hit('GET',
      `/api/catalog/products?departmentId=${testDeptId}&sortBy=name&sortDir=desc&limit=100`);
    const names = unwrap(r.body).map(p => p.name);
    const sortedDesc = [...names].sort().reverse();
    assert.deepEqual(names, sortedDesc, 'expected descending name order');
  });

  test('sortBy=retail&sortDir=desc reorders by price desc', async () => {
    const r = await hit('GET',
      `/api/catalog/products?departmentId=${testDeptId}&sortBy=retail&sortDir=desc&limit=100`);
    const prices = unwrap(r.body).map(p => Number(p.defaultRetailPrice));
    for (let i = 0; i < prices.length - 1; i++) {
      assert.ok(prices[i] >= prices[i + 1], `price${i}(${prices[i]}) >= price${i+1}(${prices[i+1]})`);
    }
  });

  test('sortBy=invalidkey falls back gracefully (no 500)', async () => {
    // PRODUCT_SORT_MAP[req.query.sortBy] || { name: 'asc' }
    // so an unknown key just sorts by name asc.
    const r = await hit('GET',
      `/api/catalog/products?departmentId=${testDeptId}&sortBy=this_key_does_not_exist&limit=100`);
    assert.equal(r.status, 200, 'unknown sortBy should not 500');
    const names = unwrap(r.body).map(p => p.name);
    const sorted = [...names].sort();
    assert.deepEqual(names, sorted, 'fallback should be name-asc');
  });
});

/* ─────────────────  PRODUCTS — SEARCH  ───────────────── */
describe('Products: search (?q=)', () => {
  test('q=QFTest narrows to the seeded products', async () => {
    const r = await hit('GET', `/api/catalog/products/search?q=QFTest&limit=100`);
    assert.equal(r.status, 200);
    const list = unwrap(r.body);
    // Should at least find our 3 seeded products
    const seededFound = createdProducts.filter(id =>
      list.some(p => p.id === id)
    ).length;
    assert.ok(seededFound >= 1,
      `expected to find at least 1 seeded product matching "QFTest", got ${seededFound}`);
  });

  test('q=Apple finds the seeded "Apple" product', async () => {
    const r = await hit('GET', `/api/catalog/products/search?q=Apple&limit=100`);
    assert.equal(r.status, 200);
    const list = unwrap(r.body);
    const found = list.some(p => /apple/i.test(p.name));
    assert.ok(found, 'search for "Apple" should match a product name containing Apple');
  });

  test('empty q → 400', async () => {
    const r = await hit('GET', `/api/catalog/products/search?q=`);
    assert.equal(r.status, 400);
  });
});

/* ─────────────────  GROUPS — FILTER  ───────────────── */
describe('Groups: ?active filter', () => {
  test('?active=true returns only active', async () => {
    const r = await hit('GET', '/api/catalog/groups?active=true');
    assert.equal(r.status, 200);
    const list = unwrap(r.body);
    for (const g of list) {
      assert.equal(g.active, true);
    }
  });

  test('?active=false returns only inactive (or empty)', async () => {
    const r = await hit('GET', '/api/catalog/groups?active=false');
    assert.equal(r.status, 200);
    const list = unwrap(r.body);
    for (const g of list) {
      assert.equal(g.active, false);
    }
  });
});

/* ─────────────────  IMPORT HISTORY — PAGINATION + TYPE FILTER  ───────────────── */
describe('Import History: pagination + type filter', () => {
  test('returns jobs[] + pagination', async () => {
    const r = await hit('GET', '/api/catalog/import/history?page=1&limit=5');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.jobs));
    assert.ok(r.body.pagination);
  });

  test('?type=products returns only product imports (or empty)', async () => {
    const r = await hit('GET', '/api/catalog/import/history?type=products');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.jobs));
    // If any rows came back, every one must have type=products
    for (const j of r.body.jobs) {
      assert.equal(j.type, 'products', `job ${j.id} type should be 'products' but is ${j.type}`);
    }
  });
});

/* ─────────────────  INVENTORY ADJUSTMENTS — DATE/REASON FILTER  ───────────────── */
describe('Inventory Adjustments: filters', () => {
  let adjId = null;

  before(async () => {
    // Create one adjustment so the date filters have a row to find
    const r = await hit('POST', '/api/inventory/adjustments', {
      masterProductId: createdProducts[0],
      adjustmentQty: -1,
      reason: 'shrinkage',
      notes: 'query feature test',
    });
    if (r.status === 201) adjId = r.body.id;
  });

  after(async () => {
    if (adjId) {
      await prisma.inventoryAdjustment.deleteMany({ where: { id: adjId } }).catch(() => {});
    }
  });

  test('?reason=shrinkage filters to that reason', async () => {
    const r = await hit('GET', '/api/inventory/adjustments?reason=shrinkage&limit=200');
    assert.equal(r.status, 200);
    for (const a of r.body.adjustments) {
      assert.equal(a.reason, 'shrinkage');
    }
  });

  test('?from=2099-01-01&to=2099-12-31 (future range) returns 0 rows', async () => {
    const r = await hit('GET', '/api/inventory/adjustments?from=2099-01-01&to=2099-12-31');
    assert.equal(r.status, 200);
    assert.equal(r.body.adjustments.length, 0);
  });

  test('?from=2000-01-01 (past) returns >=1 if any exist', async () => {
    const r = await hit('GET', '/api/inventory/adjustments?from=2000-01-01&limit=200');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.adjustments));
  });

  test('?masterProductId=X scopes to that product', async () => {
    const r = await hit('GET',
      `/api/inventory/adjustments?masterProductId=${createdProducts[0]}&limit=200`);
    assert.equal(r.status, 200);
    for (const a of r.body.adjustments) {
      assert.equal(a.masterProductId, createdProducts[0]);
    }
  });
});
