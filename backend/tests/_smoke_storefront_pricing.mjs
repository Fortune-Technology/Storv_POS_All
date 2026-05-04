/**
 * Storefront Pricing — Live HTTP smoke (S71d)
 *
 * Verifies the self-hosted storefront's `pricingConfig` round-trip via the
 * SAME `/integrations/settings/:platform` endpoints as the marketplace work,
 * with platform='storefront'. Self-cleans the StoreIntegration row at the end.
 *
 * Pre-reqs:
 *   • Backend dev server on localhost:5000
 *   • Audit Stage 1 already run (uses the same admin user + store)
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';

const p = new PrismaClient();
const F = JSON.parse(fs.readFileSync('audit-fixtures.json', 'utf8'));

const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_to_a_long_random_secret';
const PLATFORM = 'storefront';

console.log('=== STOREFRONT PRICING SMOKE — S71d ===\n');

// Audit admin (same as audit harness)
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

// Make sure the storefront integration doesn't exist before we start (clean slate)
await p.storeIntegration.deleteMany({
  where: { storeId: F.storeId, platform: PLATFORM },
});

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

let pass = 0, fail = 0;
const log = (label, ok, detail = '') => {
  const sym = ok ? '✓' : '✗';
  console.log(`  ${sym} ${label}${detail ? '  — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

console.log('\n[1] Lazy auto-init — first GET creates the StoreIntegration row');
{
  const r = await GET(`/integrations/settings/${PLATFORM}`);
  log(`status 200 (auto-created on the fly)`, r.status === 200, `got ${r.status}`);
  log(`pricingConfig present + normalized to defaults`, r.body?.pricingConfig != null);
  log(`storeName = 'Self-hosted storefront'`,
    r.body?.storeName === 'Self-hosted storefront',
    r.body?.storeName);
  log(`status = 'active'`, r.body?.status === 'active');
  log(`markupPercent default = 0`, r.body?.pricingConfig?.markupPercent === 0);
  log(`roundingMode default = 'none'`, r.body?.pricingConfig?.roundingMode === 'none');
  log(`unknownStockBehavior default = 'send_zero'`,
    r.body?.pricingConfig?.unknownStockBehavior === 'send_zero');
}

console.log('\n[2] DB row was actually created');
{
  const row = await p.storeIntegration.findUnique({
    where: { storeId_platform: { storeId: F.storeId, platform: PLATFORM } },
  });
  log(`row exists in DB`, row != null);
  log(`platform = 'storefront'`, row?.platform === PLATFORM);
  log(`credentials = {} (empty — no third-party creds)`,
    JSON.stringify(row?.credentials) === '{}');
}

console.log('\n[3] Round-trip storefront pricingConfig');
{
  const config = {
    markupPercent: 12,
    roundingMode: 'charm_99',
    categoryMarkups: { '143': 18 },     // grocery dept gets a higher markup
    inventorySyncEnabled: true,
    syncMode: 'in_stock_only',
    unknownStockBehavior: 'estimate_from_velocity',
    unknownStockDaysOfCover: 3,
    velocityWindowDays: 21,
    minMarginPercent: 8,
  };
  const put = await PUT(`/integrations/settings/${PLATFORM}`, { pricingConfig: config });
  log(`PUT 200`, put.status === 200, `got ${put.status}`);

  const get = await GET(`/integrations/settings/${PLATFORM}`);
  const pc = get.body?.pricingConfig || {};
  log(`markupPercent persisted`, pc.markupPercent === 12);
  log(`roundingMode persisted`, pc.roundingMode === 'charm_99');
  log(`categoryMarkups persisted`,
    JSON.stringify(pc.categoryMarkups) === JSON.stringify({ '143': 18 }));
  log(`syncMode persisted`, pc.syncMode === 'in_stock_only');
  log(`unknownStockBehavior persisted`, pc.unknownStockBehavior === 'estimate_from_velocity');
  log(`velocityWindowDays persisted`, pc.velocityWindowDays === 21);
  log(`minMarginPercent persisted`, pc.minMarginPercent === 8);
}

console.log('\n[4] Validation reuses the same path as marketplaces (charm_98 invalid)');
{
  const r = await PUT(`/integrations/settings/${PLATFORM}`, {
    pricingConfig: { roundingMode: 'charm_98' },
  });
  log(`status 400`, r.status === 400, `got ${r.status}`);
  log(`error mentions roundingMode`, r.body?.error?.includes('roundingMode') ?? false);
}

console.log('\n[5] Per-dept velocity override on storefront round-trip');
{
  const put = await PUT(`/integrations/settings/${PLATFORM}`, {
    pricingConfig: {
      velocityWindowByDepartment: { '143': 7, '147': 60 },  // produce: 7d, lottery: 60d
    },
  });
  log(`PUT 200`, put.status === 200);
  const get = await GET(`/integrations/settings/${PLATFORM}`);
  const pc = get.body?.pricingConfig || {};
  log(`per-dept windows persisted`,
    JSON.stringify(pc.velocityWindowByDepartment) === JSON.stringify({ '143': 7, '147': 60 }));
}

console.log('\n[6] Second GET does NOT re-create (idempotent)');
{
  const beforeCount = await p.storeIntegration.count({
    where: { storeId: F.storeId, platform: PLATFORM },
  });
  const r = await GET(`/integrations/settings/${PLATFORM}`);
  const afterCount = await p.storeIntegration.count({
    where: { storeId: F.storeId, platform: PLATFORM },
  });
  log(`still exactly 1 row after 2nd GET`,
    beforeCount === 1 && afterCount === 1,
    `before: ${beforeCount}, after: ${afterCount}`);
  log(`returns the same persisted markupPercent (12) — not the default`,
    r.body?.pricingConfig?.markupPercent === 12);
}

// Cleanup
console.log('\n→ Cleaning up test integration');
await p.storeIntegration.deleteMany({
  where: { storeId: F.storeId, platform: PLATFORM },
});

console.log(`\n=== RESULTS ===`);
console.log(`✓ pass: ${pass}`);
console.log(`✗ fail: ${fail}`);
console.log(`total:  ${pass + fail}`);

await p.$disconnect();
process.exit(fail > 0 ? 1 : 0);
