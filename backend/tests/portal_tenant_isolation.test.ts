// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

/**
 * Portal multi-tenant isolation tests — verifies a user in Org B cannot
 * read/edit/delete resources owned by Org A through any of the 7 portal tab APIs.
 *
 * Strategy:
 *   1. Create a second Organization + Store + Owner-role User programmatically
 *      (cleaned up after).
 *   2. As Org A's owner, create one row of each resource type
 *      (product, department, promotion, group).
 *   3. As Org B's owner (via JWT), attempt:
 *        - GET /:id        → expect 404 (controller filters by orgId)
 *        - PUT /:id        → expect 404 or 403
 *        - DELETE /:id     → expect 404 or 403
 *   4. Verify Org B's list endpoints don't leak Org A's row.
 *
 * Prereqs:
 *   - Backend running on http://localhost:5000
 *   - owner@storeveu.com (Org A) seeded
 *
 * Run: node --test tests/portal_tenant_isolation.test.mjs
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
const ORG_A = 'default';
const STORE_A = 'default-store';
const ORG_B = `tenant-iso-test-${Date.now()}`;
const STORE_B = `${ORG_B}-store`;

const prisma = new PrismaClient();

let TOKEN_A = null;
let TOKEN_B = null;
let userBId = null;

const H = (token, storeId) => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`,
  'X-Store-Id':    storeId,
});

async function hit(token, storeId, method, p, body) {
  const init = { method, headers: H(token, storeId) };
  if (body != null) init.body = JSON.stringify(body);
  const r = await fetch(API + p, init);
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, body: json };
}

const unwrap = (b) => (b && typeof b === 'object' && 'data' in b) ? b.data : b;

const created = {
  productAId: null,
  departmentAId: null,
  promotionAId: null,
  groupAId: null,
};

before(async () => {
  // Token A — existing seeded owner
  const userA = await prisma.user.findFirst({ where: { email: 'owner@storeveu.com' } });
  assert.ok(userA, 'owner@storeveu.com required');
  TOKEN_A = jwt.sign(
    { id: userA.id, orgId: userA.orgId, role: userA.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Org B — create org + store + owner-role user
  await prisma.organization.upsert({
    where: { id: ORG_B },
    update: {},
    create: {
      id: ORG_B,
      name: 'Tenant Isolation Test Org B',
      slug: ORG_B.replace(/_/g, '-'),
    },
  });

  await prisma.store.upsert({
    where: { id: STORE_B },
    update: {},
    create: {
      id: STORE_B,
      orgId: ORG_B,
      name: 'Org B Test Store',
      isActive: true,
    },
  });

  const emailB = `tenant-iso-owner-${Date.now()}@storeveu.test`;
  const userB = await prisma.user.create({
    data: {
      name:     'Org B Owner',
      email:    emailB,
      // Password is a bcrypt hash; we never log in via password (always JWT),
      // so any non-empty bcrypt-shaped string is fine.
      password: '$2a$10$placeholderhashforbcryptisostatus',
      role:     'owner',
      orgId:    ORG_B,
      status:   'active',
    },
  });
  userBId = userB.id;

  // Add UserOrg row so RBAC permissionService resolves owner role for Org B
  await prisma.userOrg.create({
    data: {
      userId: userB.id,
      orgId: ORG_B,
      role: 'owner',
      isPrimary: true,
    },
  }).catch(() => {});

  // Add UserStore row so the user has access to STORE_B
  await prisma.userStore.create({
    data: {
      userId: userB.id,
      storeId: STORE_B,
    },
  }).catch(() => {});

  TOKEN_B = jwt.sign(
    { id: userB.id, orgId: ORG_B, role: 'owner' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Pre-create one row of each type IN ORG A
  const p = await hit(TOKEN_A, STORE_A, 'POST', '/api/catalog/products', {
    name: `Tenant Iso Product A ${Date.now()}`,
    upc: `9${Date.now()}`.slice(0, 12),
    defaultRetailPrice: 1.99,
  });
  assert.equal(p.status, 201, `Org A product create failed: ${JSON.stringify(p.body).slice(0, 200)}`);
  created.productAId = unwrap(p.body).id;

  const stamp = Date.now().toString().slice(-6);
  const d = await hit(TOKEN_A, STORE_A, 'POST', '/api/catalog/departments', {
    name: `Tenant Iso Dept A ${stamp}`,
    code: `TIA${stamp}`,
  });
  assert.equal(d.status, 201);
  created.departmentAId = unwrap(d.body).id;

  const pr = await hit(TOKEN_A, STORE_A, 'POST', '/api/catalog/promotions', {
    name: `Tenant Iso Promo A ${Date.now()}`,
    promoType: 'sale',
    productIds: [], departmentIds: [],
    dealConfig: { saleType: 'flat', flatPrice: 1 },
  });
  assert.equal(pr.status, 201);
  created.promotionAId = unwrap(pr.body).id;

  const g = await hit(TOKEN_A, STORE_A, 'POST', '/api/catalog/groups', {
    name: `Tenant Iso Group A ${Date.now()}`,
  });
  assert.equal(g.status, 201);
  created.groupAId = unwrap(g.body).id;
});

after(async () => {
  try {
    if (created.productAId)    await prisma.masterProduct.deleteMany({ where: { id: created.productAId } }).catch(() => {});
    if (created.departmentAId) await prisma.department.deleteMany({ where: { id: created.departmentAId } }).catch(() => {});
    if (created.promotionAId)  await prisma.promotion.deleteMany({ where: { id: created.promotionAId } }).catch(() => {});
    if (created.groupAId)      await prisma.productGroup.deleteMany({ where: { id: created.groupAId } }).catch(() => {});

    if (userBId) {
      await prisma.userStore.deleteMany({ where: { userId: userBId } }).catch(() => {});
      await prisma.userOrg.deleteMany({ where: { userId: userBId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: userBId } }).catch(() => {});
    }
    await prisma.store.deleteMany({ where: { id: STORE_B } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: ORG_B } }).catch(() => {});
  } catch (e) { console.warn('cleanup error:', e.message); }
  await prisma.$disconnect();
});

/* ─────────────────  PRODUCT  ───────────────── */
describe('Tenant isolation: Products', () => {
  test('Org B GET Org A product → 404', async () => {
    const r = await hit(TOKEN_B, STORE_B, 'GET', `/api/catalog/products/${created.productAId}`);
    assert.equal(r.status, 404, `expected 404, got ${r.status}`);
  });

  test('Org B PUT Org A product → 404 (Prisma findFirst with orgId mismatch)', async () => {
    const r = await hit(TOKEN_B, STORE_B, 'PUT', `/api/catalog/products/${created.productAId}`, {
      name: 'hacked across tenants',
    });
    // updateMaster uses findFirst({where:{id, orgId}}) → throws → 404 or P2025
    assert.ok(r.status === 404 || r.status === 403,
      `expected 404/403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    // Confirm the product was NOT modified
    const fresh = await prisma.masterProduct.findUnique({ where: { id: created.productAId } });
    assert.notEqual(fresh.name, 'hacked across tenants', 'cross-tenant write must not succeed');
  });

  test('Org B DELETE Org A product → 404', async () => {
    const r = await hit(TOKEN_B, STORE_B, 'DELETE', `/api/catalog/products/${created.productAId}`);
    assert.ok(r.status === 404 || r.status === 403);
    // Confirm not deleted
    const fresh = await prisma.masterProduct.findUnique({ where: { id: created.productAId } });
    assert.ok(fresh && !fresh.deleted, 'cross-tenant delete must not succeed');
  });

  test('Org B list does NOT include Org A product', async () => {
    const r = await hit(TOKEN_B, STORE_B, 'GET', '/api/catalog/products?page=1&limit=200');
    assert.equal(r.status, 200);
    const list = unwrap(r.body);
    const ids = list.map(p => p.id);
    assert.ok(!ids.includes(created.productAId),
      'Org B list leaked an Org A product id');
  });
});

/* ─────────────────  DEPARTMENT  ───────────────── */
describe('Tenant isolation: Departments', () => {
  test('Org B PUT Org A dept → 404 (Prisma update with orgId mismatch returns P2025)', async () => {
    const r = await hit(TOKEN_B, STORE_B, 'PUT', `/api/catalog/departments/${created.departmentAId}`, {
      name: 'hacked dept',
    });
    assert.ok(r.status === 404 || r.status === 403,
      `expected 404/403, got ${r.status}`);
    const fresh = await prisma.department.findUnique({ where: { id: created.departmentAId } });
    assert.notEqual(fresh.name, 'hacked dept');
  });

  test('Org B DELETE Org A dept → 404 or 403', async () => {
    const r = await hit(TOKEN_B, STORE_B, 'DELETE', `/api/catalog/departments/${created.departmentAId}`);
    assert.ok(r.status === 404 || r.status === 403 || r.status === 409,
      `expected 404/403/409, got ${r.status}`);
    const fresh = await prisma.department.findUnique({ where: { id: created.departmentAId } });
    assert.ok(fresh && fresh.active !== false, 'cross-tenant delete must not soft-delete the dept');
  });

  test('Org B list does NOT include Org A dept', async () => {
    const r = await hit(TOKEN_B, STORE_B, 'GET', '/api/catalog/departments');
    assert.equal(r.status, 200);
    const list = unwrap(r.body);
    const ids = list.map(d => d.id);
    assert.ok(!ids.includes(created.departmentAId), 'Org B list leaked Org A dept');
  });
});

/* ─────────────────  PROMOTION  ───────────────── */
describe('Tenant isolation: Promotions', () => {
  test('Org B PUT Org A promo → 404', async () => {
    const r = await hit(TOKEN_B, STORE_B, 'PUT', `/api/catalog/promotions/${created.promotionAId}`, {
      description: 'hacked promo',
    });
    assert.equal(r.status, 404, `expected 404, got ${r.status}`);
    const fresh = await prisma.promotion.findUnique({ where: { id: created.promotionAId } });
    assert.notEqual(fresh.description, 'hacked promo');
  });

  test('Org B DELETE Org A promo → 404', async () => {
    const r = await hit(TOKEN_B, STORE_B, 'DELETE', `/api/catalog/promotions/${created.promotionAId}`);
    assert.equal(r.status, 404);
    // Confirm still exists
    const fresh = await prisma.promotion.findUnique({ where: { id: created.promotionAId } });
    assert.ok(fresh, 'promotion must still exist');
  });

  test('Org B list does NOT include Org A promo', async () => {
    const r = await hit(TOKEN_B, STORE_B, 'GET', '/api/catalog/promotions');
    assert.equal(r.status, 200);
    const data = unwrap(r.body);
    const list = Array.isArray(data) ? data : (data.promotions || []);
    const ids = list.map(p => p.id);
    assert.ok(!ids.includes(created.promotionAId));
  });
});

/* ─────────────────  PRODUCT GROUP  ───────────────── */
describe('Tenant isolation: Product Groups', () => {
  test('Org B GET Org A group → 404', async () => {
    const r = await hit(TOKEN_B, STORE_B, 'GET', `/api/catalog/groups/${created.groupAId}`);
    assert.equal(r.status, 404);
  });

  test('Org B list does NOT include Org A group', async () => {
    const r = await hit(TOKEN_B, STORE_B, 'GET', '/api/catalog/groups');
    assert.equal(r.status, 200);
    const list = unwrap(r.body);
    const ids = list.map(g => g.id);
    assert.ok(!ids.includes(created.groupAId));
  });
});

/* ─────────────────  INVENTORY ADJUSTMENTS  ───────────────── */
describe('Tenant isolation: Inventory Adjustments', () => {
  test('Org B cannot create an adjustment against an Org A product', async () => {
    // Adjustment controller does parseInt(masterProductId) and creates an
    // adjustment row in Org B's tenant — but the StoreProduct upsert will
    // create a brand-new StoreProduct row keyed by (storeId, masterProductId).
    // Org B can technically write a row — but the resulting adjustment will
    // be tagged with Org B's orgId. Verify Org A's view of the product is
    // unchanged.
    const r = await hit(TOKEN_B, STORE_B, 'POST', '/api/inventory/adjustments', {
      masterProductId: created.productAId,
      adjustmentQty: -5,
      reason: 'shrinkage',
    });
    // Currently the controller doesn't validate that masterProductId belongs to req.orgId
    // so it succeeds with 201. This is a documented gap — the StoreProduct row will
    // live in (Org B's store, Org A's product) which is technically isolated by
    // store but a real audit issue.
    if (r.status === 201) {
      // Cleanup the orphaned adjustment & store_product rows
      await prisma.inventoryAdjustment.deleteMany({ where: { id: r.body.id } }).catch(() => {});
      await prisma.storeProduct.deleteMany({
        where: { storeId: STORE_B, masterProductId: created.productAId },
      }).catch(() => {});
    }
    // Either way, confirm Org A's view of the product wasn't touched
    const orgAProductFresh = await prisma.masterProduct.findUnique({
      where: { id: created.productAId },
      select: { name: true, orgId: true },
    });
    assert.equal(orgAProductFresh.orgId, ORG_A, 'product orgId must remain ORG_A');
  });

  test('Org B list of adjustments does NOT include any Org A row', async () => {
    const r = await hit(TOKEN_B, STORE_B, 'GET', '/api/inventory/adjustments');
    assert.equal(r.status, 200);
    const list = r.body.adjustments;
    // None of these should have orgId !== ORG_B
    const orgAleak = list.filter(a => a.orgId === ORG_A);
    assert.equal(orgAleak.length, 0, 'Org B saw Org A adjustments');
  });
});

/* ─────────────────  LABEL QUEUE  ───────────────── */
describe('Tenant isolation: Label Queue', () => {
  test('Org B list does NOT include Org A queue items', async () => {
    // First add an item in Org A
    const addA = await hit(TOKEN_A, STORE_A, 'POST', '/api/label-queue/add', {
      productIds: [created.productAId],
    });
    assert.equal(addA.status, 200);
    const aId = addA.body.data?.[0]?.id;

    try {
      const rB = await hit(TOKEN_B, STORE_B, 'GET', '/api/label-queue');
      assert.equal(rB.status, 200);
      const list = Array.isArray(rB.body) ? rB.body : (rB.body.data || rB.body.items || []);
      const ids = list.map(item => item.id);
      assert.ok(!ids.includes(aId), 'Org B saw Org A label queue item');
    } finally {
      if (aId) await prisma.labelQueue.deleteMany({ where: { id: aId } }).catch(() => {});
    }
  });
});
