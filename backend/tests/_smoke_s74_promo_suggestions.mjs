/**
 * F28 / S74 smoke — PromoSuggestion CRUD + stub generator + approve→Promotion.
 *
 * Self-cleaning. Creates fixture (1 product expiring tomorrow + 2 dead-stock
 * products) → triggers generator → asserts suggestions created → approves
 * one → verifies real Promotion was created with the right shape.
 */

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const p = new PrismaClient();
const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_to_a_long_random_secret';
const TAG = 'S74-' + Date.now();

const tests = [];
function test(name, ok, detail) {
  tests.push({ name, ok, detail });
  if (ok) console.log(`  ✓ ${name}`);
  else    console.error(`  ✗ ${name}: ${detail}`);
}

console.log('\n=== S74 — Promo Suggestions (Generator + Approve→Promotion) ===\n');

const org = await p.organization.findFirst({
  where: { name: { contains: 'Future Foods' } },
  select: { id: true },
});
const user = await p.user.findFirst({
  where: { orgId: org.id, role: { in: ['owner', 'admin'] }, status: 'active' },
  select: { id: true, email: true },
});
const store = await p.store.findFirst({ where: { orgId: org.id }, select: { id: true } });
const TOKEN = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1h' });
console.log(`User: ${user.email} · org: ${org.id} · store: ${store.id}\n`);

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
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

const cleanup = { products: [], suggestionIds: [], promoIds: [] };

