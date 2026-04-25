/**
 * Portal 7-tab CRUD test — exercises the backend APIs for these portal pages:
 *
 *   1. /portal/catalog          → /api/catalog/products
 *   2. /portal/product-groups   → /api/catalog/groups
 *   3. /portal/departments      → /api/catalog/departments
 *   4. /portal/promotions       → /api/catalog/promotions
 *   5. /portal/import           → /api/catalog/import/* (history + template)
 *   6. /portal/inventory-count  → /api/inventory/adjustments
 *   7. /portal/label-queue      → /api/label-queue
 *
 * Each resource: list, create, read-by-id (if supported), update, delete.
 * Idempotent — every created row is cleaned up on success or in `after()`.
 *
 * Prereqs:
 *   - Backend running on http://localhost:5000
 *   - Seed has been run: `npm run seed:all:fast` (default org + store + owner@storeveu.com)
 *
 * Run: node --test tests/portal_seven_tabs_crud.test.mjs
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

// Unwrap the {success,data} envelope used by catalog endpoints
const unwrap = (b) => (b && typeof b === 'object' && 'data' in b) ? b.data : b;

// Track ids for cleanup on hard failure
const created = {
  products: [], groups: [], departments: [], promotions: [],
  adjustments: [], labelQueue: [],
};

before(async () => {
  // Pre-flight: backend up?
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(API + '/api/health', { signal: ctrl.signal }).catch(() => fetch(API + '/', { signal: ctrl.signal }));
    clearTimeout(t);
    // any response (even 401/404) means it's alive
    if (!r) throw new Error('no response');
  } catch {
    console.error('\n  ✗ Backend not running on ' + API + '. Start it with: cd backend && npm run dev\n');
    process.exit(1);
  }

  const user = await prisma.user.findFirst({ where: { email: 'owner@storeveu.com' } });
  assert.ok(user, 'owner@storeveu.com must exist (run seed:all first)');
  TOKEN = jwt.sign(
    { id: user.id, orgId: user.orgId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
});

after(async () => {
  // Best-effort cleanup of anything we leaked
  try {
    for (const id of created.labelQueue) {
      await prisma.labelQueue.deleteMany({ where: { id } }).catch(() => {});
    }
    for (const id of created.adjustments) {
      await prisma.inventoryAdjustment.deleteMany({ where: { id } }).catch(() => {});
    }
    for (const id of created.promotions) {
      await prisma.promotion.deleteMany({ where: { id, orgId: ORG } }).catch(() => {});
    }
    for (const id of created.groups) {
      await prisma.productGroup.deleteMany({ where: { id, orgId: ORG } }).catch(() => {});
    }
    for (const id of created.products) {
      await prisma.masterProduct.deleteMany({ where: { id, orgId: ORG } }).catch(() => {});
    }
    for (const id of created.departments) {
      await prisma.department.deleteMany({ where: { id, orgId: ORG } }).catch(() => {});
    }
  } catch (e) {
    console.warn('cleanup error:', e.message);
  }
  await prisma.$disconnect();
});

/* ─────────────────────  1. PRODUCT CATALOG  ───────────────────── */
describe('1. Product Catalog (/api/catalog/products)', () => {
  let id = null;

  test('list paginated', async () => {
    const r = await hit('GET', '/api/catalog/products?page=1&limit=5');
    assert.equal(r.status, 200);
    const data = unwrap(r.body);
    // controller returns { products, total, ... } wrapped in {success,data}
    const list = Array.isArray(data) ? data : (data.products || data.items || []);
    assert.ok(Array.isArray(list), `expected array, got ${typeof list}`);
  });

  test('create', async () => {
    const r = await hit('POST', '/api/catalog/products', {
      name: 'CRUD Test Product',
      upc: `9${Date.now()}`.slice(0, 12),
      defaultRetailPrice: 1.99,
      defaultCostPrice: 1.00,
      active: true,
    });
    assert.equal(r.status, 201, `got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    const d = unwrap(r.body);
    id = d.id;
    assert.ok(id);
    created.products.push(id);
  });

  test('read by id', async () => {
    const r = await hit('GET', `/api/catalog/products/${id}`);
    assert.equal(r.status, 200);
    const d = unwrap(r.body);
    assert.equal(d.name, 'CRUD Test Product');
  });

  test('update', async () => {
    const r = await hit('PUT', `/api/catalog/products/${id}`, {
      name: 'CRUD Test Product Updated',
      defaultRetailPrice: 2.49,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0,200));
    const d = unwrap(r.body);
    assert.equal(d.name, 'CRUD Test Product Updated');
  });

  test('delete (soft)', async () => {
    const r = await hit('DELETE', `/api/catalog/products/${id}`);
    assert.ok(r.status === 200 || r.status === 204, `got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    // remove from cleanup list — already deleted (soft = active:false in DB still ok to delete in cleanup)
  });
});

/* ─────────────────────  2. PRODUCT GROUPS  ───────────────────── */
describe('2. Product Groups (/api/catalog/groups)', () => {
  let id = null;

  test('list', async () => {
    const r = await hit('GET', '/api/catalog/groups');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(unwrap(r.body)));
  });

  test('create', async () => {
    const r = await hit('POST', '/api/catalog/groups', {
      name: `CRUD Test Group ${Date.now()}`,
      description: 'Created by portal_seven_tabs_crud test',
      color: '#7ac143',
      taxClass: 'grocery',
      active: true,
    });
    assert.equal(r.status, 201, `got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    const d = unwrap(r.body);
    id = d.id;
    assert.ok(id);
    created.groups.push(id);
  });

  test('read by id', async () => {
    const r = await hit('GET', `/api/catalog/groups/${id}`);
    assert.equal(r.status, 200);
    const d = unwrap(r.body);
    assert.ok(d.name.startsWith('CRUD Test Group'));
  });

  test('update', async () => {
    const r = await hit('PUT', `/api/catalog/groups/${id}`, {
      description: 'Updated description',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0,200));
    const d = unwrap(r.body);
    assert.equal(d.description, 'Updated description');
  });

  test('delete', async () => {
    const r = await hit('DELETE', `/api/catalog/groups/${id}`);
    assert.ok(r.status === 200 || r.status === 204, `got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
  });
});

/* ─────────────────────  3. DEPARTMENTS  ───────────────────── */
describe('3. Departments (/api/catalog/departments)', () => {
  let id = null;

  test('list', async () => {
    const r = await hit('GET', '/api/catalog/departments');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(unwrap(r.body)));
  });

  test('create', async () => {
    const stamp = Date.now().toString().slice(-6);
    const r = await hit('POST', '/api/catalog/departments', {
      name: `CRUD Test Dept ${stamp}`,
      code: `CRUD${stamp}`,
      taxClass: 'grocery',
      ebtEligible: true,
      sortOrder: 999,
    });
    assert.equal(r.status, 201, `got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    const d = unwrap(r.body);
    id = d.id;
    assert.ok(id);
    created.departments.push(id);
  });

  // Departments controller has no GET /:id (the list returns the row); skip read-by-id
  test('read via list', async () => {
    const r = await hit('GET', '/api/catalog/departments');
    assert.equal(r.status, 200);
    const list = unwrap(r.body);
    const found = list.find((d) => d.id === id);
    assert.ok(found, 'created dept should be in list');
  });

  test('update', async () => {
    const r = await hit('PUT', `/api/catalog/departments/${id}`, {
      name: 'CRUD Test Dept Updated',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0,200));
    const d = unwrap(r.body);
    assert.equal(d.name, 'CRUD Test Dept Updated');
  });

  test('delete', async () => {
    const r = await hit('DELETE', `/api/catalog/departments/${id}`);
    assert.ok(r.status === 200 || r.status === 204, `got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
  });
});

/* ─────────────────────  4. PROMOTIONS  ───────────────────── */
describe('4. Promotions (/api/catalog/promotions)', () => {
  let id = null;

  test('list', async () => {
    const r = await hit('GET', '/api/catalog/promotions');
    assert.equal(r.status, 200);
    const data = unwrap(r.body);
    const list = Array.isArray(data) ? data : (data.promotions || []);
    assert.ok(Array.isArray(list));
  });

  test('create', async () => {
    const r = await hit('POST', '/api/catalog/promotions', {
      name: `CRUD Test Promo ${Date.now()}`,
      promoType: 'sale',
      description: 'Created by portal_seven_tabs_crud test',
      productIds: [],
      departmentIds: [],
      dealConfig: { saleType: 'flat', flatPrice: 1.99 },
      active: true,
    });
    assert.equal(r.status, 201, `got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    const d = unwrap(r.body);
    id = d.id;
    assert.ok(id);
    created.promotions.push(id);
  });

  // Promotions controller has no GET /:id; verify by re-listing
  test('read via list', async () => {
    const r = await hit('GET', '/api/catalog/promotions');
    assert.equal(r.status, 200);
    const data = unwrap(r.body);
    const list = Array.isArray(data) ? data : (data.promotions || []);
    assert.ok(list.find((p) => p.id === id), 'created promo should be in list');
  });

  test('update', async () => {
    const r = await hit('PUT', `/api/catalog/promotions/${id}`, {
      description: 'Updated description',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0,200));
    const d = unwrap(r.body);
    assert.equal(d.description, 'Updated description');
  });

  test('delete', async () => {
    const r = await hit('DELETE', `/api/catalog/promotions/${id}`);
    assert.ok(r.status === 200 || r.status === 204, `got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
  });
});

/* ─────────────────────  5. BULK IMPORT  ─────────────────────
 *
 * Preview/Commit need a multipart file upload (multer) which is awkward to
 * synthesize cleanly in node:test without `form-data`. Instead we test the
 * read-only surface the BulkImport page actually polls on load:
 *   - GET history (paginated)
 *   - GET template/:type (CSV download)
 *   - GET history/:id (404 for non-existent)
 */
describe('5. Bulk Import (/api/catalog/import)', () => {
  test('list history', async () => {
    const r = await hit('GET', '/api/catalog/import/history?page=1&limit=10');
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0,200));
    assert.ok(Array.isArray(r.body.jobs), 'history.jobs should be an array');
    assert.ok(r.body.pagination, 'history.pagination should be present');
  });

  test('history filter by valid type', async () => {
    const r = await hit('GET', '/api/catalog/import/history?type=products');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.jobs));
  });

  test('download products template', async () => {
    // template returns raw CSV (Content-Type: text/csv), so we hit it with raw fetch
    const r = await fetch(API + '/api/catalog/import/template/products', {
      headers: H(),
    });
    assert.equal(r.status, 200);
    const ctype = r.headers.get('content-type') || '';
    assert.ok(ctype.includes('csv'), `expected csv content-type, got ${ctype}`);
    const text = await r.text();
    assert.ok(text.length > 0, 'template should not be empty');
  });

  test('invalid template type → 400', async () => {
    const r = await hit('GET', '/api/catalog/import/template/notarealtype');
    assert.equal(r.status, 400);
  });

  test('non-existent job → 404', async () => {
    const r = await hit('GET', '/api/catalog/import/history/999999999');
    assert.equal(r.status, 404);
  });
});

