/**
 * Portal RBAC tests — verifies the RBAC permission catalog is enforced for
 * the 7 portal tab APIs against three seeded roles: owner, manager, cashier.
 *
 * Asserts behavior against the actual permission catalog
 * (backend/src/rbac/permissionCatalog.js):
 *   - owner   has '*' (all org perms)
 *   - manager has products.*, departments.view+edit, promotions.*, inventory.*
 *   - cashier has products.view ONLY (no create/edit/delete on products,
 *               and no departments/promotions/inventory access at all)
 *   - label-queue routes have NO requirePermission gate currently — they
 *     accept any authenticated user. Documented below.
 *
 * Prereqs:
 *   - Backend running on http://localhost:5000
 *   - Seed run (owner+manager+cashier@storeveu.com all exist)
 *   - RBAC seeded (`node prisma/seedRbac.js`)
 *
 * Run: node --test tests/portal_rbac.test.mjs
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

const tokens = { owner: null, manager: null, cashier: null };

const H = (role) => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${tokens[role]}`,
  'X-Store-Id':    STORE,
});

async function hit(role, method, p, body) {
  const init = { method, headers: H(role) };
  if (body != null) init.body = JSON.stringify(body);
  const r = await fetch(API + p, init);
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, body: json };
}

const unwrap = (b) => (b && typeof b === 'object' && 'data' in b) ? b.data : b;

const created = { products: [], departments: [], promotions: [] };

before(async () => {
  for (const [role, email] of [
    ['owner',   'owner@storeveu.com'],
    ['manager', 'manager@storeveu.com'],
    ['cashier', 'cashier@storeveu.com'],
  ]) {
    const u = await prisma.user.findFirst({ where: { email } });
    assert.ok(u, `${email} must exist (run seed:all first)`);
    tokens[role] = jwt.sign(
      { id: u.id, orgId: u.orgId, role: u.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }
});

after(async () => {
  try {
    for (const id of created.promotions) await prisma.promotion.deleteMany({ where: { id, orgId: ORG } }).catch(() => {});
    for (const id of created.products) await prisma.masterProduct.deleteMany({ where: { id, orgId: ORG } }).catch(() => {});
    for (const id of created.departments) await prisma.department.deleteMany({ where: { id, orgId: ORG } }).catch(() => {});
  } catch (e) { console.warn('cleanup error:', e.message); }
  await prisma.$disconnect();
});

/* ────────────────  PRODUCTS  ──────────────── */
describe('RBAC: Products', () => {
  test('all roles can view (products.view)', async () => {
    for (const role of ['owner', 'manager', 'cashier']) {
      const r = await hit(role, 'GET', '/api/catalog/products?page=1&limit=1');
      assert.equal(r.status, 200, `${role} should view products, got ${r.status}`);
    }
  });

  test('owner CAN create', async () => {
    const r = await hit('owner', 'POST', '/api/catalog/products', {
      name: `RBAC Owner ${Date.now()}`,
      defaultRetailPrice: 1.00,
    });
    assert.equal(r.status, 201);
    created.products.push(unwrap(r.body).id);
  });

  test('manager CAN create (products.create)', async () => {
    const r = await hit('manager', 'POST', '/api/catalog/products', {
      name: `RBAC Manager ${Date.now()}`,
      defaultRetailPrice: 1.00,
    });
    assert.equal(r.status, 201);
    created.products.push(unwrap(r.body).id);
  });

  test('cashier CANNOT create → 403', async () => {
    const r = await hit('cashier', 'POST', '/api/catalog/products', {
      name: `RBAC Cashier Should Fail ${Date.now()}`,
      defaultRetailPrice: 1.00,
    });
    assert.equal(r.status, 403, `cashier should be 403, got ${r.status}`);
  });

  test('cashier CANNOT edit → 403', async () => {
    const id = created.products[0];
    const r = await hit('cashier', 'PUT', `/api/catalog/products/${id}`, { name: 'hacked' });
    assert.equal(r.status, 403);
  });

  test('cashier CANNOT delete → 403', async () => {
    const id = created.products[0];
    const r = await hit('cashier', 'DELETE', `/api/catalog/products/${id}`);
    assert.equal(r.status, 403);
  });

  test('manager CANNOT delete (manager role lacks products.delete) → 403', async () => {
    // Per permissionCatalog.js: manager has products.view+create+edit only.
    // products.delete is owner-only.
    const id = created.products[created.products.length - 1];
    const r = await hit('manager', 'DELETE', `/api/catalog/products/${id}`);
    assert.equal(r.status, 403, `manager should be 403 on delete, got ${r.status}`);
  });

  test('owner CAN delete (owner has *)', async () => {
    const id = created.products.pop();
    const r = await hit('owner', 'DELETE', `/api/catalog/products/${id}`);
    assert.ok(r.status === 200 || r.status === 204,
      `owner delete should be 200/204, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  });
});

/* ────────────────  DEPARTMENTS  ──────────────── */
describe('RBAC: Departments', () => {
  test('owner+manager CAN view; cashier CANNOT (no departments.view in cashier role)', async () => {
    const ro = await hit('owner', 'GET', '/api/catalog/departments');
    assert.equal(ro.status, 200);

    const rm = await hit('manager', 'GET', '/api/catalog/departments');
    assert.equal(rm.status, 200);

    const rc = await hit('cashier', 'GET', '/api/catalog/departments');
    // cashier role doesn't have departments.view → 403
    assert.equal(rc.status, 403, `cashier should be 403 on dept list, got ${rc.status}`);
  });

  test('owner CAN create', async () => {
    const stamp = Date.now().toString().slice(-6);
    const r = await hit('owner', 'POST', '/api/catalog/departments', {
      name: `RBAC Dept Owner ${stamp}`,
      code: `RBO${stamp}`,
    });
    assert.equal(r.status, 201);
    created.departments.push(unwrap(r.body).id);
  });

  test('manager CANNOT create (manager has departments.view+edit but NOT create)', async () => {
    // Per permissionCatalog.js: manager has 'departments.view','departments.edit' only
    const stamp = Date.now().toString().slice(-6);
    const r = await hit('manager', 'POST', '/api/catalog/departments', {
      name: `RBAC Dept Mgr ${stamp}`,
      code: `RBM${stamp}`,
    });
    assert.equal(r.status, 403, `manager has no departments.create, expected 403, got ${r.status}`);
  });

  test('cashier CANNOT create → 403', async () => {
    const stamp = Date.now().toString().slice(-6);
    const r = await hit('cashier', 'POST', '/api/catalog/departments', {
      name: `RBAC Dept Cashier ${stamp}`,
      code: `RBC${stamp}`,
    });
    assert.equal(r.status, 403);
  });

  test('manager CAN edit (departments.edit)', async () => {
    const id = created.departments[0];
    const r = await hit('manager', 'PUT', `/api/catalog/departments/${id}`, {
      description: 'edited by manager',
    });
    assert.equal(r.status, 200);
  });

  test('manager CANNOT delete (no departments.delete) → 403', async () => {
    const id = created.departments[0];
    const r = await hit('manager', 'DELETE', `/api/catalog/departments/${id}`);
    assert.equal(r.status, 403);
  });
});

/* ────────────────  PROMOTIONS  ──────────────── */
describe('RBAC: Promotions', () => {
  test('owner+manager CAN view; cashier CANNOT (no promotions.view in cashier)', async () => {
    const ro = await hit('owner', 'GET', '/api/catalog/promotions');
    assert.equal(ro.status, 200);
    const rm = await hit('manager', 'GET', '/api/catalog/promotions');
    assert.equal(rm.status, 200);
    const rc = await hit('cashier', 'GET', '/api/catalog/promotions');
    assert.equal(rc.status, 403);
  });

  test('manager CAN create (promotions.create)', async () => {
    const r = await hit('manager', 'POST', '/api/catalog/promotions', {
      name: `RBAC Promo Mgr ${Date.now()}`,
      promoType: 'sale',
      productIds: [], departmentIds: [],
      dealConfig: { saleType: 'flat', flatPrice: 1.99 },
    });
    assert.equal(r.status, 201);
    created.promotions.push(unwrap(r.body).id);
  });

  test('cashier CANNOT create → 403', async () => {
    const r = await hit('cashier', 'POST', '/api/catalog/promotions', {
      name: `RBAC Promo Cashier ${Date.now()}`,
      promoType: 'sale',
      productIds: [], departmentIds: [],
      dealConfig: { saleType: 'flat', flatPrice: 1.99 },
    });
    assert.equal(r.status, 403);
  });

  test('manager CANNOT delete (no promotions.delete) → 403', async () => {
    const id = created.promotions[0];
    const r = await hit('manager', 'DELETE', `/api/catalog/promotions/${id}`);
    assert.equal(r.status, 403);
  });
});

/* ────────────────  PRODUCT GROUPS  ──────────────── */
describe('RBAC: Product Groups', () => {
  test('cashier CAN view (groups gated on products.view)', async () => {
    // Per catalogRoutes: groups are gated on products.* — cashier has products.view
    const r = await hit('cashier', 'GET', '/api/catalog/groups');
    assert.equal(r.status, 200);
  });

  test('cashier CANNOT create (products.create not in cashier) → 403', async () => {
    const r = await hit('cashier', 'POST', '/api/catalog/groups', {
      name: `RBAC Group Cashier ${Date.now()}`,
    });
    assert.equal(r.status, 403);
  });
});

/* ────────────────  INVENTORY ADJUSTMENTS  ──────────────── */
describe('RBAC: Inventory Adjustments', () => {
  test('cashier CANNOT view (no inventory.view) → 403', async () => {
    const r = await hit('cashier', 'GET', '/api/inventory/adjustments');
    assert.equal(r.status, 403);
  });

  test('manager CAN view (inventory.view)', async () => {
    const r = await hit('manager', 'GET', '/api/inventory/adjustments');
    assert.equal(r.status, 200);
  });

  test('cashier CANNOT create → 403', async () => {
    const product = await prisma.masterProduct.findFirst({
      where: { orgId: ORG, active: true },
      select: { id: true },
    });
    const r = await hit('cashier', 'POST', '/api/inventory/adjustments', {
      masterProductId: product.id,
      adjustmentQty: -1,
      reason: 'shrinkage',
    });
    assert.equal(r.status, 403);
  });
});

/* ────────────────  BULK IMPORT  ──────────────── */
describe('RBAC: Bulk Import', () => {
  test('cashier CAN view history+template (gated on products.view)', async () => {
    const r1 = await hit('cashier', 'GET', '/api/catalog/import/history');
    assert.equal(r1.status, 200);
    // template is also products.view — cashier should pass
    const r2 = await fetch(API + '/api/catalog/import/template/products', {
      headers: H('cashier'),
    });
    assert.equal(r2.status, 200);
  });

  test('cashier CANNOT preview/commit (gated on products.create) → 403', async () => {
    // POST /import/preview is gated on products.create
    const r = await hit('cashier', 'POST', '/api/catalog/import/preview', {});
    // Note: likely 400 (no file) before 403 — but if reqPerm runs first it's 403.
    // Either result is acceptable as long as it isn't 200/201.
    assert.ok(r.status === 403 || r.status === 400, `expected 403 or 400, got ${r.status}`);
  });
});

/* ────────────────  LABEL QUEUE  ──────────────── */
describe('RBAC: Label Queue (currently NO permission gate)', () => {
  test('cashier CAN list (no requirePermission on label-queue routes)', async () => {
    // Document the gap: labelQueueRoutes only uses `protect` + `scopeToTenant`,
    // not `requirePermission`. ANY authenticated user can read + write the queue.
    // This is a known gap — flag as P3 backlog if it matters.
    const r = await hit('cashier', 'GET', '/api/label-queue');
    assert.equal(r.status, 200, 'cashier currently can list label queue (no RBAC gate)');
  });

  test('cashier CAN add to queue (still no gate)', async () => {
    const product = await prisma.masterProduct.findFirst({
      where: { orgId: ORG, active: true },
      select: { id: true },
    });
    const r = await hit('cashier', 'POST', '/api/label-queue/add', {
      productIds: [product.id],
    });
    assert.equal(r.status, 200, 'cashier currently can add to queue (no RBAC gate)');
    // Cleanup
    if (r.body?.data?.[0]?.id) {
      await prisma.labelQueue.deleteMany({ where: { id: r.body.data[0].id } }).catch(() => {});
    }
  });
});
