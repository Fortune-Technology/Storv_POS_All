/**
 * F5 HTTP smoke test — exercises the full ProductGroup + Promotion API surface
 * end-to-end against the running backend. Uses an existing org/store/user.
 *
 * Cleans up everything created (group, product, promotion) on success.
 */

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const p = new PrismaClient();

const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_to_a_long_random_secret';

// Test fixture markers — easy cleanup
const TAG = 'F5-SMOKE-' + Date.now();

// ── Test framework ────────────────────────────────────────────────
const tests = [];
function test(name, ok, detail) {
  tests.push({ name, ok, detail });
  if (ok) console.log(`  ✓ ${name}`);
  else    console.error(`  ✗ ${name}: ${detail}`);
}

console.log('\n=== F5 HTTP Smoke Test ===\n');

// ── Setup ──────────────────────────────────────────────────────────
// Prefer an org with a populated catalog (Future Foods)
const org = await p.organization.findFirst({
  where: { name: { contains: 'Future Foods' } },
  select: { id: true, name: true },
}) || await p.organization.findFirst({ select: { id: true, name: true } });
if (!org) throw new Error('No organization in dev DB');

const user = await p.user.findFirst({
  where: { orgId: org.id, role: { in: ['owner', 'admin'] }, status: 'active' },
  select: { id: true, orgId: true, email: true },
});
if (!user) throw new Error(`No active owner/admin in org ${org.name}`);

const store = await p.store.findFirst({ where: { orgId: user.orgId }, select: { id: true } });
if (!store) throw new Error('No store found for org');

const TOKEN = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1h' });
console.log(`Using user [${user.email}] org [${user.orgId}] store [${store.id}]\n`);

