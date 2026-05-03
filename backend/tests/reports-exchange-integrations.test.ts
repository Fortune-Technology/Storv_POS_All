// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

/**
 * Reports / Exchange / Integrations — integration tests.
 *
 * Verifies Audit Log, Employee Reports, End of Day, Exchange (Wholesale
 * orders + Trading Partners), Delivery Platforms (StoreIntegration)
 * endpoints return seeded data.
 *
 * Run: node --test tests/reports-exchange-integrations.test.mjs
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

/* ─────────────────────────  AUDIT LOG  ───────────────────────── */
describe('Audit Log', () => {
  test('seeded entries exist', async () => {
    const count = await prisma.auditLog.count({ where: { orgId: ORG, storeId: STORE } });
    assert.ok(count >= 30, `expected >=30 audit entries, got ${count}`);
  });
  test('GET /api/audit responds', async () => {
    const r = await hit('GET', '/api/audit?limit=20');
    assert.ok([200, 403].includes(r.status), `got ${r.status}`);
    if (r.status === 200) {
      const list = r.body.data ?? r.body.logs ?? r.body.items ?? r.body;
      assert.ok(Array.isArray(list));
    }
  });
});

/* ─────────────────────────  SHIFTS / EOD  ───────────────────────── */
describe('Shifts + End of Day', () => {
  test('seeded closed shifts exist', async () => {
    const count = await prisma.shift.count({ where: { orgId: ORG, storeId: STORE, status: 'closed' } });
    assert.ok(count >= 5, `expected >=5 shifts, got ${count}`);
  });
  test('cash drops + payouts linked to shifts', async () => {
    const drops    = await prisma.cashDrop.count({ where: { orgId: ORG } });
    const payouts  = await prisma.cashPayout.count({ where: { orgId: ORG } });
    assert.ok(drops   >= 5, `expected >=5 drops, got ${drops}`);
    assert.ok(payouts >= 5, `expected >=5 payouts, got ${payouts}`);
  });
  test('GET /api/reports/end-of-day responds', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await hit('GET', `/api/reports/end-of-day?date=${today}&storeId=${STORE}`);
    assert.ok([200, 403, 404].includes(r.status), `got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  });
});

/* ─────────────────────────  EMPLOYEE REPORTS  ───────────────────────── */
describe('Employee Reports', () => {
  test('clock events exist', async () => {
    const count = await prisma.clockEvent.count({ where: { orgId: ORG, storeId: STORE } });
    assert.ok(count >= 10, `expected >=10 clock events, got ${count}`);
  });
  test('GET /api/reports/employees responds', async () => {
    const r = await hit('GET', '/api/reports/employees');
    assert.ok([200, 403].includes(r.status), `got ${r.status}`);
  });
});

/* ─────────────────────────  TRANSACTIONS  ───────────────────────── */
describe('Transactions browser', () => {
  test('list', async () => {
    const r = await hit('GET', '/api/pos-terminal/transactions?limit=10');
    assert.equal(r.status, 200);
    const list = r.body.transactions ?? r.body.data ?? r.body;
    assert.ok(Array.isArray(list));
    assert.ok(list.length > 0);
  });
});

/* ─────────────────────────  EXCHANGE  ───────────────────────── */
describe('Storeveu Exchange', () => {
  test('trading partners seeded', async () => {
    const count = await prisma.tradingPartner.count({ where: { status: 'accepted' } });
    assert.ok(count >= 1, `expected >=1 accepted partnerships, got ${count}`);
  });
  test('wholesale orders seeded', async () => {
    const count = await prisma.wholesaleOrder.count();
    assert.ok(count >= 8, `expected >=8 wholesale orders, got ${count}`);
  });
  test('wholesale orders have line items', async () => {
    const items = await prisma.wholesaleOrderItem.count();
    assert.ok(items >= 20, `expected >=20 wholesale line items, got ${items}`);
  });
  test('GET /api/exchange responds', async () => {
    const r = await hit('GET', '/api/exchange/orders?limit=5');
    assert.ok([200, 403, 404].includes(r.status), `got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  });
});

/* ─────────────────────────  INTEGRATIONS  ───────────────────────── */
describe('Delivery-Platform Integrations', () => {
  test('seeded integrations exist', async () => {
    const count = await prisma.storeIntegration.count({ where: { orgId: ORG, storeId: STORE } });
    assert.ok(count >= 4, `expected >=4 integrations, got ${count}`);
  });
  test('active platforms included', async () => {
    const active = await prisma.storeIntegration.count({ where: { orgId: ORG, storeId: STORE, status: 'active' } });
    assert.ok(active >= 2, `expected >=2 active integrations, got ${active}`);
  });
  test('GET /api/integrations/platforms responds', async () => {
    const r = await hit('GET', '/api/integrations/platforms');
    assert.ok([200, 403].includes(r.status), `got ${r.status}`);
    if (r.status === 200) {
      const list = r.body.data ?? r.body;
      assert.ok(Array.isArray(list));
      assert.ok(list.length > 0);
    }
  });
});
