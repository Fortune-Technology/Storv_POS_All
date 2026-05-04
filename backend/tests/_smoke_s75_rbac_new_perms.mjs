/**
 * S75 RBAC smoke — verify the new permission keys are wired correctly.
 *
 * Tests that:
 *   1. Manager role can hit all new endpoints (has both expiry.* + promo_suggestions.*)
 *   2. Cashier role can hit /catalog/expiry (has expiry.view) but NOT
 *      /catalog/expiry PUT (expiry.edit), and NOT promo-suggestions endpoints
 */

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const p = new PrismaClient();
const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_to_a_long_random_secret';

const tests = [];
function test(name, ok, detail) {
  tests.push({ name, ok, detail });
  if (ok) console.log(`  ✓ ${name}`);
  else    console.error(`  ✗ ${name}: ${detail}`);
}

console.log('\n=== S75 RBAC — New permission keys ===\n');

const org = await p.organization.findFirst({
  where: { name: { contains: 'Future Foods' } },
  select: { id: true },
});
const store = await p.store.findFirst({ where: { orgId: org.id }, select: { id: true } });

const manager = await p.user.findFirst({
  where: { orgId: org.id, role: 'manager', status: 'active' },
  select: { id: true, email: true },
});
const cashier = await p.user.findFirst({
  where: { orgId: org.id, role: 'cashier', status: 'active' },
  select: { id: true, email: true },
});

if (!manager) {
  console.error('No manager user found in dev DB — skipping');
  process.exit(0);
}
if (!cashier) {
  console.error('No cashier user found in dev DB — skipping cashier-side tests');
}

const tokenFor = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '1h' });

async function api(token, method, path, body) {
  const res = await fetch(`${BACKEND}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Store-Id': store.id,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

const mTok = tokenFor(manager.id);
console.log(`Manager: ${manager.email}\n`);

// ─── Manager can call all new endpoints ─────────────────
const r1 = await api(mTok, 'GET', '/catalog/expiry');
test('Manager → GET /catalog/expiry (expiry.view): 200',
  r1.status === 200, JSON.stringify({ status: r1.status, error: r1.body?.error }));

const r2 = await api(mTok, 'GET', '/catalog/expiry/summary');
test('Manager → GET /catalog/expiry/summary (expiry.view): 200',
  r2.status === 200, JSON.stringify({ status: r2.status }));

const r3 = await api(mTok, 'GET', '/promo-suggestions');
test('Manager → GET /promo-suggestions (promo_suggestions.view): 200',
  r3.status === 200, JSON.stringify({ status: r3.status }));

// Cashier-side
if (cashier) {
  const cTok = tokenFor(cashier.id);
  console.log(`\nCashier: ${cashier.email}\n`);

  const c1 = await api(cTok, 'GET', '/catalog/expiry');
  test('Cashier → GET /catalog/expiry (has expiry.view): 200',
    c1.status === 200, JSON.stringify({ status: c1.status, error: c1.body?.error }));

  const c2 = await api(cTok, 'PUT', '/catalog/expiry/99999', {
    expiryDate: new Date().toISOString(),
  });
  // Should 403 — cashier doesn't have expiry.edit. Either 403 OR 404 (productNotFound)
  // would be wrong since 403 must come first. Specifically: 403 = no permission.
  test('Cashier → PUT /catalog/expiry/:id (lacks expiry.edit): 403',
    c2.status === 403, JSON.stringify({ status: c2.status, error: c2.body?.error }));

  const c3 = await api(cTok, 'GET', '/promo-suggestions');
  test('Cashier → GET /promo-suggestions (lacks promo_suggestions.view): 403',
    c3.status === 403, JSON.stringify({ status: c3.status, error: c3.body?.error }));

  const c4 = await api(cTok, 'POST', '/promo-suggestions/generate');
  test('Cashier → POST /promo-suggestions/generate (lacks .generate): 403',
    c4.status === 403, JSON.stringify({ status: c4.status, error: c4.body?.error }));
}

await p.$disconnect();

const passed = tests.filter(t => t.ok).length;
const total = tests.length;
console.log(`\n=== S75 RBAC Result: ${passed}/${total} tests passed ===\n`);
process.exit(passed === total ? 0 : 1);