async function api(method, path, body) {
  const res = await fetch(`${BACKEND}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'X-Store-Id':  store.id,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

let groupId = null;
let productId = null;
let promoId = null;
let deptId = null;

try {

  // ── Setup: find or create a department for the cascade test ──────────
  const dept = await p.department.findFirst({ where: { orgId: user.orgId, active: true }, select: { id: true } });
  deptId = dept?.id;
  if (!deptId) console.log('  (no department found — cascade test will skip dept field)');

  // ── 1. Create a ProductGroup with full template ──────────────────────
  console.log('--- ProductGroup CRUD + autoSync cascade ---');
  {
    const r = await api('POST', '/catalog/groups', {
      name: `${TAG} Beer Group`,
      description: 'F5 smoke test group',
      color: '#f59e0b',
      departmentId: deptId,
      taxClass: 'alcohol',
      ageRequired: 21,
      ebtEligible: false,
      taxable: true,
      defaultRetailPrice: 4.99,
      defaultCostPrice: 2.50,
      salePrice: 3.99,
      saleStart: '2026-01-01',
      saleEnd:   '2026-12-31',
      autoSync: true,
      active: true,
    });
    test('Create group with template fields', r.status === 201 && r.body?.data?.id, JSON.stringify(r.body));
    groupId = r.body?.data?.id;
  }

  // ── 2. Read it back ──────────────────────────────────────────────────
  {
    const r = await api('GET', `/catalog/groups/${groupId}`);
    const g = r.body?.data;
    test('Read group — defaultRetailPrice = 4.99', g && Number(g.defaultRetailPrice) === 4.99, JSON.stringify(g));
    test('Read group — salePrice = 3.99', g && Number(g.salePrice) === 3.99, JSON.stringify(g));
    test('Read group — taxClass = alcohol', g && g.taxClass === 'alcohol', JSON.stringify(g));
    test('Read group — autoSync = true', g && g.autoSync === true, JSON.stringify(g));
  }

  // ── 3. Create a MasterProduct ────────────────────────────────────────
  {
    const r = await api('POST', '/catalog/products', {
      name: `${TAG} Test Beer`,
      upc: '99999' + Date.now().toString().slice(-7),
      defaultRetailPrice: 9.99,    // intentionally different from group
      defaultCostPrice:   5.00,
      unitPack: 1,
      packInCase: 1,
      taxable: true,
      taxClass: 'grocery',          // intentionally different from group
      ebtEligible: true,             // intentionally different from group
      active: true,
    });
    test('Create product (no group yet)', r.status === 201 && r.body?.data?.id, JSON.stringify(r.body));
    productId = r.body?.data?.id;
  }

  // ── 4. Add product to group with applyTemplate=true ──────────────────
  {
    const r = await api('POST', `/catalog/groups/${groupId}/add-products`, {
      productIds: [productId],
      applyTemplate: true,
    });
    test('Add product to group with applyTemplate=true', r.status === 200 && r.body?.added === 1, JSON.stringify(r.body));
  }

  // ── 5. Verify cascade: product now has group's classification + pricing ─
  {
    const r = await api('GET', `/catalog/products/${productId}`);
    const prod = r.body?.data;
    test('Product cascade — productGroupId set', prod && Number(prod.productGroupId) === groupId, JSON.stringify({ productGroupId: prod?.productGroupId }));
    test('Product cascade — taxClass = alcohol (from group)', prod && prod.taxClass === 'alcohol', JSON.stringify({ taxClass: prod?.taxClass }));
    test('Product cascade — ageRequired = 21', prod && Number(prod.ageRequired) === 21, JSON.stringify({ ageRequired: prod?.ageRequired }));
    test('Product cascade — ebtEligible = false', prod && prod.ebtEligible === false, JSON.stringify({ ebtEligible: prod?.ebtEligible }));
    test('Product cascade — defaultRetailPrice = 4.99', prod && Number(prod.defaultRetailPrice) === 4.99, JSON.stringify({ defaultRetailPrice: prod?.defaultRetailPrice }));
  }

  // ── 6. Update group's retail price → autoSync should cascade ─────────
  {
    const r = await api('PUT', `/catalog/groups/${groupId}`, {
      defaultRetailPrice: 5.99,
    });
    test('Update group price → response.cascaded > 0', r.status === 200 && (r.body?.cascaded ?? 0) >= 1, JSON.stringify(r.body));
  }

  // ── 7. Verify cascade landed on the product ──────────────────────────
  {
    const r = await api('GET', `/catalog/products/${productId}`);
    const prod = r.body?.data;
    test('After cascade — product.defaultRetailPrice = 5.99', prod && Number(prod.defaultRetailPrice) === 5.99, JSON.stringify({ defaultRetailPrice: prod?.defaultRetailPrice }));
  }

  // ── 8. Create a group-scoped promotion ───────────────────────────────
  console.log('\n--- Promotion CRUD with productGroupIds ---');
  {
    const r = await api('POST', '/catalog/promotions', {
      name: `${TAG} Group sale — $0.50 off`,
      promoType: 'sale',
      productIds: [],
      departmentIds: [],
      productGroupIds: [groupId],
      dealConfig: {
        discountType: 'amount',
        discountValue: 0.5,
        minQty: 1,
      },
      badgeLabel: 'BEER!',
      badgeColor: '#f59e0b',
      active: true,
    });
    test('Create group-scoped promo', r.status === 201 && r.body?.data?.id, JSON.stringify(r.body));
    promoId = r.body?.data?.id;
  }

  // ── 9. Verify promo persists productGroupIds ────────────────────────
  {
    const r = await api('GET', `/catalog/promotions`);
    const promos = Array.isArray(r.body) ? r.body : (r.body?.data ?? []);
    const ours = promos.find(p => p.id === promoId);
    test('GET /promotions returns our promo', !!ours, JSON.stringify({ count: promos.length }));
    test('Promo response includes productGroupIds', ours && Array.isArray(ours.productGroupIds) && ours.productGroupIds.includes(groupId),
      JSON.stringify({ productGroupIds: ours?.productGroupIds }));
    test('Promo response includes departmentIds (empty)', ours && Array.isArray(ours.departmentIds), JSON.stringify({ departmentIds: ours?.departmentIds }));
  }

  // ── 10. Verify the cashier-app's catalog snapshot exposes productGroupId on the product
  console.log('\n--- Cashier-side catalog snapshot exposes productGroupId ---');
  {
    const r = await api('GET', '/pos-terminal/catalog/snapshot');
    const snapshot = r.body?.data ?? r.body;
    const products = Array.isArray(snapshot) ? snapshot : (snapshot?.products ?? snapshot?.data ?? []);
    const ours = products.find(p => p.id == productId);
    test('Catalog snapshot includes our product', !!ours, JSON.stringify({ count: products.length, sampleKeys: products[0] ? Object.keys(products[0]) : [] }));
    test('Catalog snapshot product has productGroupId field', ours && Number(ours.productGroupId) === groupId,
      JSON.stringify({ productGroupId: ours?.productGroupId }));
  }

  // ── 11. Verify the promotions snapshot endpoint surfaces productGroupIds ─
  {
    const r = await api('GET', '/catalog/promotions?active=true');
    const promos = Array.isArray(r.body) ? r.body : (r.body?.data ?? []);
    const ours = promos.find(p => p.id === promoId);
    test('Active promotions endpoint includes productGroupIds', ours && Array.isArray(ours.productGroupIds) && ours.productGroupIds.includes(groupId),
      JSON.stringify({ productGroupIds: ours?.productGroupIds }));
  }

  // ── 12. S69 (C11b) — allowMixMatch flag round-trips ──────────────────
  console.log('\n--- S69 (C11b) — allowMixMatch flag ---');
  {
    const r = await api('PUT', `/catalog/groups/${groupId}`, { allowMixMatch: false });
    test('Set allowMixMatch=false → 200', r.status === 200 && r.body?.data?.allowMixMatch === false, JSON.stringify(r.body));
  }

  // ── 13. Creating a mix_match promo against an allowMixMatch=false group → 400 ─
  let blockedPromoId = null;
  {
    const r = await api('POST', '/catalog/promotions', {
      name: `${TAG} mix-match should fail`,
      promoType: 'mix_match',
      productGroupIds: [groupId],
      dealConfig: { groupSize: 3, bundlePrice: 9.99 },
      active: true,
    });
    test('mix_match promo against blocked group → 400', r.status === 400 && /mix-and-match is disabled/i.test(r.body?.error || ''),
      JSON.stringify({ status: r.status, error: r.body?.error }));
    blockedPromoId = r.body?.data?.id || null; // should be null
  }
  if (blockedPromoId) await api('DELETE', `/catalog/promotions/${blockedPromoId}`);

  // ── 14. Non-mix_match promo against same group still allowed ─────────
  let salePromoId = null;
  {
    const r = await api('POST', '/catalog/promotions', {
      name: `${TAG} sale on blocked group`,
      promoType: 'sale',
      productGroupIds: [groupId],
      dealConfig: { discountType: 'percent', discountValue: 10, minQty: 1 },
      active: true,
    });
    test('Sale promo against blocked group → 201 (only mix_match is gated)', r.status === 201 && r.body?.data?.id, JSON.stringify(r.body));
    salePromoId = r.body?.data?.id;
  }

  // ── 15. Re-enable mix-match → 200 ────────────────────────────────────
  {
    const r = await api('PUT', `/catalog/groups/${groupId}`, { allowMixMatch: true });
    test('Re-enable allowMixMatch → 200', r.status === 200 && r.body?.data?.allowMixMatch === true, JSON.stringify(r.body));
  }

  // ── 16. Now mix_match promo IS allowed on the group ──────────────────
  let mixPromoId = null;
  {
    const r = await api('POST', '/catalog/promotions', {
      name: `${TAG} mix-match`,
      promoType: 'mix_match',
      productGroupIds: [groupId],
      dealConfig: { groupSize: 3, bundlePrice: 9.99 },
      active: true,
    });
    test('mix_match promo against re-enabled group → 201', r.status === 201 && r.body?.data?.id, JSON.stringify(r.body));
    mixPromoId = r.body?.data?.id;
  }

  // ── 17. Flipping back to allowMixMatch=false now blocks (active mix_match exists) ─
  {
    const r = await api('PUT', `/catalog/groups/${groupId}`, { allowMixMatch: false });
    test('Flip allowMixMatch→false with active mix_match → 400', r.status === 400 && /Cannot disable mix-and-match/i.test(r.body?.error || ''),
      JSON.stringify({ status: r.status, error: r.body?.error }));
  }

  // ── 18. S69 (C11c) — minPurchaseAmount on dept/group-scoped promos ────
  console.log('\n--- S69 (C11c) — minPurchaseAmount ---');
  let minPurchasePromoId = null;
  {
    const r = await api('POST', '/catalog/promotions', {
      name: `${TAG} $20 min for 10% off`,
      promoType: 'sale',
      productGroupIds: [groupId],
      dealConfig: {
        discountType: 'percent',
        discountValue: 10,
        minQty: 1,
        minPurchaseAmount: 20,
      },
      active: true,
    });
    test('Group-scoped promo with minPurchaseAmount → 201', r.status === 201 && r.body?.data?.id, JSON.stringify(r.body));
    test('Persisted minPurchaseAmount = 20', r.body?.data?.dealConfig?.minPurchaseAmount === 20,
      JSON.stringify({ dealConfig: r.body?.data?.dealConfig }));
    minPurchasePromoId = r.body?.data?.id;
  }

  // ── 19. minPurchaseAmount on a product-only promo → 400 ──────────────
  {
    const r = await api('POST', '/catalog/promotions', {
      name: `${TAG} bad minPurchase`,
      promoType: 'sale',
      productIds: [productId],
      productGroupIds: [],
      departmentIds: [],
      dealConfig: { discountType: 'percent', discountValue: 10, minPurchaseAmount: 5 },
      active: true,
    });
    test('minPurchaseAmount on product-only promo → 400', r.status === 400 && /minPurchaseAmount is only available/i.test(r.body?.error || ''),
      JSON.stringify({ status: r.status, error: r.body?.error }));
  }

  // ── 20. Negative minPurchaseAmount → 400 ─────────────────────────────
  {
    const r = await api('POST', '/catalog/promotions', {
      name: `${TAG} negative min`,
      promoType: 'sale',
      productGroupIds: [groupId],
      dealConfig: { discountType: 'percent', discountValue: 10, minPurchaseAmount: -5 },
      active: true,
    });
    test('Negative minPurchaseAmount → 400', r.status === 400 && /positive number/i.test(r.body?.error || ''),
      JSON.stringify({ status: r.status, error: r.body?.error }));
  }

  // ── Cleanup C11 fixtures ─────────────────────────────────────────────
  if (mixPromoId)          await api('DELETE', `/catalog/promotions/${mixPromoId}`);
  if (salePromoId)         await api('DELETE', `/catalog/promotions/${salePromoId}`);
  if (minPurchasePromoId)  await api('DELETE', `/catalog/promotions/${minPurchasePromoId}`);

} finally {
  // ── Cleanup ──────────────────────────────────────────────────────────
  console.log('\n--- Cleanup ---');
  try {
    if (promoId) await api('DELETE', `/catalog/promotions/${promoId}`).then(() => console.log('  • Deleted promo'));
    if (productId) {
      // Clear FK references before delete (label_queue, product_upcs, etc.)
      await p.labelQueue.deleteMany({ where: { masterProductId: productId } });
      await p.productUpc.deleteMany({ where: { masterProductId: productId } });
      await p.masterProduct.delete({ where: { id: productId } });
      console.log('  • Deleted product');
    }
    if (groupId) await api('DELETE', `/catalog/groups/${groupId}`).then(() => console.log('  • Deleted group'));
  } catch (err) {
    console.error('  • Cleanup error (ignored):', err.message);
  }
  await p.$disconnect();
}

const passed = tests.filter(t => t.ok).length;
const total = tests.length;
console.log(`\nHTTP Smoke: ${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
