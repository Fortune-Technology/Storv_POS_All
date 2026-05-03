// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

/**
 * Catalog + Vendors CRUD integration tests.
 * Prereq: backend running on :5000 AND `npm run db:seed:all` has been run.
 *
 * Run: node --test tests/catalog-vendors.test.mjs
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

async function hit(method, path, body) {
  const init = { method, headers: H() };
  if (body != null) init.body = JSON.stringify(body);
  const r = await fetch(API + path, init);
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, body: json };
}

before(async () => {
  // Pre-flight: is the backend up?
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    await fetch(API + '/api/health', { signal: ctrl.signal }).catch(() => fetch(API + '/', { signal: ctrl.signal }));
    clearTimeout(t);
  } catch {
    console.error('\n\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('  ✗ Backend is not running on ' + API);
    console.error('    Start it first:   npm run dev:backend   (from repo root)');
    console.error('    Or:               cd backend && npm run dev');
    console.error('    Then re-run:      npm run test:crud');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n');
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

after(async () => { await prisma.$disconnect(); });

/* ─────────────────────────  PRODUCTS  ───────────────────────── */
describe('Products CRUD', () => {
  let pid = null;
  test('list', async () => {
    const r = await hit('GET', '/api/catalog/products/bulk?page=1&pageSize=5');
    assert.equal(r.status, 200);
    const list = r.body.data ?? r.body.products ?? r.body;
    assert.ok(Array.isArray(list), 'expected array, got ' + JSON.stringify(Object.keys(r.body)));
    assert.ok(list.length > 0);
  });
  test('search', async () => {
    const r = await hit('GET', '/api/catalog/products/search?q=Bud&limit=5');
    assert.equal(r.status, 200);
    const items = r.body.data ?? r.body;
    assert.ok(Array.isArray(items));
  });
  test('create', async () => {
    const depts = await prisma.department.findMany({ where: { orgId: ORG }, take: 1 });
    const r = await hit('POST', '/api/catalog/products', {
      name: `Test Product ${Date.now()}`,
      upc: String(Date.now()).slice(-12),
      departmentId: depts[0].id,
      defaultRetailPrice: 4.99,
      defaultCostPrice: 2.50,
      taxClass: 'grocery',
      ebtEligible: true,
      active: true,
    });
    assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
    pid = (r.body.data ?? r.body).id;
    assert.ok(pid);
  });
  test('update', async () => {
    const r = await hit('PUT', `/api/catalog/products/${pid}`, { defaultRetailPrice: 5.99 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
  test('delete (soft)', async () => {
    const r = await hit('DELETE', `/api/catalog/products/${pid}`);
    assert.ok([200, 204].includes(r.status));
    // Hard-delete follow-up so the product (and any label-queue rows) don't leak.
    await prisma.labelQueue.deleteMany({ where: { masterProductId: pid } }).catch(() => {});
    await prisma.masterProduct.delete({ where: { id: pid } }).catch(() => {});
  });
});

/* ─────────────────────────  DEPARTMENTS  ───────────────────────── */
describe('Departments CRUD', () => {
  let did = null;
  test('list', async () => {
    const r = await hit('GET', '/api/catalog/departments');
    assert.equal(r.status, 200);
    const list = r.body.data ?? r.body;
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 20);
  });
  test('create', async () => {
    const r = await hit('POST', '/api/catalog/departments', {
      code: `TEST${Date.now().toString().slice(-4)}`,
      name: `Test Dept ${Date.now()}`,
      taxClass: 'grocery',
      ebtEligible: true,
      sortOrder: 999,
      color: '#ff0000',
    });
    assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
    did = (r.body.data ?? r.body).id;
  });
  test('update', async () => {
    const r = await hit('PUT', `/api/catalog/departments/${did}`, { sortOrder: 888 });
    assert.equal(r.status, 200);
  });
  test('delete', async () => {
    const r = await hit('DELETE', `/api/catalog/departments/${did}`);
    assert.ok([200, 204].includes(r.status));
    await prisma.department.delete({ where: { id: did } }).catch(() => {});
  });
});

/* ─────────────────────────  PROMOTIONS  ───────────────────────── */
describe('Promotions CRUD', () => {
  let pmId = null;
  test('list', async () => {
    const r = await hit('GET', '/api/catalog/promotions');
    assert.equal(r.status, 200);
    const list = r.body.data ?? r.body;
    assert.ok(Array.isArray(list));
  });
  test('create', async () => {
    const prods = await prisma.masterProduct.findMany({ where: { orgId: ORG, active: true }, take: 2 });
    const r = await hit('POST', '/api/catalog/promotions', {
      name: `Test Promo ${Date.now()}`,
      promoType: 'sale',
      description: 'CRUD test promo',
      productIds: prods.map(p => p.id),
      departmentIds: [],
      dealConfig: { discountType: 'pct', discountValue: 10 },
      badgeLabel: '10% OFF',
      badgeColor: '#f59e0b',
      active: true,
    });
    assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
    pmId = (r.body.data ?? r.body).id;
  });
  test('update', async () => {
    const r = await hit('PUT', `/api/catalog/promotions/${pmId}`, { active: false });
    assert.equal(r.status, 200);
  });
  test('delete', async () => {
    const r = await hit('DELETE', `/api/catalog/promotions/${pmId}`);
    assert.ok([200, 204].includes(r.status));
    await prisma.promotion.delete({ where: { id: pmId } }).catch(() => {});
  });
});

/* ─────────────────────────  PRODUCT GROUPS  ───────────────────────── */
describe('Product Groups CRUD', () => {
  let gid = null;
  test('list', async () => {
    const r = await hit('GET', '/api/catalog/groups');
    assert.equal(r.status, 200);
    const list = r.body.data ?? r.body;
    assert.ok(Array.isArray(list));
  });
  test('create', async () => {
    const r = await hit('POST', '/api/catalog/groups', {
      name: `Test Group ${Date.now()}`,
      description: 'CRUD test group',
      color: '#3b82f6',
      taxable: true,
      taxClass: 'grocery',
      active: true,
    });
    assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
    gid = (r.body.data ?? r.body).id;
  });
  test('update', async () => {
    const r = await hit('PUT', `/api/catalog/groups/${gid}`, { color: '#ef4444' });
    assert.equal(r.status, 200);
  });
  test('delete', async () => {
    const r = await hit('DELETE', `/api/catalog/groups/${gid}`);
    assert.ok([200, 204].includes(r.status));
    await prisma.productGroup.delete({ where: { id: gid } }).catch(() => {});
  });
});

/* ─────────────────────────  LABEL QUEUE  ───────────────────────── */
describe('Label Queue', () => {
  test('list pending', async () => {
    const r = await hit('GET', '/api/label-queue?status=pending');
    assert.equal(r.status, 200);
    const list = r.body.items ?? r.body.data ?? r.body.labels ?? r.body;
    assert.ok(Array.isArray(list), 'expected array, got keys: ' + Object.keys(r.body));
  });
  test('count badge', async () => {
    const r = await hit('GET', '/api/label-queue/count');
    assert.equal(r.status, 200);
    assert.ok(typeof (r.body.count ?? r.body.total ?? r.body) !== 'undefined');
  });
  test('add manual entry', async () => {
    const p = await prisma.masterProduct.findFirst({ where: { orgId: ORG, active: true } });
    const r = await hit('POST', '/api/label-queue/add', {
      productIds: [p.id],
      reason: 'manual',
    });
    assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  });
});

/* ─────────────────────────  VENDORS  ───────────────────────── */
describe('Vendors CRUD', () => {
  let vid = null;
  test('list', async () => {
    const r = await hit('GET', '/api/catalog/vendors');
    assert.equal(r.status, 200);
    const list = r.body.data ?? r.body;
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 5, `expected >=5 vendors, got ${list.length}`);
  });
  test('create', async () => {
    const r = await hit('POST', '/api/catalog/vendors', {
      name: `Test Vendor ${Date.now()}`,
      code: `TEST${Date.now().toString().slice(-4)}`,
      email: 'test@vendor.example.com',
      phone: '+12075559000',
      terms: 'Net 30',
      leadTimeDays: 3,
      active: true,
    });
    assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
    vid = (r.body.data ?? r.body).id;
  });
  test('get by id', async () => {
    const r = await hit('GET', `/api/catalog/vendors/${vid}`);
    assert.equal(r.status, 200);
  });
  test('update', async () => {
    const r = await hit('PUT', `/api/catalog/vendors/${vid}`, { leadTimeDays: 5 });
    assert.equal(r.status, 200);
  });
  test('delete (soft)', async () => {
    const r = await hit('DELETE', `/api/catalog/vendors/${vid}`);
    assert.ok([200, 204].includes(r.status));
    await prisma.vendor.delete({ where: { id: vid } }).catch(() => {});
  });
});

/* ─────────────────────────  VENDOR PAYMENTS  ───────────────────────── */
describe('Vendor Payments CRUD', () => {
  let payId = null;
  test('list', async () => {
    const r = await hit('GET', '/api/catalog/vendor-payments');
    assert.equal(r.status, 200);
    const list = r.body.data ?? r.body.payments ?? r.body;
    assert.ok(Array.isArray(list));
  });
  test('create', async () => {
    const v = await prisma.vendor.findFirst({ where: { orgId: ORG } });
    const r = await hit('POST', '/api/catalog/vendor-payments', {
      vendorId: v.id,
      vendorName: v.name,
      amount: 199.99,
      paymentType: 'expense',
      tenderMethod: 'cash',
      notes: 'CRUD test payment',
    });
    assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
    payId = (r.body.data ?? r.body).id;
  });
  test('update', async () => {
    const r = await hit('PUT', `/api/catalog/vendor-payments/${payId}`, { notes: 'updated' });
    assert.equal(r.status, 200);
  });
});

/* ─────────────────────────  PURCHASE ORDERS  ───────────────────────── */
describe('Purchase Orders', () => {
  test('list', async () => {
    const r = await hit('GET', '/api/vendor-orders/purchase-orders');
    assert.equal(r.status, 200);
    const list = r.body.orders ?? r.body.data ?? r.body.purchaseOrders ?? r.body;
    assert.ok(Array.isArray(list), 'expected array, got keys: ' + Object.keys(r.body));
    assert.ok(list.length >= 5, `expected >=5 POs, got ${list.length}`);
  });
  test('get by id', async () => {
    const po = await prisma.purchaseOrder.findFirst({ where: { orgId: ORG }, orderBy: { createdAt: 'desc' } });
    const r = await hit('GET', `/api/vendor-orders/purchase-orders/${po.id}`);
    assert.equal(r.status, 200);
  });
  test('suggestions endpoint responds', async () => {
    const r = await hit('GET', '/api/vendor-orders/suggestions');
    assert.ok([200, 500].includes(r.status)); // 500 is acceptable if weather key is missing
  });
});

/* ─────────────────────────  INVENTORY  ───────────────────────── */
describe('Inventory (StoreProduct)', () => {
  test('stock snapshot exists', async () => {
    const count = await prisma.storeProduct.count({ where: { orgId: ORG, storeId: STORE } });
    assert.ok(count >= 40, `expected >=40 store-product rows, got ${count}`);
  });
});
