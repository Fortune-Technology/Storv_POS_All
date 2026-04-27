// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

/**
 * Portal validation tests — exercises input validation on the 7 portal tab APIs.
 *
 * For each endpoint we verify:
 *   - missing required field   → 400
 *   - bad data type / format    → 400 (or whatever the controller actually returns)
 *   - duplicate uniques         → 409 (or whatever the controller returns)
 *   - oversized inputs          → controller-defined behavior
 *   - non-existent ids          → 404
 *
 * Behavior is asserted against actual controller code, not assumed shoulds.
 *
 * Prereqs:
 *   - Backend running on http://localhost:5000
 *   - Seed run (owner@storeveu.com exists)
 *
 * Run: node --test tests/portal_validation.test.mjs
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

const created = { products: [], departments: [], promotions: [], groups: [], adjustments: [], labelQueue: [] };

before(async () => {
  const user = await prisma.user.findFirst({ where: { email: 'owner@storeveu.com' } });
  assert.ok(user, 'owner@storeveu.com must exist (run seed:all first)');
  TOKEN = jwt.sign(
    { id: user.id, orgId: user.orgId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
});

after(async () => {
  try {
    for (const id of created.labelQueue) await prisma.labelQueue.deleteMany({ where: { id } }).catch(() => {});
    for (const id of created.adjustments) await prisma.inventoryAdjustment.deleteMany({ where: { id } }).catch(() => {});
    for (const id of created.promotions) await prisma.promotion.deleteMany({ where: { id, orgId: ORG } }).catch(() => {});
    for (const id of created.groups) await prisma.productGroup.deleteMany({ where: { id, orgId: ORG } }).catch(() => {});
    for (const id of created.products) await prisma.masterProduct.deleteMany({ where: { id, orgId: ORG } }).catch(() => {});
    for (const id of created.departments) await prisma.department.deleteMany({ where: { id, orgId: ORG } }).catch(() => {});
  } catch (e) {
    console.warn('cleanup error:', e.message);
  }
  await prisma.$disconnect();
});

/* ───────────────────  1. PRODUCT CATALOG  ─────────────────── */
describe('Catalog: validation', () => {
  test('missing name → 400', async () => {
    const r = await hit('POST', '/api/catalog/products', { upc: `9${Date.now()}`.slice(0, 12) });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /name/i);
  });

  test('non-numeric defaultRetailPrice "abc" → 400', async () => {
    const r = await hit('POST', '/api/catalog/products', {
      name: 'Validate Test 1',
      defaultRetailPrice: 'abc',
    });
    // toPrice → parsePrice rejects "abc"
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  test('scientific notation "1e5" → 400 (parsePrice regex is strict)', async () => {
    const r = await hit('POST', '/api/catalog/products', {
      name: 'Validate Test 2',
      defaultRetailPrice: '1e5',
    });
    // parsePrice regex /^-?\d+(\.\d+)?$/ rejects "1e5"
    assert.equal(r.status, 400, `expected 400, got ${r.status}`);
  });

  test('negative price "-5.00" → 400 (min:0)', async () => {
    const r = await hit('POST', '/api/catalog/products', {
      name: 'Validate Test 3',
      defaultRetailPrice: '-5.00',
    });
    assert.equal(r.status, 400);
  });

  test('duplicate UPC → 409', async () => {
    const upc = `9${Date.now()}`.slice(0, 12);
    const r1 = await hit('POST', '/api/catalog/products', {
      name: 'First UPC owner',
      upc,
      defaultRetailPrice: 1.99,
    });
    assert.equal(r1.status, 201);
    const id1 = unwrap(r1.body).id;
    created.products.push(id1);

    const r2 = await hit('POST', '/api/catalog/products', {
      name: 'Dup UPC',
      upc,
      defaultRetailPrice: 2.99,
    });
    assert.equal(r2.status, 409, `expected 409, got ${r2.status}: ${JSON.stringify(r2.body).slice(0, 200)}`);
  });

  test('GET /products/:id with non-existent id → 404', async () => {
    const r = await hit('GET', '/api/catalog/products/999999999');
    assert.equal(r.status, 404);
  });

  test('GET /products/search with no q → 400', async () => {
    const r = await hit('GET', '/api/catalog/products/search');
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /query/i);
  });
});

