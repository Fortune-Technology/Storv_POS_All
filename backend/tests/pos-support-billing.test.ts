// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

/**
 * POS Config / Quick Buttons / Rules & Fees / Support / Billing / Invitations
 * integration tests.
 *
 * Run: node --test tests/pos-support-billing.test.mjs
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
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    await fetch(API + '/').catch(() => {});
    clearTimeout(t);
  } catch { process.exit(1); }
  const user = await prisma.user.findFirst({ where: { email: 'owner@storeveu.com' } });
  assert.ok(user, 'owner@storeveu.com must exist (run seed:all first)');
  TOKEN = jwt.sign({ id: user.id, orgId: user.orgId, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
});

after(async () => { await prisma.$disconnect(); });

/* ─────────────────────────  QUICK BUTTONS  ───────────────────────── */
describe('Quick Buttons', () => {
  test('seeded layout exists', async () => {
    const row = await prisma.quickButtonLayout.findUnique({ where: { storeId: STORE } });
    assert.ok(row, 'layout should exist for default-store');
    assert.ok(Array.isArray(row.tree));
    assert.ok(row.tree.length >= 5, `expected >=5 tiles, got ${row.tree.length}`);
  });
  test('GET /api/quick-buttons responds', async () => {
    const r = await hit('GET', `/api/quick-buttons?storeId=${STORE}`);
    assert.ok([200, 403].includes(r.status), `got ${r.status}`);
    if (r.status === 200) {
      const layout = r.body.data ?? r.body;
      assert.ok(layout);
    }
  });
  test('GET /api/quick-buttons/actions returns whitelist', async () => {
    const r = await hit('GET', '/api/quick-buttons/actions');
    assert.equal(r.status, 200);
    const actions = r.body.data ?? r.body.actions ?? r.body;
    assert.ok(Array.isArray(actions));
    assert.ok(actions.length >= 10);
  });
});

/* ─────────────────────────  RULES & FEES  ───────────────────────── */
describe('Rules & Fees', () => {
  test('tax rules seeded', async () => {
    const count = await prisma.taxRule.count({ where: { orgId: ORG } });
    assert.ok(count >= 4, `expected >=4 tax rules, got ${count}`);
  });
  test('deposit rules seeded', async () => {
    const count = await prisma.depositRule.count({ where: { orgId: ORG } });
    assert.ok(count >= 1, `expected >=1 deposit rule, got ${count}`);
  });
  test('GET tax rules endpoint', async () => {
    const r = await hit('GET', '/api/catalog/tax-rules');
    assert.ok([200, 403].includes(r.status));
    if (r.status === 200) {
      const list = r.body.data ?? r.body;
      assert.ok(Array.isArray(list));
    }
  });
});

/* ─────────────────────────  SUPPORT TICKETS  ───────────────────────── */
describe('Support Tickets CRUD', () => {
  let tid = null;
  test('seeded tickets exist', async () => {
    const count = await prisma.supportTicket.count({ where: { orgId: ORG } });
    assert.ok(count >= 5, `expected >=5 tickets, got ${count}`);
  });
  test('GET /api/tickets list', async () => {
    const r = await hit('GET', '/api/tickets');
    assert.equal(r.status, 200);
    const list = r.body.data ?? r.body.tickets ?? r.body;
    assert.ok(Array.isArray(list));
  });
  test('POST create ticket', async () => {
    const r = await hit('POST', '/api/tickets', {
      subject: `CRUD Test Ticket ${Date.now()}`,
      body:    'This is an integration test ticket. Please ignore.',
      priority: 'normal',
    });
    assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
    const t = r.body.data ?? r.body;
    tid = t.id;
    assert.ok(tid);
  });
  test('GET ticket by id', async () => {
    const r = await hit('GET', `/api/tickets/${tid}`);
    assert.equal(r.status, 200);
  });
  test('POST reply to ticket', async () => {
    const r = await hit('POST', `/api/tickets/${tid}/reply`, { message: 'Reply from CRUD test' });
    assert.ok([200, 201].includes(r.status));
  });
});

/* ─────────────────────────  BILLING  ───────────────────────── */
describe('Billing & Plan', () => {
  test('subscription plans seeded globally', async () => {
    const count = await prisma.subscriptionPlan.count();
    assert.ok(count >= 3, `expected >=3 plans, got ${count}`);
  });
  test('org has active subscription', async () => {
    const sub = await prisma.orgSubscription.findUnique({ where: { orgId: ORG } });
    assert.ok(sub, 'expected org subscription');
    assert.equal(sub.status, 'active');
  });
  test('subscription has invoices', async () => {
    const sub = await prisma.orgSubscription.findUnique({ where: { orgId: ORG } });
    const count = await prisma.billingInvoice.count({ where: { subscriptionId: sub.id } });
    assert.ok(count >= 3, `expected >=3 invoices, got ${count}`);
  });
  test('GET /api/billing/plans is public', async () => {
    const r = await fetch(API + '/api/billing/plans');
    assert.equal(r.status, 200);
    const body = await r.json();
    const plans = body.data ?? body;
    assert.ok(Array.isArray(plans) && plans.length >= 3);
  });
  test('GET /api/billing/subscription responds', async () => {
    const r = await hit('GET', '/api/billing/subscription');
    assert.ok([200, 403].includes(r.status));
  });
  test('GET /api/billing/invoices responds', async () => {
    const r = await hit('GET', '/api/billing/invoices');
    assert.ok([200, 403].includes(r.status));
  });
});

/* ─────────────────────────  INVITATIONS  ───────────────────────── */
describe('Invitations', () => {
  test('seeded invitations exist', async () => {
    const count = await prisma.invitation.count({ where: { orgId: ORG } });
    assert.ok(count >= 2, `expected >=2 invitations, got ${count}`);
  });
  test('mix of statuses seeded', async () => {
    const pending = await prisma.invitation.count({ where: { orgId: ORG, status: 'pending' } });
    const accepted = await prisma.invitation.count({ where: { orgId: ORG, status: 'accepted' } });
    assert.ok(pending >= 1, `expected >=1 pending invitations`);
    assert.ok(accepted >= 1, `expected >=1 accepted invitations`);
  });
  test('GET /api/invitations responds', async () => {
    const r = await hit('GET', '/api/invitations');
    assert.ok([200, 403].includes(r.status));
  });
});

/* ─────────────────────────  ROLES & PERMISSIONS  ───────────────────────── */
describe('Roles & Permissions', () => {
  test('system roles seeded', async () => {
    const count = await prisma.role.count({ where: { isSystem: true } });
    assert.ok(count >= 5, `expected >=5 system roles, got ${count}`);
  });
  test('role-permission assignments exist', async () => {
    const count = await prisma.rolePermission.count();
    assert.ok(count >= 100, `expected >=100 role-permission pairs, got ${count}`);
  });
  test('GET /api/roles responds', async () => {
    const r = await hit('GET', '/api/roles');
    assert.ok([200, 403].includes(r.status));
  });
  test('GET /api/roles/permissions returns catalog', async () => {
    const r = await hit('GET', '/api/roles/permissions');
    assert.ok([200, 403].includes(r.status));
    if (r.status === 200) {
      const perms = r.body.data ?? r.body.permissions ?? r.body;
      assert.ok(Array.isArray(perms));
      assert.ok(perms.length >= 100);
    }
  });
});