try {
  // ── Fixture: 1 expiring + 2 dead-stock candidates ─────────
  console.log('--- Fixture ---');

  // Wipe any pending S74 stub suggestions older than this run, so the
  // generator's de-dup doesn't skip our new fixture
  await p.promoSuggestion.deleteMany({
    where: { orgId: org.id, generatedBy: 'stub', status: 'pending' },
  });

  const PRODUCTS = [
    { name: `${TAG} Yogurt (expires tomorrow)`, qoh: 5, price: 4.99, expDays: 1 },
    { name: `${TAG} Slow IPA (no sales)`,        qoh: 12, price: 6.5, expDays: null },
    { name: `${TAG} Slow Wine (no sales)`,       qoh: 8, price: 18.99, expDays: null },
  ];

  for (const def of PRODUCTS) {
    const r = await api('POST', '/catalog/products', {
      name: def.name,
      upc: '777' + (Date.now() + cleanup.products.length).toString().slice(-9),
      defaultRetailPrice: def.price,
      defaultCostPrice: def.price * 0.5,
      unitPack: 1, packInCase: 1,
      taxable: true, taxClass: 'grocery',
      active: true, trackInventory: true,
    });
    const id = r.body?.data?.id;
    cleanup.products.push(id);

    const sp = {
      orgId: org.id,
      storeId: store.id,
      masterProductId: id,
      quantityOnHand: def.qoh,
      active: true,
      inStock: true,
    };
    if (def.expDays != null) {
      const d = new Date();
      d.setDate(d.getDate() + def.expDays);
      d.setHours(12, 0, 0, 0);
      sp.expiryDate = d;
      sp.expiryUpdatedAt = new Date();
    }
    await p.storeProduct.upsert({
      where: { storeId_masterProductId: { storeId: store.id, masterProductId: id } },
      create: sp,
      update: sp,
    });
  }
  test('Fixture: 3 products created', cleanup.products.length === 3 && cleanup.products.every(Boolean),
    JSON.stringify(cleanup.products));

  // ── 1. Generator ───────────────────────────────────────
  console.log('\n--- Generator ---');
  const genRes = await api('POST', '/promo-suggestions/generate');
  test('POST /generate → 200',
    genRes.status === 200 && genRes.body?.success,
    JSON.stringify(genRes.body?.error || 'ok'));
  const created = genRes.body?.data || [];
  for (const s of created) cleanup.suggestionIds.push(s.id);
  test('Generated at least 1 suggestion (we have 1 expiring + 2 dead-stock fixtures)',
    created.length >= 1, JSON.stringify({ created: created.length, meta: genRes.body?.meta }));

  // Find our suggestions specifically (filter by TAG in title)
  const ourSuggestions = created.filter(s => s.title?.includes(TAG));
  test('Generator found our fixture products by title',
    ourSuggestions.length >= 1,
    JSON.stringify({ ourCount: ourSuggestions.length, allTitles: created.map(s => s.title) }));

  // Verify shape
  const expiring = ourSuggestions.find(s => s.rationale?.source === 'expiring');
  test('Expiring product → suggestion with rationale.source = expiring',
    !!expiring && expiring.promoType === 'sale' && expiring.proposedConfig?.discountValue > 0,
    JSON.stringify(expiring ? { source: expiring.rationale?.source, discountValue: expiring.proposedConfig?.discountValue } : null));
  test('Expiring suggestion includes citations',
    !!expiring && Array.isArray(expiring.rationale?.citations) && expiring.rationale.citations.length > 0,
    JSON.stringify(expiring?.rationale?.citations));
  test('Expiring suggestion includes estImpact.valueAtRisk',
    !!expiring && typeof expiring.estImpact?.valueAtRisk === 'number',
    JSON.stringify(expiring?.estImpact));

  const deadStock = ourSuggestions.find(s => s.rationale?.source === 'dead_stock');
  test('Dead-stock product → suggestion with rationale.source = dead_stock',
    !!deadStock,
    JSON.stringify(deadStock ? { source: deadStock.rationale?.source, title: deadStock.title } : null));

  // ── 2. List + filter ───────────────────────────────────
  console.log('\n--- List + filter ---');
  const listRes = await api('GET', '/promo-suggestions?status=pending');
  const allPending = listRes.body?.data || [];
  test('GET ?status=pending returns our suggestions',
    allPending.some(s => cleanup.suggestionIds.includes(s.id)),
    JSON.stringify({ pendingCount: allPending.length }));

  // ── 3. Reject one ─────────────────────────────────────
  console.log('\n--- Reject ---');
  const toReject = ourSuggestions[ourSuggestions.length - 1];  // last one
  const rejectRes = await api('POST', `/promo-suggestions/${toReject.id}/reject`, { reason: 'Smoke test reject reason' });
  test('POST /:id/reject → 200',
    rejectRes.status === 200 && rejectRes.body?.data?.status === 'rejected',
    JSON.stringify(rejectRes.body));
  test('Rejected suggestion stores the reason',
    rejectRes.body?.data?.rejectReason === 'Smoke test reject reason',
    JSON.stringify({ rejectReason: rejectRes.body?.data?.rejectReason }));

  // Reject again → should 400 (status no longer pending)
  const doubleReject = await api('POST', `/promo-suggestions/${toReject.id}/reject`, { reason: 'twice' });
  test('Re-rejecting a rejected suggestion → 400',
    doubleReject.status === 400, JSON.stringify(doubleReject.body));

  // ── 4. Approve → creates Promotion ────────────────────
  console.log('\n--- Approve → create Promotion ---');
  const toApprove = ourSuggestions[0];  // first one
  const apprRes = await api('POST', `/promo-suggestions/${toApprove.id}/approve`);
  test('POST /:id/approve → 200',
    apprRes.status === 200 && apprRes.body?.success,
    JSON.stringify(apprRes.body?.error || 'ok'));

  const newPromo = apprRes.body?.data?.promo;
  if (newPromo?.id) cleanup.promoIds.push(newPromo.id);

  test('Approve created a Promotion record',
    !!newPromo?.id && newPromo.name === toApprove.title,
    JSON.stringify({ id: newPromo?.id, name: newPromo?.name }));
  test('Promotion is active',
    newPromo?.active === true,
    JSON.stringify({ active: newPromo?.active }));
  test('Promotion has scope from suggestion',
    Array.isArray(newPromo?.productIds) && newPromo.productIds.length > 0,
    JSON.stringify({ productIds: newPromo?.productIds }));
  test('Suggestion now has status=approved + createdPromoId set',
    apprRes.body?.data?.suggestion?.status === 'approved'
      && apprRes.body.data.suggestion.createdPromoId === newPromo.id,
    JSON.stringify({ status: apprRes.body?.data?.suggestion?.status, link: apprRes.body?.data?.suggestion?.createdPromoId }));

  // Re-approve → 400 (already approved)
  const doubleApprove = await api('POST', `/promo-suggestions/${toApprove.id}/approve`);
  test('Re-approving an approved suggestion → 400',
    doubleApprove.status === 400, JSON.stringify(doubleApprove.body));

  // ── 5. Verify promo is queryable like any other ───────
  const listPromos = await api('GET', '/catalog/promotions?active=true');
  const promosArr = Array.isArray(listPromos.body) ? listPromos.body : (listPromos.body?.data || []);
  const ourPromo = promosArr.find(p => p.id === newPromo.id);
  test('Created promo appears in active promotions list',
    !!ourPromo, JSON.stringify({ id: newPromo.id, count: promosArr.length }));

  // ── 6. Dismiss — find a still-pending ourSuggestion (skip already-handled ones)
  console.log('\n--- Dismiss ---');
  const stillPending = await api('GET', '/promo-suggestions?status=pending');
  const ourPending = (stillPending.body?.data || [])
    .filter(s => cleanup.suggestionIds.includes(s.id) && s.id !== toApprove.id && s.id !== toReject.id);
  if (ourPending.length > 0) {
    const toDismiss = ourPending[0];
    const dismRes = await api('POST', `/promo-suggestions/${toDismiss.id}/dismiss`);
    test('POST /:id/dismiss → 200 with status=dismissed',
      dismRes.status === 200 && dismRes.body?.data?.status === 'dismissed',
      JSON.stringify(dismRes.body));
  } else {
    // Generator only made 2 ours and we already approved+rejected them — fine
    test('Dismiss test skipped (fewer than 3 ourSuggestions to test all 3 outcomes)', true,
      'Generator created only 2 ourSuggestions; both already used in approve+reject');
  }

  // ── 7. Edit (only when pending — should fail on completed) ────
  console.log('\n--- Edit guard ---');
  const editRes = await api('PUT', `/promo-suggestions/${toApprove.id}`, { title: 'Should not change' });
  test('PUT on approved suggestion → 400',
    editRes.status === 400, JSON.stringify(editRes.body));

  // ── 8. Detail endpoint ────────────────────────────────
  const detailRes = await api('GET', `/promo-suggestions/${toApprove.id}`);
  test('GET /:id → 200 with full payload',
    detailRes.status === 200 && detailRes.body?.data?.id === toApprove.id,
    JSON.stringify({ status: detailRes.status }));

} finally {
  console.log('\n--- Cleanup ---');
  try {
    for (const id of cleanup.promoIds) {
      if (id) await p.promotion.delete({ where: { id } }).catch(() => {});
    }
    for (const id of cleanup.suggestionIds) {
      if (id) await p.promoSuggestion.delete({ where: { id } }).catch(() => {});
    }
    for (const id of cleanup.products) {
      if (id) {
        await p.labelQueue.deleteMany({ where: { masterProductId: id } });
        await p.productUpc.deleteMany({ where: { masterProductId: id } });
        await p.storeProduct.deleteMany({ where: { masterProductId: id } });
        await p.masterProduct.delete({ where: { id } }).catch(() => {});
      }
    }
    console.log(`  • Deleted ${cleanup.products.length} product(s), ${cleanup.suggestionIds.length} suggestion(s), ${cleanup.promoIds.length} promo(s)`);
  } catch (err) {
    console.error('  • Cleanup error (ignored):', err.message);
  }
  await p.$disconnect();
}

const passed = tests.filter(t => t.ok).length;
const total = tests.length;
console.log(`\n=== S74 Result: ${passed}/${total} tests passed ===\n`);
process.exit(passed === total ? 0 : 1);
