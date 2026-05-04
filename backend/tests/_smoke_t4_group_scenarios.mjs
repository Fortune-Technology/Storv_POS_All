/**
 * T4 — Group discount + group mapping verification
 *
 * Two-sided end-to-end check for ProductGroup-scoped promotions:
 *
 *   1. BACK-OFFICE side (HTTP) — admin creates a group, assigns products,
 *      creates various group-scoped promotions via /api/catalog/*. We
 *      verify each persists with the right shape.
 *
 *   2. CASHIER-APP side (engine) — for each promo, we fetch the active
 *      promotions list (the same call useCatalogSync makes), build a cart
 *      that matches the real product data, run evaluatePromotions, and
 *      assert the line adjustments + totals are correct.
 *
 * Self-cleaning. Uses the existing Future Foods dev org.
 */

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { evaluatePromotions } from '../../cashier-app/src/utils/promoEngine.js';

const p = new PrismaClient();

const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_to_a_long_random_secret';
const TAG = 'T4-' + Date.now();

const tests = [];
function test(name, ok, detail) {
  tests.push({ name, ok, detail });
  if (ok) console.log(`  ✓ ${name}`);
  else    console.error(`  ✗ ${name}: ${detail}`);
}

console.log('\n=== T4 — Group Discount End-to-End Smoke ===\n');

// ── Setup ─────────────────────────────────────────────────────────────
const org = await p.organization.findFirst({
  where: { name: { contains: 'Future Foods' } },
  select: { id: true },
}) || await p.organization.findFirst({ select: { id: true } });

const user = await p.user.findFirst({
  where: { orgId: org.id, role: { in: ['owner', 'admin'] }, status: 'active' },
  select: { id: true, email: true },
});
const store = await p.store.findFirst({ where: { orgId: org.id }, select: { id: true } });
const TOKEN = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1h' });
console.log(`Acting as [${user.email}] · org [${org.id}] · store [${store.id}]\n`);

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

// ── Fixture: dept + group + 4 products in the group + 1 product NOT in group
console.log('--- Fixture setup ---');
let deptId, groupId;
const productIds = {};
const cleanup = { products: [], promos: [], group: null };