/* ─────────────────────  6. INVENTORY COUNT  ───────────────────── */
describe('6. Inventory Adjustments (/api/inventory/adjustments)', () => {
  let adjId = null;
  let productId = null;

  test('list (empty or seed-baseline)', async () => {
    const r = await hit('GET', '/api/inventory/adjustments');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.adjustments));
  });

  test('summary', async () => {
    const r = await hit('GET', '/api/inventory/adjustments/summary');
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.totalUnits === 'number');
    assert.ok(typeof r.body.totalValue === 'number');
    assert.ok(Array.isArray(r.body.byReason));
  });

  test('create adjustment', async () => {
    // need a real product to point at
    const product = await prisma.masterProduct.findFirst({ where: { orgId: ORG, active: true }, select: { id: true } });
    assert.ok(product, 'Need at least one active product in seed data');
    productId = product.id;

    const r = await hit('POST', '/api/inventory/adjustments', {
      masterProductId: productId,
      adjustmentQty: -1,   // 1 unit shrinkage
      reason: 'shrinkage',
      notes: 'CRUD test',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body).slice(0,200));
    adjId = r.body.id;
    assert.ok(adjId);
    created.adjustments.push(adjId);
  });

  test('list now includes our adjustment', async () => {
    const r = await hit('GET', '/api/inventory/adjustments');
    assert.equal(r.status, 200);
    assert.ok(r.body.adjustments.find((a) => a.id === adjId), 'created adj should be in list');
  });

  test('reverse the adjustment to restore inventory', async () => {
    // No DELETE/UPDATE endpoint on adjustments — they're an immutable audit trail.
    // Best we can do is post a reversing adjustment.
    const r = await hit('POST', '/api/inventory/adjustments', {
      masterProductId: productId,
      adjustmentQty: 1,
      reason: 'count_correction',
      notes: 'CRUD test reversal',
    });
    assert.equal(r.status, 201);
    created.adjustments.push(r.body.id);
  });
});

