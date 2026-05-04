/**
 * Marketplace Pricing — Live HTTP smoke (Session 71)
 *
 * Verifies the round-trip + validation of the per-marketplace pricingConfig
 * endpoints against the running backend.
 *
 * Pre-reqs:
 *   • Backend dev server running on localhost:5000
 *   • Audit Stage 1 already run (uses the same admin user + store)
 *
 * Inserts a synthetic StoreIntegration directly via Prisma to bypass the
 * connect() flow (which needs real platform credentials), then exercises
 * the GET/PUT settings endpoints. Cleans up at the end.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';

const p = new PrismaClient();
const F = JSON.parse(fs.readFileSync('audit-fixtures.json', 'utf8'));

const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_to_a_long_random_secret';
const PLATFORM = 'doordash'; // valid adapter — settings endpoints don't need real creds

console.log('=== MARKETPLACE PRICING SMOKE — Session 71 ===\n');

// ── Setup audit admin (same as audit harness) ───────────────────────────
let admin = await p.user.findUnique({ where: { email: 'audit-admin@audit.test' } });
if (!admin) {
  admin = await p.user.create({
    data: {
      name: 'Audit Admin',
      email: 'audit-admin@audit.test',
      password: await bcrypt.hash('Audit@1234!', 10),
      role: 'owner',
      organization: { connect: { id: F.orgId } },
      status: 'active',
    },
  });
  await p.userOrg.create({ data: { userId: admin.id, orgId: F.orgId, role: 'owner', isPrimary: true } });
  await p.userStore.create({ data: { userId: admin.id, storeId: F.storeId } });
}

const TOKEN = jwt.sign({ id: admin.id }, JWT_SECRET, { expiresIn: '2h' });

// ── HTTP helpers ────────────────────────────────────────────────────────
async function GET(path) {
  const r = await fetch(`${BACKEND}/api${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Store-Id': F.storeId },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function PUT(path, body) {
  const r = await fetch(`${BACKEND}/api${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Store-Id': F.storeId, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function POST(path, body) {
  const r = await fetch(`${BACKEND}/api${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Store-Id': F.storeId, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// ── Setup integration row (bypass connect — no real creds needed) ──────
console.log(`→ Upserting test integration (${PLATFORM} for store ${F.storeId})`);
const integration = await p.storeIntegration.upsert({
  where: { storeId_platform: { storeId: F.storeId, platform: PLATFORM } },
  create: {
    orgId: F.orgId, storeId: F.storeId, platform: PLATFORM,
    credentials: { developerId: 'TEST', keyId: 'TEST', signingSecret: 'TEST', storeLocationId: 'TEST' },
    status: 'inactive',
    pricingConfig: {},
  },
  update: { pricingConfig: {} }, // reset for clean test
});
console.log(`  integration id: ${integration.id}`);

// ── Run scenarios ───────────────────────────────────────────────────────
let pass = 0, fail = 0;
const log = (label, ok, detail = '') => {
  const sym = ok ? '✓' : '✗';
  console.log(`  ${sym} ${label}${detail ? '  — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

console.log('\n[1] Default GET — pricingConfig normalized to defaults');
{
  const r = await GET(`/integrations/settings/${PLATFORM}`);
  log(`status 200`, r.status === 200, `got ${r.status}`);
  log(`pricingConfig present`, r.body?.pricingConfig != null);
  log(`markupPercent default = 0`, r.body?.pricingConfig?.markupPercent === 0);
  log(`roundingMode default = 'none'`, r.body?.pricingConfig?.roundingMode === 'none');
  log(`inventorySyncEnabled default = true`, r.body?.pricingConfig?.inventorySyncEnabled === true);
  log(`syncMode default = 'all'`, r.body?.pricingConfig?.syncMode === 'all');
  log(`excludedDepartmentIds default = []`, Array.isArray(r.body?.pricingConfig?.excludedDepartmentIds) && r.body.pricingConfig.excludedDepartmentIds.length === 0);
}

console.log('\n[2] Round-trip — PUT then GET returns same values');
{
  const config = {
    markupPercent: 15,
    roundingMode: 'charm_99',
    categoryMarkups: { '143': 25, '145': 30 },
    inventorySyncEnabled: false,
    syncMode: 'in_stock_only',
    excludedDepartmentIds: ['145'],
    excludedProductIds: ['50369'],
    minMarginPercent: 5,
    taxInclusive: true,
    prepTimeMinutes: 12,
  };
  const put = await PUT(`/integrations/settings/${PLATFORM}`, { pricingConfig: config });
  log(`PUT status 200`, put.status === 200, `got ${put.status}: ${JSON.stringify(put.body)?.slice(0, 100)}`);

  const get = await GET(`/integrations/settings/${PLATFORM}`);
  const pc = get.body?.pricingConfig || {};
  log(`markupPercent persisted`, pc.markupPercent === 15);
  log(`roundingMode persisted`, pc.roundingMode === 'charm_99');
  log(`categoryMarkups persisted`, JSON.stringify(pc.categoryMarkups) === JSON.stringify({ '143': 25, '145': 30 }));
  log(`inventorySyncEnabled = false persisted (not coerced to default)`, pc.inventorySyncEnabled === false);
  log(`syncMode persisted`, pc.syncMode === 'in_stock_only');
  log(`excludedDepartmentIds persisted`, JSON.stringify(pc.excludedDepartmentIds) === JSON.stringify(['145']));
  log(`excludedProductIds persisted`, JSON.stringify(pc.excludedProductIds) === JSON.stringify(['50369']));
  log(`minMarginPercent persisted`, pc.minMarginPercent === 5);
  log(`taxInclusive persisted`, pc.taxInclusive === true);
  log(`prepTimeMinutes persisted`, pc.prepTimeMinutes === 12);
}

console.log('\n[3] Partial update — only updates supplied fields, preserves others');
{
  const put = await PUT(`/integrations/settings/${PLATFORM}`, {
    pricingConfig: { markupPercent: 20 },
  });
  log(`PUT status 200`, put.status === 200);
  const get = await GET(`/integrations/settings/${PLATFORM}`);
  const pc = get.body?.pricingConfig || {};
  log(`markupPercent updated to 20`, pc.markupPercent === 20);
  log(`roundingMode preserved (charm_99)`, pc.roundingMode === 'charm_99');
  log(`categoryMarkups preserved`, JSON.stringify(pc.categoryMarkups) === JSON.stringify({ '143': 25, '145': 30 }));
  log(`inventorySyncEnabled preserved (false)`, pc.inventorySyncEnabled === false);
}

console.log('\n[4] Validation — bad markupPercent (>1000)');
{
  const r = await PUT(`/integrations/settings/${PLATFORM}`, {
    pricingConfig: { markupPercent: 5000 },
  });
  log(`status 400`, r.status === 400, `got ${r.status}`);
  log(`error message mentions markupPercent`, r.body?.error?.includes('markupPercent') ?? false, r.body?.error?.slice(0, 80));
}

console.log('\n[5] Validation — bad roundingMode');
{
  const r = await PUT(`/integrations/settings/${PLATFORM}`, {
    pricingConfig: { roundingMode: 'spaghetti' },
  });
  log(`status 400`, r.status === 400, `got ${r.status}`);
  log(`error message mentions roundingMode`, r.body?.error?.includes('roundingMode') ?? false);
}

console.log('\n[6] Validation — bad syncMode');
{
  const r = await PUT(`/integrations/settings/${PLATFORM}`, {
    pricingConfig: { syncMode: 'random_string' },
  });
  log(`status 400`, r.status === 400, `got ${r.status}`);
}

console.log('\n[7] Validation — bad minMarginPercent (>100)');
{
  const r = await PUT(`/integrations/settings/${PLATFORM}`, {
    pricingConfig: { minMarginPercent: 200 },
  });
  log(`status 400`, r.status === 400, `got ${r.status}`);
}

console.log('\n[8] Validation — bad inventorySyncEnabled type');
{
  const r = await PUT(`/integrations/settings/${PLATFORM}`, {
    pricingConfig: { inventorySyncEnabled: 'yes' },
  });
  log(`status 400`, r.status === 400, `got ${r.status}`);
}

console.log('\n[9] Validation — bad categoryMarkups (not an object)');
{
  const r = await PUT(`/integrations/settings/${PLATFORM}`, {
    pricingConfig: { categoryMarkups: 'not-an-object' },
  });
  log(`status 400`, r.status === 400, `got ${r.status}`);
}

console.log('\n[10] After all the bad attempts, valid state preserved');
{
  const get = await GET(`/integrations/settings/${PLATFORM}`);
  const pc = get.body?.pricingConfig || {};
  log(`markupPercent still 20 (last valid)`, pc.markupPercent === 20);
  log(`roundingMode still charm_99`, pc.roundingMode === 'charm_99');
}

// ── S71b — Preview impact (dry-run) ─────────────────────────────────────
console.log('\n[11] Preview impact — dry-run with stored config');
{
  const r = await POST(`/integrations/preview-impact`, {
    platform: PLATFORM,
    storeId:  F.storeId,
  });
  log(`status 200`, r.status === 200, `got ${r.status}`);
  log(`response has totalActive`, typeof r.body?.totalActive === 'number');
  log(`response has wouldSync`, typeof r.body?.wouldSync === 'number');
  log(`response has skipped totals`, typeof r.body?.skipped?.total === 'number');
  log(`totalActive === wouldSync + skipped.total`,
    r.body?.totalActive === (r.body?.wouldSync || 0) + (r.body?.skipped?.total || 0),
    `${r.body?.totalActive} = ${r.body?.wouldSync} + ${r.body?.skipped?.total}`);
}

console.log('\n[12] Preview impact — override config (excludes a department)');
{
  const r = await POST(`/integrations/preview-impact`, {
    platform: PLATFORM,
    storeId:  F.storeId,
    pricingConfig: {
      markupPercent: 25,
      excludedDepartmentIds: [String(F.departments.tobacco)],
      roundingMode: 'charm_99',
    },
  });
  log(`status 200`, r.status === 200, `got ${r.status}`);
  log(`tobacco products show up as skipped (excluded_department)`,
    (r.body?.skipped?.excludedDepartment || 0) > 0,
    `excluded count: ${r.body?.skipped?.excludedDepartment}`);
  log(`sample items present (first 5)`, Array.isArray(r.body?.sampleItems) && r.body.sampleItems.length > 0);
  if (r.body?.sampleItems?.length > 0) {
    const s = r.body.sampleItems[0];
    log(`sample item has marketPrice > basePrice (markup applied)`, s.marketPrice >= s.basePrice);
  }
}

console.log('\n[13] Preview impact — invalid override returns 400');
{
  const r = await POST(`/integrations/preview-impact`, {
    platform: PLATFORM,
    storeId:  F.storeId,
    pricingConfig: { roundingMode: 'spaghetti' },
  });
  log(`status 400`, r.status === 400, `got ${r.status}`);
}

console.log('\n[14] Analytics endpoint returns pricingByPlatform snapshot');
{
  const r = await fetch(`${BACKEND}/api/integrations/analytics`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Store-Id': F.storeId },
  });
  const body = await r.json().catch(() => null);
  log(`status 200`, r.status === 200, `got ${r.status}`);
  log(`pricingByPlatform present`, body?.pricingByPlatform != null);
  log(`our test integration in snapshot`, body?.pricingByPlatform?.[PLATFORM] != null);
  if (body?.pricingByPlatform?.[PLATFORM]) {
    const snap = body.pricingByPlatform[PLATFORM];
    log(`snapshot has markupPercent`, typeof snap.markupPercent === 'number');
    log(`snapshot has roundingMode`, typeof snap.roundingMode === 'string');
    log(`snapshot has inventorySyncEnabled`, typeof snap.inventorySyncEnabled === 'boolean');
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────────
console.log('\n→ Cleaning up test integration');
await p.storeIntegration.delete({ where: { id: integration.id } }).catch(() => {});

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`✓ pass: ${pass}`);
console.log(`✗ fail: ${fail}`);
console.log(`total:  ${pass + fail}`);

await p.$disconnect();
process.exit(fail > 0 ? 1 : 0);
