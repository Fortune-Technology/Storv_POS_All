/**
 * C7 — Department force-push verification.
 *
 * Creates: dept with taxClass + ageRequired + ebtEligible set, plus 3 products
 * in that dept with DIFFERENT values. Calls POST /catalog/departments/:id/apply.
 * Verifies all 3 products now match the dept's defaults.
 *
 * Self-cleaning.
 */

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const p = new PrismaClient();
const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_to_a_long_random_secret';
const TAG = 'C7-' + Date.now();

const tests = [];
function test(name, ok, detail) {
  tests.push({ name, ok, detail });
  if (ok) console.log(`  ✓ ${name}`);
  else    console.error(`  ✗ ${name}: ${detail}`);
}

console.log('\n=== C7 — Department Force-Push Smoke ===\n');

const org = await p.organization.findFirst({
  where: { name: { contains: 'Future Foods' } },
  select: { id: true },
});
const user = await p.user.findFirst({
  where: { orgId: org.id, role: { in: ['owner', 'admin'] }, status: 'active' },
  select: { id: true },
});
const TOKEN = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1h' });

async function api(method, path, body) {
  const res = await fetch(`${BACKEND}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

const cleanup = { products: [], deptId: null };

try {
  // ── Create dept with full defaults ─────────────────────────────────
  const deptRes = await api('POST', '/catalog/departments', {
    name: `${TAG} Test Dept`,
    code: TAG.replace(/-/g, '').slice(0, 20),
    taxClass: 'alcohol',
    ageRequired: 21,
    ebtEligible: false,
    active: true,
  });
  cleanup.deptId = deptRes.body?.data?.id;
  test('Dept created with defaults', !!cleanup.deptId, JSON.stringify(deptRes.body));

  // ── Create 3 products in dept with DIFFERENT values ────────────────
  const PRODUCT_DEFS = [
    { name: `${TAG} Product A`, taxClass: 'grocery',     ageRequired: null, ebtEligible: true },
    { name: `${TAG} Product B`, taxClass: 'tobacco',     ageRequired: 18,   ebtEligible: true },
    { name: `${TAG} Product C`, taxClass: 'non_taxable', ageRequired: null, ebtEligible: true },
  ];

  for (const d of PRODUCT_DEFS) {
    const r = await api('POST', '/catalog/products', {
      name: d.name,
      upc: '888' + (Date.now() + cleanup.products.length).toString().slice(-9),
      defaultRetailPrice: 5.0,
      defaultCostPrice: 2.5,
      unitPack: 1,
      packInCase: 1,
      departmentId: cleanup.deptId,
      taxable: true,
      taxClass: d.taxClass,
      ageRequired: d.ageRequired,
      ebtEligible: d.ebtEligible,
      active: true,
    });
    cleanup.products.push(r.body?.data?.id);
  }
  test('3 products created in dept', cleanup.products.length === 3 && cleanup.products.every(Boolean),
    JSON.stringify(cleanup.products));

  // ── Pre-cascade snapshot — verify products differ from dept ────────
  const before = await Promise.all(cleanup.products.map(id =>
    api('GET', `/catalog/products/${id}`).then(r => r.body?.data)
  ));
  const allDifferent = before.every(p => p.taxClass !== 'alcohol');
  test('Pre-cascade: products have different taxClass than dept', allDifferent,
    JSON.stringify(before.map(p => ({ id: p.id, taxClass: p.taxClass }))));

  // ── Apply default fields ───────────────────────────────────────────
  const applyRes = await api('POST', `/catalog/departments/${cleanup.deptId}/apply`);
  test('POST /apply → 200 with updated count',
    applyRes.status === 200 && applyRes.body?.updated === 3,
    JSON.stringify(applyRes.body));
  test('POST /apply → fieldsApplied includes taxClass + ageRequired + ebtEligible',
    Array.isArray(applyRes.body?.fieldsApplied)
      && applyRes.body.fieldsApplied.includes('taxClass')
      && applyRes.body.fieldsApplied.includes('ageRequired')
      && applyRes.body.fieldsApplied.includes('ebtEligible'),
    JSON.stringify(applyRes.body?.fieldsApplied));

  // ── Post-cascade — verify all 3 products now match the dept ────────
  const after = await Promise.all(cleanup.products.map(id =>
    api('GET', `/catalog/products/${id}`).then(r => r.body?.data)
  ));
  test('Post-cascade: all products taxClass = alcohol',
    after.every(p => p.taxClass === 'alcohol'),
    JSON.stringify(after.map(p => ({ id: p.id, taxClass: p.taxClass }))));
  test('Post-cascade: all products ageRequired = 21',
    after.every(p => Number(p.ageRequired) === 21),
    JSON.stringify(after.map(p => ({ id: p.id, ageRequired: p.ageRequired }))));
  test('Post-cascade: all products ebtEligible = false',
    after.every(p => p.ebtEligible === false),
    JSON.stringify(after.map(p => ({ id: p.id, ebtEligible: p.ebtEligible }))));

  // ── Selective field application ────────────────────────────────────
  // Reset one product's taxClass + age so we can verify field selection
  await api('PUT', `/catalog/products/${cleanup.products[0]}`, {
    taxClass: 'grocery',
    ageRequired: null,
  });

  const partialRes = await api('POST', `/catalog/departments/${cleanup.deptId}/apply`, {
    fields: ['taxClass'],  // only push taxClass
  });
  test('POST /apply with fields:[taxClass] → only taxClass applied',
    partialRes.body?.fieldsApplied?.length === 1 && partialRes.body.fieldsApplied[0] === 'taxClass',
    JSON.stringify(partialRes.body));

  const post = await api('GET', `/catalog/products/${cleanup.products[0]}`);
  test('Selective: taxClass changed but ageRequired stayed null',
    post.body?.data?.taxClass === 'alcohol' && post.body?.data?.ageRequired == null,
    JSON.stringify({ taxClass: post.body?.data?.taxClass, ageRequired: post.body?.data?.ageRequired }));

  // ── Bad fields validation ──────────────────────────────────────────
  const badRes = await api('POST', `/catalog/departments/${cleanup.deptId}/apply`, {
    fields: ['nonexistent'],
  });
  test('Invalid fields → 400', badRes.status === 400, JSON.stringify(badRes.body));

  // ── 404 on missing dept ─────────────────────────────────────────────
  const missing = await api('POST', '/catalog/departments/99999999/apply');
  test('Missing dept → 404', missing.status === 404, JSON.stringify(missing.body));

} finally {
  console.log('\n--- Cleanup ---');
  try {
    for (const id of cleanup.products) {
      if (id) {
        await p.labelQueue.deleteMany({ where: { masterProductId: id } });
        await p.productUpc.deleteMany({ where: { masterProductId: id } });
        await p.masterProduct.delete({ where: { id } });
      }
    }
    console.log(`  • Deleted ${cleanup.products.length} product(s)`);
    if (cleanup.deptId) {
      await api('DELETE', `/catalog/departments/${cleanup.deptId}?force=true`);
      console.log('  • Deleted dept');
    }
  } catch (err) {
    console.error('  • Cleanup error (ignored):', err.message);
  }
  await p.$disconnect();
}

const passed = tests.filter(t => t.ok).length;
const total = tests.length;
console.log(`\n=== C7 Result: ${passed}/${total} tests passed ===\n`);
process.exit(passed === total ? 0 : 1);