/* ───────────────────  2. DEPARTMENTS  ─────────────────── */
describe('Departments: validation', () => {
  test('missing name → 400', async () => {
    const r = await hit('POST', '/api/catalog/departments', { code: 'X1' });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /name/i);
  });

  test('duplicate code → 409 (P2002)', async () => {
    const stamp = Date.now().toString().slice(-6);
    const code = `VDD${stamp}`;
    const r1 = await hit('POST', '/api/catalog/departments', {
      name: `Dup Test 1 ${stamp}`,
      code,
    });
    assert.equal(r1.status, 201);
    created.departments.push(unwrap(r1.body).id);

    const r2 = await hit('POST', '/api/catalog/departments', {
      name: `Dup Test 2 ${stamp}`,
      code,
    });
    assert.equal(r2.status, 409, `expected 409, got ${r2.status}: ${JSON.stringify(r2.body).slice(0, 200)}`);
  });

  test('UPDATE invalid category → 400', async () => {
    // First create a dept to update
    const stamp = Date.now().toString().slice(-6);
    const c = await hit('POST', '/api/catalog/departments', {
      name: `Cat Test ${stamp}`,
      code: `CAT${stamp}`,
    });
    assert.equal(c.status, 201);
    const id = unwrap(c.body).id;
    created.departments.push(id);

    const r = await hit('PUT', `/api/catalog/departments/${id}`, {
      category: 'absolutelynotacategory',
    });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /category/i);
  });

  test('UPDATE non-existent dept → 404', async () => {
    const r = await hit('PUT', '/api/catalog/departments/999999999', { name: 'x' });
    assert.equal(r.status, 404);
  });

  test('DELETE dept with active products without force → 409', async () => {
    // Find a dept that has products via the seed
    const dept = await prisma.department.findFirst({
      where: { orgId: ORG, active: true },
      select: { id: true },
    });
    const hasProducts = dept ? await prisma.masterProduct.count({
      where: { orgId: ORG, departmentId: dept.id, deleted: false },
    }) : 0;
    if (!dept || hasProducts === 0) {
      // Skip if seed has no dept-with-products mapping
      return;
    }
    const r = await hit('DELETE', `/api/catalog/departments/${dept.id}`);
    assert.equal(r.status, 409, `expected 409, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    assert.match(JSON.stringify(r.body), /IN_USE|product/i);
  });
});

/* ───────────────────  3. PROMOTIONS  ─────────────────── */
describe('Promotions: validation', () => {
  test('missing name → 400', async () => {
    const r = await hit('POST', '/api/catalog/promotions', {
      promoType: 'sale',
    });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /name|promoType/i);
  });

  test('missing promoType → 400', async () => {
    const r = await hit('POST', '/api/catalog/promotions', {
      name: 'Missing type test',
    });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /promoType|name/i);
  });

  test('garbage startDate → 400 (tryParseDate)', async () => {
    const r = await hit('POST', '/api/catalog/promotions', {
      name: 'Bad date test',
      promoType: 'sale',
      startDate: 'not-a-date-at-all',
      dealConfig: { saleType: 'flat', flatPrice: 1.99 },
    });
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  test('endDate before startDate is currently NOT validated (controller behavior)', async () => {
    // Verify CURRENT behavior: controller DOES NOT enforce end > start.
    // If this test fails, the controller has been hardened and the test
    // should be flipped to assert 400.
    const r = await hit('POST', '/api/catalog/promotions', {
      name: `Inverted dates ${Date.now()}`,
      promoType: 'sale',
      startDate: '2099-01-15',
      endDate:   '2099-01-01',
      dealConfig: { saleType: 'flat', flatPrice: 1.99 },
      productIds: [],
      departmentIds: [],
    });
    // Currently accepted. Document the gap.
    if (r.status === 201) {
      created.promotions.push(unwrap(r.body).id);
      assert.equal(r.status, 201, 'endDate < startDate currently accepted (no controller validation)');
    } else {
      // Future-proof: if controller adds validation, accept 400 too.
      assert.ok(r.status === 400 || r.status === 201, `unexpected ${r.status}`);
    }
  });

  test('UPDATE non-existent promotion → 404', async () => {
    const r = await hit('PUT', '/api/catalog/promotions/999999999', { description: 'x' });
    assert.equal(r.status, 404);
  });
});

/* ───────────────────  4. PRODUCT GROUPS  ─────────────────── */
describe('Product Groups: validation', () => {
  test('missing name → 400', async () => {
    const r = await hit('POST', '/api/catalog/groups', {
      description: 'no name supplied',
    });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /name/i);
  });

  test('garbage saleStart → 400 (tryParseDate)', async () => {
    const r = await hit('POST', '/api/catalog/groups', {
      name: `Bad date group ${Date.now()}`,
      saleStart: 'not-a-real-date',
    });
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  test('GET non-existent group → 404', async () => {
    const r = await hit('GET', '/api/catalog/groups/999999999');
    assert.equal(r.status, 404);
  });
});

/* ───────────────────  5. BULK IMPORT  ─────────────────── */
describe('Bulk Import: validation', () => {
  test('invalid template type → 400', async () => {
    const r = await hit('GET', '/api/catalog/import/template/notarealtype');
    assert.equal(r.status, 400);
  });

  test('path-traversal-style template type → 400 (still treated as bogus)', async () => {
    // Express normalizes the URL but passes the raw segment as :type
    const r = await fetch(API + '/api/catalog/import/template/' + encodeURIComponent('../etc/passwd'), {
      headers: H(),
    });
    // Either 400 (rejected as bogus type) or some other error code, but
    // critically NOT 200 (would indicate path traversal)
    assert.notEqual(r.status, 200, 'path traversal must not return 200');
    assert.ok(r.status === 400 || r.status === 404, `expected 400/404, got ${r.status}`);
  });

  test('long type string → 400', async () => {
    const longType = 'x'.repeat(500);
    const r = await hit('GET', `/api/catalog/import/template/${longType}`);
    assert.ok(r.status === 400 || r.status === 414, `got ${r.status}`);
  });

  test('non-existent history job → 404', async () => {
    const r = await hit('GET', '/api/catalog/import/history/999999999');
    assert.equal(r.status, 404);
  });
});

/* ───────────────────  6. INVENTORY ADJUSTMENTS  ─────────────────── */
describe('Inventory Adjustments: validation', () => {
  test('missing masterProductId → 400', async () => {
    const r = await hit('POST', '/api/inventory/adjustments', {
      adjustmentQty: 1,
      reason: 'shrinkage',
    });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /masterProductId|required/i);
  });

  test('missing reason → 400', async () => {
    const product = await prisma.masterProduct.findFirst({
      where: { orgId: ORG, active: true },
      select: { id: true },
    });
    assert.ok(product);
    const r = await hit('POST', '/api/inventory/adjustments', {
      masterProductId: product.id,
      adjustmentQty: 1,
    });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /reason|required/i);
  });

  test('missing adjustmentQty → 400 (controller checks `qty == null`)', async () => {
    const product = await prisma.masterProduct.findFirst({
      where: { orgId: ORG, active: true },
      select: { id: true },
    });
    const r = await hit('POST', '/api/inventory/adjustments', {
      masterProductId: product.id,
      reason: 'shrinkage',
    });
    assert.equal(r.status, 400);
  });

  test('zero qty IS accepted (controller does not validate non-zero)', async () => {
    // Document current behavior — controller only blocks `null`, not zero.
    // If this becomes a real bug, this assertion should be flipped.
    const product = await prisma.masterProduct.findFirst({
      where: { orgId: ORG, active: true },
      select: { id: true },
    });
    const r = await hit('POST', '/api/inventory/adjustments', {
      masterProductId: product.id,
      adjustmentQty: 0,
      reason: 'count_correction',
    });
    // currently 201 — known gap (zero adj has no effect but is recorded)
    assert.equal(r.status, 201, `controller accepts 0-qty; got ${r.status}`);
    if (r.body?.id) created.adjustments.push(r.body.id);
  });
});

/* ───────────────────  7. LABEL QUEUE  ─────────────────── */
describe('Label Queue: validation', () => {
  test('add with empty productIds → 400', async () => {
    const r = await hit('POST', '/api/label-queue/add', { productIds: [] });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /productIds|required/i);
  });

  test('add with no productIds field → 400', async () => {
    const r = await hit('POST', '/api/label-queue/add', {});
    assert.equal(r.status, 400);
  });

  test('add with non-array productIds → 400', async () => {
    const r = await hit('POST', '/api/label-queue/add', { productIds: 'not-an-array' });
    assert.equal(r.status, 400);
  });

  test('print with empty ids → 400', async () => {
    const r = await hit('POST', '/api/label-queue/print', { ids: [] });
    assert.equal(r.status, 400);
  });

  test('dismiss with empty ids → 400', async () => {
    const r = await hit('POST', '/api/label-queue/dismiss', { ids: [] });
    assert.equal(r.status, 400);
  });

  test('print with non-existent id → 200 with updated:0 (updateMany is no-op)', async () => {
    // Document current behavior — markAsPrinted uses updateMany so a bogus id
    // returns count:0 with no error. There is NO 404 for missing labels.
    const r = await hit('POST', '/api/label-queue/print', { ids: [999999999] });
    assert.equal(r.status, 200);
    assert.equal(r.body.updated, 0);
  });
});