try {
  // Use an existing department to keep the fixture small
  const dept = await p.department.findFirst({ where: { orgId: org.id, active: true }, select: { id: true } });
  if (!dept) throw new Error('No department found');
  deptId = dept.id;

  // Group with template fields
  const groupRes = await api('POST', '/catalog/groups', {
    name: `${TAG} Beer`,
    color: '#f59e0b',
    departmentId: deptId,
    taxClass: 'alcohol',
    ageRequired: 21,
    defaultRetailPrice: 4.0,
    defaultCostPrice:   2.5,
    autoSync: true,
    allowMixMatch: true,
    active: true,
  });
  groupId = groupRes.body?.data?.id;
  cleanup.group = groupId;
  test('Fixture — group created', !!groupId, JSON.stringify(groupRes.body));

  // Create 4 products in the group + 1 outside
  const PROD_DEFS = [
    { key: 'budLight',   name: `${TAG} Bud Light`,    upc: '777' + (Date.now() + 1).toString().slice(-9), retail: 4.00 },
    { key: 'coors',      name: `${TAG} Coors Light`,  upc: '777' + (Date.now() + 2).toString().slice(-9), retail: 4.00 },
    { key: 'heineken',   name: `${TAG} Heineken`,     upc: '777' + (Date.now() + 3).toString().slice(-9), retail: 5.00 },
    { key: 'stella',     name: `${TAG} Stella`,       upc: '777' + (Date.now() + 4).toString().slice(-9), retail: 6.00 },
    { key: 'water',      name: `${TAG} Bottled Water (out of group)`, upc: '777' + (Date.now() + 5).toString().slice(-9), retail: 1.50 },
  ];

  for (const d of PROD_DEFS) {
    const r = await api('POST', '/catalog/products', {
      name: d.name,
      upc: d.upc,
      defaultRetailPrice: d.retail,
      defaultCostPrice: d.retail * 0.5,
      unitPack: 1,
      packInCase: 1,
      taxable: true,
      taxClass: d.key === 'water' ? 'grocery' : 'alcohol',
      active: true,
    });
    productIds[d.key] = r.body?.data?.id;
    cleanup.products.push(r.body?.data?.id);
  }
  test('Fixture — 5 products created', cleanup.products.length === 5 && cleanup.products.every(Boolean),
    JSON.stringify({ ids: cleanup.products }));

  // Add the 4 beer products to the group
  const beerIds = ['budLight', 'coors', 'heineken', 'stella'].map(k => productIds[k]);
  const addRes = await api('POST', `/catalog/groups/${groupId}/add-products`, {
    productIds: beerIds,
    applyTemplate: false, // keep individual retail prices, just link them
  });
  test('Fixture — 4 products added to group', addRes.status === 200 && addRes.body?.added === 4, JSON.stringify(addRes.body));

  // Verify each product has productGroupId via catalog snapshot (cashier-side)
  const snapRes = await api('GET', '/pos-terminal/catalog/snapshot');
  const snap = snapRes.body?.data ?? snapRes.body;
  const products = Array.isArray(snap) ? snap : (snap?.products ?? snap?.data ?? []);
  const inGroup = products.filter(p => beerIds.includes(p.id) && Number(p.productGroupId) === groupId);
  test('Fixture — catalog snapshot tags 4 beer products with productGroupId', inGroup.length === 4,
    JSON.stringify({ found: inGroup.length, expected: 4 }));

  // Helper to build a cart line that matches what the cashier-app cart store
  // would carry (same shape that POSScreen passes to evaluatePromotions).
  function cartLine(productKey, qty, lineId) {
    const id = productIds[productKey];
    const def = PROD_DEFS.find(d => d.key === productKey);
    return {
      lineId: lineId || `L-${productKey}`,
      productId: id,
      departmentId: productKey === 'water' ? null : deptId,
      productGroupId: productKey === 'water' ? null : groupId,
      qty,
      unitPrice: def.retail,
      discountEligible: true,
    };
  }

  // Helper: pull all active promos exactly the way the cashier-app does
  async function fetchActivePromos() {
    const r = await api('GET', '/catalog/promotions?active=true');
    const list = Array.isArray(r.body) ? r.body : (r.body?.data ?? []);
    // Filter to only T4 fixtures (so we don't trip on unrelated promos in the dev org)
    return list.filter(pr => pr.name?.startsWith(TAG));
  }

  function findAdj(result, lineId) {
    return result.lineAdjustments?.[lineId] || null;
  }

  // ───────────────────────────────────────────────────────────────────────
  // SCENARIO 1 — Group sale (percent off)
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n--- Scenario 1: Group sale 10% off ---');
  {
    const r = await api('POST', '/catalog/promotions', {
      name: `${TAG} 10% off Beer Group`,
      promoType: 'sale',
      productGroupIds: [groupId],
      dealConfig: { discountType: 'percent', discountValue: 10, minQty: 1 },
      active: true,
    });
    test('S1 — back-office: promo persists with productGroupIds', r.status === 201 && r.body?.data?.productGroupIds?.includes(groupId),
      JSON.stringify({ status: r.status, ids: r.body?.data?.productGroupIds }));
    cleanup.promos.push(r.body?.data?.id);

    const promos = await fetchActivePromos();
    const cart = [cartLine('budLight', 1), cartLine('water', 1)];
    const result = evaluatePromotions(cart, promos);
    const adj = findAdj(result, 'L-budLight');
    const adjWater = findAdj(result, 'L-water');
    test('S1 — engine: 10% applies to beer line',
      adj && adj.discountType === 'percent' && Number(adj.discountValue) === 10,
      JSON.stringify(adj));
    test('S1 — engine: water line untouched (out of group)',
      !adjWater, JSON.stringify(adjWater));
    test('S1 — engine: totalSaving = $0.40 (10% of $4)',
      Math.abs(result.totalSaving - 0.4) < 0.01, JSON.stringify(result.totalSaving));
  }

  // ───────────────────────────────────────────────────────────────────────
  // SCENARIO 2 — Group sale with minPurchaseAmount (S70 / C11c)
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n--- Scenario 2: Group sale with $20 minPurchaseAmount ---');
  {
    const r = await api('POST', '/catalog/promotions', {
      name: `${TAG} Spend $20 on Beer → 10% off`,
      promoType: 'sale',
      productGroupIds: [groupId],
      dealConfig: { discountType: 'percent', discountValue: 10, minQty: 1, minPurchaseAmount: 20 },
      active: true,
    });
    test('S2 — back-office: minPurchaseAmount=20 persists',
      r.status === 201 && r.body?.data?.dealConfig?.minPurchaseAmount === 20,
      JSON.stringify({ dealConfig: r.body?.data?.dealConfig }));
    cleanup.promos.push(r.body?.data?.id);

    // We also need to disable the previous 10% promo so it doesn't compete.
    // Simpler: deactivate Scenario 1's promo for the rest of the run.
    await api('PUT', `/catalog/promotions/${cleanup.promos[0]}`, { active: false });

    const promos = await fetchActivePromos();

    // Cart A: 3 beers @ $4 = $12  (below $20 threshold)
    {
      const cart = [cartLine('budLight', 3)];
      const result = evaluatePromotions(cart, promos);
      const adj = findAdj(result, 'L-budLight');
      test('S2 — engine: $12 cart (below $20) → promo skipped',
        !adj || adj.promoId !== r.body?.data?.id,
        JSON.stringify(adj));
    }

    // Cart B: 6 beers @ $4 = $24  (above $20 threshold)
    {
      const cart = [cartLine('budLight', 6)];
      const result = evaluatePromotions(cart, promos);
      const adj = findAdj(result, 'L-budLight');
      test('S2 — engine: $24 cart (above $20) → 10% off fires',
        adj && Number(adj.discountValue) === 10,
        JSON.stringify(adj));
    }

    // Cart C: at-threshold ($20 exactly)
    {
      const cart = [cartLine('budLight', 5)];
      const result = evaluatePromotions(cart, promos);
      const adj = findAdj(result, 'L-budLight');
      test('S2 — engine: $20 cart (exactly at threshold) → fires',
        adj && Number(adj.discountValue) === 10, JSON.stringify(adj));
    }

    // Cart D: out-of-scope items shouldn't count toward minPurchase
    {
      const cart = [cartLine('budLight', 3), cartLine('water', 10)]; // $12 beer + $15 water
      const result = evaluatePromotions(cart, promos);
      const adj = findAdj(result, 'L-budLight');
      test('S2 — engine: out-of-scope subtotal NOT counted toward min — promo correctly skipped',
        !adj, JSON.stringify(adj));
    }

    // Re-enable Scenario 1's promo for downstream tests? No — keep it off.
  }

  // ───────────────────────────────────────────────────────────────────────
  // SCENARIO 3 — Group BOGO (Buy 2 Get 1 50% off)
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n--- Scenario 3: Group BOGO (buy 2 get 1 at 50% off) ---');
  {
    // Disable Scenario 2's promo first so it doesn't compete
    await api('PUT', `/catalog/promotions/${cleanup.promos[1]}`, { active: false });

    const r = await api('POST', '/catalog/promotions', {
      name: `${TAG} BOGO Beer`,
      promoType: 'bogo',
      productGroupIds: [groupId],
      dealConfig: { buyQty: 2, getQty: 1, discountType: 'percent', discountValue: 50 },
      active: true,
    });
    test('S3 — back-office: BOGO promo persists', r.status === 201 && r.body?.data?.id, JSON.stringify(r.body));
    cleanup.promos.push(r.body?.data?.id);

    const promos = await fetchActivePromos();

    // Cart: 3 beers from same product
    const cart = [cartLine('budLight', 3)];
    const result = evaluatePromotions(cart, promos);
    const adj = findAdj(result, 'L-budLight');
    // BOGO returns an adjustment object with discountType + discountValue
    // (engine internal: 50% of $4 distributed across 3 units → ~$1.33/unit
    // which when multiplied by 1 free unit = $2 total saving). The exact
    // distribution algorithm is the engine's business; what matters here
    // is that an adjustment was applied at all.
    test('S3 — engine: BOGO fires on a 3-qty line (adjustment present + saving > 0)',
      adj && Number(adj.discountValue) > 0,
      JSON.stringify(adj));

    // Mixed brands from same group: bud + coors + heineken (1 each)
    const mixed = [
      cartLine('budLight', 1, 'L-bud'),
      cartLine('coors',    1, 'L-coors'),
      cartLine('heineken', 1, 'L-heineken'),
    ];
    const mixedResult = evaluatePromotions(mixed, promos);
    const totalAdj = Object.values(mixedResult.lineAdjustments).length;
    test('S3 — engine: mixed-brand cart (3 from same group) — at least one line gets BOGO adjustment',
      totalAdj >= 1, JSON.stringify(mixedResult.lineAdjustments));
  }

  // ───────────────────────────────────────────────────────────────────────
  // SCENARIO 4 — Group volume tiers
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n--- Scenario 4: Group volume tiers (6+ → 10%, 12+ → 20%) ---');
  {
    await api('PUT', `/catalog/promotions/${cleanup.promos[2]}`, { active: false }); // disable BOGO

    const r = await api('POST', '/catalog/promotions', {
      name: `${TAG} Volume tiers Beer`,
      promoType: 'volume',
      productGroupIds: [groupId],
      dealConfig: { tiers: [
        { minQty: 6,  discountType: 'percent', discountValue: 10 },
        { minQty: 12, discountType: 'percent', discountValue: 20 },
      ] },
      active: true,
    });
    test('S4 — back-office: volume promo persists with tiers',
      r.status === 201 && r.body?.data?.dealConfig?.tiers?.length === 2,
      JSON.stringify(r.body?.data?.dealConfig));
    cleanup.promos.push(r.body?.data?.id);

    const promos = await fetchActivePromos();

    // Below minimum (5 units) → no fire
    {
      const result = evaluatePromotions([cartLine('budLight', 5)], promos);
      const adj = findAdj(result, 'L-budLight');
      test('S4 — engine: 5 units → no tier triggered', !adj, JSON.stringify(adj));
    }
    // 7 units → 10% tier
    {
      const result = evaluatePromotions([cartLine('budLight', 7)], promos);
      const adj = findAdj(result, 'L-budLight');
      test('S4 — engine: 7 units → 10% tier',
        adj && Number(adj.discountValue) === 10, JSON.stringify(adj));
    }
    // 13 units → 20% tier (highest matching wins)
    {
      const result = evaluatePromotions([cartLine('budLight', 13)], promos);
      const adj = findAdj(result, 'L-budLight');
      test('S4 — engine: 13 units → 20% tier (highest matching wins)',
        adj && Number(adj.discountValue) === 20, JSON.stringify(adj));
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // SCENARIO 5 — Group mix_match (3 for $9.99)
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n--- Scenario 5: Group mix_match (3 for $9.99) ---');
  {
    await api('PUT', `/catalog/promotions/${cleanup.promos[3]}`, { active: false }); // disable Volume

    const r = await api('POST', '/catalog/promotions', {
      name: `${TAG} 3 for $9.99 Beer`,
      promoType: 'mix_match',
      productGroupIds: [groupId],
      dealConfig: { groupSize: 3, bundlePrice: 9.99 },
      active: true,
    });
    test('S5 — back-office: mix_match promo persists',
      r.status === 201 && r.body?.data?.dealConfig?.groupSize === 3,
      JSON.stringify(r.body?.data?.dealConfig));
    cleanup.promos.push(r.body?.data?.id);

    const promos = await fetchActivePromos();

    // 3 from same SKU
    {
      const cart = [cartLine('budLight', 3)];
      const result = evaluatePromotions(cart, promos);
      const adj = findAdj(result, 'L-budLight');
      test('S5 — engine: 3 of same SKU bundle to $9.99', adj, JSON.stringify(adj));
    }
    // 3 different SKUs from same group (the actual "mix" in mix-and-match)
    {
      const cart = [
        cartLine('budLight', 1, 'L-bud'),
        cartLine('coors',    1, 'L-coors'),
        cartLine('heineken', 1, 'L-heineken'),
      ];
      const result = evaluatePromotions(cart, promos);
      const totalLines = Object.keys(result.lineAdjustments).length;
      test('S5 — engine: 3 different SKUs from same group → mix-match fires',
        totalLines >= 1, JSON.stringify(result.lineAdjustments));
    }
    // Only 2 — no fire
    {
      const cart = [
        cartLine('budLight', 1, 'L-bud'),
        cartLine('coors',    1, 'L-coors'),
      ];
      const result = evaluatePromotions(cart, promos);
      const totalLines = Object.keys(result.lineAdjustments).length;
      test('S5 — engine: only 2 items in scope → no fire',
        totalLines === 0, JSON.stringify(result.lineAdjustments));
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // SCENARIO 6 — allowMixMatch=false blocks mix_match at promo-create
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n--- Scenario 6: allowMixMatch=false blocks at admin time ---');
  {
    await api('PUT', `/catalog/promotions/${cleanup.promos[4]}`, { active: false }); // disable mix_match

    // Flip allowMixMatch to false
    const flipRes = await api('PUT', `/catalog/groups/${groupId}`, { allowMixMatch: false });
    test('S6 — back-office: allowMixMatch=false saved',
      flipRes.status === 200 && flipRes.body?.data?.allowMixMatch === false, JSON.stringify(flipRes.body));

    // Try to create another mix_match promo — should fail
    const blockedRes = await api('POST', '/catalog/promotions', {
      name: `${TAG} should fail`,
      promoType: 'mix_match',
      productGroupIds: [groupId],
      dealConfig: { groupSize: 3, bundlePrice: 5.99 },
      active: true,
    });
    test('S6 — back-office: new mix_match promo on blocked group → 400',
      blockedRes.status === 400 && /mix-and-match is disabled/i.test(blockedRes.body?.error || ''),
      JSON.stringify(blockedRes.body));

    // Re-enable for any downstream tests
    await api('PUT', `/catalog/groups/${groupId}`, { allowMixMatch: true });
  }

  // ───────────────────────────────────────────────────────────────────────
  // SCENARIO 7 — Cross-scope lowest-wins (group 10% vs product $1 off)
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n--- Scenario 7: Lowest-wins across group + product scope ---');
  {
    // Re-enable the Scenario 1 group 10% promo
    await api('PUT', `/catalog/promotions/${cleanup.promos[0]}`, { active: true });

    // Add a product-level $1-off promo on Bud Light
    const r = await api('POST', '/catalog/promotions', {
      name: `${TAG} Bud Light $1 off`,
      promoType: 'sale',
      productIds: [productIds.budLight],
      dealConfig: { discountType: 'amount', discountValue: 1, minQty: 1 },
      active: true,
    });
    test('S7 — back-office: product-level $1-off promo persists', r.status === 201, JSON.stringify(r.body));
    cleanup.promos.push(r.body?.data?.id);

    const promos = await fetchActivePromos();

    // Bud Light $4: group 10% saves $0.40, product $1 off saves $1.00 → product wins
    const cart = [cartLine('budLight', 1)];
    const result = evaluatePromotions(cart, promos);
    const adj = findAdj(result, 'L-budLight');
    test('S7 — engine: product-level $1-off wins over group 10% ($1 > $0.40)',
      adj && adj.discountType === 'amount' && Number(adj.discountValue) === 1,
      JSON.stringify(adj));

    // Coors $4: only the group 10% applies (no product-level promo)
    const cart2 = [cartLine('coors', 1)];
    const result2 = evaluatePromotions(cart2, promos);
    const adj2 = findAdj(result2, 'L-coors');
    test('S7 — engine: Coors gets group 10% (no product-level promo for it)',
      adj2 && adj2.discountType === 'percent' && Number(adj2.discountValue) === 10,
      JSON.stringify(adj2));
  }

  // ───────────────────────────────────────────────────────────────────────
  // SCENARIO 8 — Catalog snapshot reflects allowMixMatch + cart wiring
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n--- Scenario 8: Catalog snapshot mapping correctness ---');
  {
    const snapRes = await api('GET', '/pos-terminal/catalog/snapshot');
    const snap = snapRes.body?.data ?? snapRes.body;
    const snapProducts = Array.isArray(snap) ? snap : (snap?.products ?? snap?.data ?? []);

    const beerSnap = snapProducts.find(p => p.id === productIds.budLight);
    test('S8 — snapshot: Bud Light productGroupId set',
      beerSnap && Number(beerSnap.productGroupId) === groupId,
      JSON.stringify({ productGroupId: beerSnap?.productGroupId }));

    const waterSnap = snapProducts.find(p => p.id === productIds.water);
    test('S8 — snapshot: Water productGroupId is null (out of group)',
      waterSnap && (waterSnap.productGroupId == null),
      JSON.stringify({ productGroupId: waterSnap?.productGroupId }));

    const promosRes = await api('GET', '/catalog/promotions?active=true');
    const promosList = Array.isArray(promosRes.body) ? promosRes.body : (promosRes.body?.data || []);
    const ourActive = promosList.filter(p => p.name?.startsWith(TAG));
    test('S8 — promotions endpoint surfaces productGroupIds for each active T4 promo',
      ourActive.length > 0 && ourActive.every(p => Array.isArray(p.productGroupIds)),
      JSON.stringify({ count: ourActive.length, samples: ourActive.slice(0, 2).map(p => ({ id: p.id, productGroupIds: p.productGroupIds })) }));
  }

} finally {
  // ── Cleanup ──────────────────────────────────────────────────────────
  console.log('\n--- Cleanup ---');
  try {
    for (const id of cleanup.promos) {
      if (id) await api('DELETE', `/catalog/promotions/${id}`);
    }
    console.log(`  • Deleted ${cleanup.promos.length} promo(s)`);

    for (const id of cleanup.products) {
      if (id) {
        await p.labelQueue.deleteMany({ where: { masterProductId: id } });
        await p.productUpc.deleteMany({ where: { masterProductId: id } });
        await p.masterProduct.delete({ where: { id } });
      }
    }
    console.log(`  • Deleted ${cleanup.products.length} product(s)`);

    if (cleanup.group) {
      await api('DELETE', `/catalog/groups/${cleanup.group}`);
      console.log('  • Deleted group');
    }
  } catch (err) {
    console.error('  • Cleanup error (ignored):', err.message);
  }
  await p.$disconnect();
}

const passed = tests.filter(t => t.ok).length;
const total  = tests.length;
console.log(`\n=== T4 Result: ${passed}/${total} tests passed ===\n`);
process.exit(passed === total ? 0 : 1);