/* ─────────────────────  7. LABEL QUEUE  ───────────────────── */
describe('7. Label Queue (/api/label-queue)', () => {
  let labelId = null;
  let productId = null;

  test('list pending', async () => {
    const r = await hit('GET', '/api/label-queue');
    assert.equal(r.status, 200);
    // controller returns {data,total,...} OR plain array — accept both
    const list = Array.isArray(r.body) ? r.body : (r.body.data || r.body.items || []);
    assert.ok(Array.isArray(list), `expected array, got ${typeof list}`);
  });

  test('count for badge', async () => {
    const r = await hit('GET', '/api/label-queue/count');
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.count === 'number');
  });

  test('add manual item', async () => {
    const product = await prisma.masterProduct.findFirst({ where: { orgId: ORG, active: true }, select: { id: true } });
    assert.ok(product);
    productId = product.id;

    const r = await hit('POST', '/api/label-queue/add', { productIds: [productId] });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0,200));
    assert.equal(r.body.added, 1);
    assert.ok(Array.isArray(r.body.data));
    labelId = r.body.data[0].id;
    assert.ok(labelId);
    created.labelQueue.push(labelId);
  });

  test('mark as printed', async () => {
    const r = await hit('POST', '/api/label-queue/print', { ids: [labelId] });
    assert.equal(r.status, 200);
    assert.equal(r.body.updated, 1);
  });

  test('add second item then dismiss', async () => {
    // re-add the same product (it'll create a fresh row since the previous
    // is now status='printed', not status='pending')
    const r1 = await hit('POST', '/api/label-queue/add', { productIds: [productId] });
    assert.equal(r1.status, 200);
    const newId = r1.body.data[0].id;
    created.labelQueue.push(newId);

    const r2 = await hit('POST', '/api/label-queue/dismiss', { ids: [newId] });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.updated, 1);
  });
});
