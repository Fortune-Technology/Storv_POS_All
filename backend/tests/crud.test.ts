// @ts-nocheck — Phase 4 (April 2026): renamed from .mjs/.js to .ts as part of
//   the tsconfig coverage expansion. Test files are not strict-typed yet —
//   most errors are implicit-any on Prisma fixture rows + describe/it
//   parameters. Strict typing of the test suite is deferred to Phase 5
//   alongside the strict-Prisma typing rollout. Remove this directive when
//   this file gets touched and the errors get cleaned up — they are all
//   mechanical (param annotations, fixture row types).

/**
 * CRUD integration tests — hits the live backend (localhost:5000) with a
 * fresh JWT minted from a seeded user. Covers Customers, Loyalty, Chat,
 * Tasks, Lottery (games/boxes), and Live Dashboard / Lottery Dashboard
 * aggregation endpoints.
 *
 * Prereq: backend running on :5000 AND `npm run seed:all:fast` has been
 * executed against the same DB.
 *
 * Run: node --test tests/crud.test.mjs
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

/* ─────────────────────────  CUSTOMERS  ───────────────────────── */
describe('Customers CRUD', () => {
  let createdId = null;

  test('list paginated', async () => {
    const r = await hit('GET', '/api/customers?page=1&pageSize=5');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.customers));
    assert.ok(r.body.total >= 15);
  });

  test('create', async () => {
    const r = await hit('POST', '/api/customers', {
      firstName: 'Test', lastName: 'User',
      email: `test.user.${Date.now()}@example.com`,
      phone: '+12075559999',
      discount: 0.05, balance: 0, balanceLimit: 100,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(r.body.id);
    createdId = r.body.id;
  });

  test('read by id', async () => {
    const r = await hit('GET', `/api/customers/${createdId}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.firstName, 'Test');
  });

  test('update', async () => {
    const r = await hit('PUT', `/api/customers/${createdId}`, { firstName: 'Updated' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.firstName, 'Updated');
  });

  test('delete (soft)', async () => {
    const r = await hit('DELETE', `/api/customers/${createdId}`);
    assert.ok(r.status === 200 || r.status === 204, `got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  test('search by phone', async () => {
    const r = await hit('GET', '/api/customers?q=+12075551001');
    assert.equal(r.status, 200);
    assert.ok(r.body.customers.length > 0);
  });
});

/* ─────────────────────────  LOYALTY  ───────────────────────── */
describe('Loyalty CRUD', () => {
  let rewardId = null;
  let earnRuleId = null;

  test('get program', async () => {
    const r = await hit('GET', `/api/loyalty/program?storeId=${STORE}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.enabled, true);
    assert.ok(r.body.programName);
  });

  test('update program', async () => {
    const r = await hit('PUT', '/api/loyalty/program', {
      storeId: STORE,
      programName: 'Storeveu Rewards — Updated',
      pointsPerDollar: 2,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.programName, 'Storeveu Rewards — Updated');
  });

  test('list rewards', async () => {
    const r = await hit('GET', `/api/loyalty/rewards?storeId=${STORE}`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.length >= 5);
  });

  test('create reward', async () => {
    const r = await hit('POST', '/api/loyalty/rewards', {
      storeId: STORE,
      name: 'Test $2 Off',
      pointsCost: 200,
      rewardType: 'dollar_off',
      rewardValue: 2,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    rewardId = r.body.id;
  });

  test('update reward', async () => {
    const r = await hit('PUT', `/api/loyalty/rewards/${rewardId}`, { name: 'Test $2 Off Updated' });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'Test $2 Off Updated');
  });

  test('delete reward', async () => {
    const r = await hit('DELETE', `/api/loyalty/rewards/${rewardId}`);
    assert.ok(r.status === 200 || r.status === 204);
  });

  test('list earn rules', async () => {
    const r = await hit('GET', `/api/loyalty/earn-rules?storeId=${STORE}`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.length >= 6);
  });

  test('create earn rule', async () => {
    const depts = await prisma.department.findMany({ where: { orgId: ORG }, take: 1, select: { id: true, name: true } });
    const r = await hit('POST', '/api/loyalty/earn-rules', {
      storeId: STORE,
      targetType: 'department',
      targetId: String(depts[0].id),
      targetName: depts[0].name,
      action: 'multiply',
      multiplier: 1.25,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    earnRuleId = r.body.id;
  });

  test('delete earn rule', async () => {
    const r = await hit('DELETE', `/api/loyalty/earn-rules/${earnRuleId}`);
    assert.ok(r.status === 200 || r.status === 204);
  });
});

/* ─────────────────────────  CHAT  ───────────────────────── */
describe('Chat read + send', () => {
  test('list channels', async () => {
    const r = await hit('GET', '/api/chat/channels');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.channels));
    assert.ok(r.body.channels.length >= 1);
  });

  test('list messages for store channel', async () => {
    const r = await hit('GET', `/api/chat/messages?channelId=store:${STORE}&limit=50`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.messages));
    assert.ok(r.body.messages.length >= 5);
  });

  test('send a message', async () => {
    const r = await hit('POST', '/api/chat/messages', {
      channelId: `store:${STORE}`,
      message: `CRUD test msg ${Date.now()}`,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(r.body.id || r.body.message);
  });

  test('unread count', async () => {
    const r = await hit('GET', '/api/chat/unread');
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.total === 'number' || typeof r.body.count === 'number' || typeof r.body === 'object');
  });
});

/* ─────────────────────────  TASKS  ───────────────────────── */
describe('Tasks CRUD', () => {
  let taskId = null;

  test('list', async () => {
    const r = await hit('GET', '/api/tasks');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.tasks));
    assert.ok(r.body.tasks.length >= 5);
  });

  test('counts', async () => {
    const r = await hit('GET', '/api/tasks/counts');
    assert.equal(r.status, 200);
    assert.ok(typeof r.body === 'object');
  });

  test('create', async () => {
    const r = await hit('POST', '/api/tasks', {
      title: 'CRUD test task',
      description: 'created by crud.test.mjs',
      priority: 'normal',
      category: 'other',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    taskId = r.body.id;
  });

  test('update', async () => {
    const r = await hit('PUT', `/api/tasks/${taskId}`, { status: 'in_progress' });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'in_progress');
  });

  test('delete', async () => {
    const r = await hit('DELETE', `/api/tasks/${taskId}`);
    assert.ok(r.status === 200 || r.status === 204);
  });
});

/* ─────────────────────────  LOTTERY  ───────────────────────── */
describe('Lottery CRUD', () => {
  let gameId = null;

  test('list games', async () => {
    const r = await hit('GET', '/api/lottery/games');
    assert.equal(r.status, 200);
    const games = r.body.data ?? r.body;
    assert.ok(Array.isArray(games));
    assert.ok(games.length >= 10);
  });

  test('create game', async () => {
    const r = await hit('POST', '/api/lottery/games', {
      name: 'CRUD Test Game',
      gameNumber: `9${Date.now().toString().slice(-4)}`,
      ticketPrice: 5,
      ticketsPerBox: 300,
    });
    assert.ok(r.status === 200 || r.status === 201, `got ${r.status}: ${JSON.stringify(r.body)}`);
    gameId = (r.body.data ?? r.body).id;
    assert.ok(gameId);
  });

  test('update game', async () => {
    const r = await hit('PUT', `/api/lottery/games/${gameId}`, { name: 'CRUD Test Game — Updated' });
    assert.equal(r.status, 200);
    assert.equal((r.body.data ?? r.body).name, 'CRUD Test Game — Updated');
  });

  test('delete game', async () => {
    const r = await hit('DELETE', `/api/lottery/games/${gameId}`);
    assert.ok(r.status === 200 || r.status === 204);
  });

  test('list boxes', async () => {
    const r = await hit('GET', '/api/lottery/boxes');
    assert.equal(r.status, 200);
    const boxes = r.body.data ?? r.body;
    assert.ok(Array.isArray(boxes));
  });

  test('dashboard (aggregation)', async () => {
    const r = await hit('GET', '/api/lottery/dashboard');
    assert.equal(r.status, 200);
    const d = r.body.data ?? r.body;
    assert.ok(typeof d.totalSales === 'number');
    assert.ok(typeof d.activeBoxes === 'number');
  });
});

/* ─────────────────────────  LIVE DASHBOARD  ───────────────────────── */
describe('Live Dashboard aggregations', () => {
  test('realtime KPIs', async () => {
    const r = await hit('GET', '/api/sales/realtime');
    assert.equal(r.status, 200);
    assert.ok(r.body.todaySales);
    assert.ok('netSales' in r.body.todaySales);
    assert.ok('txCount' in r.body.todaySales);
    assert.ok(Array.isArray(r.body.hourly));
    assert.equal(r.body.hourly.length, 24);
  });
});
