/**
 * F5 smoke test — confirms ProductGroup-scoped promotions fire correctly
 * IFF the cart-item shape passed to evaluatePromotions includes productGroupId.
 *
 * Reproduces the bug found in cashier-app/src/screens/POSScreen.jsx:639-646
 * where the items map drops productGroupId before calling the engine.
 */

import { evaluatePromotions } from '../../cashier-app/src/utils/promoEngine.js';

const groupScopedPromo = {
  id: 999,
  name: 'Group sale — $0.50 off any beer',
  promoType: 'sale',
  productIds: [],
  departmentIds: [],
  productGroupIds: [42],   // beer group
  active: true,
  startDate: null,
  endDate: null,
  dealConfig: {
    discountType: 'amount',
    discountValue: 0.5,
    minQty: 1,
  },
};

// Helper to make a fake cart line
function line(opts = {}) {
  return {
    lineId: 'L1',
    productId: 100,
    departmentId: 7,
    productGroupId: 42,    // member of the beer group
    qty: 1,
    unitPrice: 3.99,
    discountEligible: true,
    ...opts,
  };
}

const tests = [];

function expect(name, cond, detail) {
  tests.push({ name, ok: !!cond, detail });
  if (!cond) console.error(`  ✗ ${name}: ${detail}`);
  else console.log(`  ✓ ${name}`);
}

console.log('\n=== F5 Promo Engine Group-Scope Tests ===\n');

// 1. Correct shape (with productGroupId) — group promo SHOULD fire
{
  const items = [line()];
  const result = evaluatePromotions(items, [groupScopedPromo]);
  const adj = result.lineAdjustments.L1;
  expect(
    'Cart-item shape WITH productGroupId — group promo qualifies',
    adj && adj.promoId === 999 && adj.discountValue === 0.5,
    `Got: ${JSON.stringify(adj)}`,
  );
}

// 2. Buggy shape (POSScreen.jsx strips productGroupId) — group promo should NOT fire
{
  const items = [line()].map(i => ({
    lineId: i.lineId,
    productId: i.productId,
    departmentId: i.departmentId,
    qty: i.qty,
    unitPrice: i.unitPrice,
    discountEligible: i.discountEligible,
    // productGroupId intentionally omitted (this is the live POSScreen bug)
  }));
  const result = evaluatePromotions(items, [groupScopedPromo]);
  const adj = result.lineAdjustments.L1;
  expect(
    'Cart-item shape WITHOUT productGroupId — group promo silently misses',
    !adj || adj.promoId !== 999,
    `Got an unexpected adjustment: ${JSON.stringify(adj)}`,
  );
}

// 3. Correct shape but wrong group on the line — no fire
{
  const items = [line({ productGroupId: 99 })];
  const result = evaluatePromotions(items, [groupScopedPromo]);
  const adj = result.lineAdjustments.L1;
  expect(
    'Line has different productGroupId — no qualify',
    !adj || adj.promoId !== 999,
    `Got: ${JSON.stringify(adj)}`,
  );
}

// 4. Mixed scope — promo with both productIds AND productGroupIds, line matches via group
{
  const promo = { ...groupScopedPromo, productIds: [9999], productGroupIds: [42] };
  const items = [line()];
  const result = evaluatePromotions(items, [promo]);
  const adj = result.lineAdjustments.L1;
  expect(
    'Mixed scope (product OR group) — line matches via group',
    adj && adj.promoId === 999,
    `Got: ${JSON.stringify(adj)}`,
  );
}

// 5. Lowest-wins — group promo $0.50 vs product-level $1.00 → product wins
{
  const productLevelPromo = {
    id: 1000,
    name: 'Product sale — $1 off',
    promoType: 'sale',
    productIds: [100],
    departmentIds: [],
    productGroupIds: [],
    active: true,
    startDate: null,
    endDate: null,
    dealConfig: { discountType: 'amount', discountValue: 1.0, minQty: 1 },
  };
  const items = [line()];
  const result = evaluatePromotions(items, [groupScopedPromo, productLevelPromo]);
  const adj = result.lineAdjustments.L1;
  expect(
    'Lowest-wins — competing product promo with bigger saving wins',
    adj && adj.promoId === 1000 && adj.discountValue === 1.0,
    `Got: ${JSON.stringify(adj)}`,
  );
}

// 6. Group-scoped multipack ("3 for $9.99")
{
  const mixMatchPromo = {
    id: 1001,
    name: 'Beer 3-for-$9.99',
    promoType: 'mix_match',
    productIds: [],
    departmentIds: [],
    productGroupIds: [42],
    active: true,
    startDate: null,
    endDate: null,
    dealConfig: { mixQty: 3, mixPrice: 9.99 },
  };
  const items = [line({ qty: 3, unitPrice: 4.0 })];
  const result = evaluatePromotions(items, [mixMatchPromo]);
  const adj = result.lineAdjustments.L1;
  expect(
    'Group-scoped mix_match (3-for-$9.99) — qualifies',
    adj && adj.promoId === 1001,
    `Got: ${JSON.stringify(adj)}`,
  );
}

// ─── S69 (C11c) — minPurchaseAmount gate ─────────────────────────────────
console.log('\n=== minPurchaseAmount gate ===\n');

const minPurchasePromo = {
  id: 2000,
  name: 'Spend $20 on Beer → 10% off',
  promoType: 'sale',
  productIds: [],
  departmentIds: [],
  productGroupIds: [42],
  active: true,
  startDate: null,
  endDate: null,
  dealConfig: {
    discountType: 'percent',
    discountValue: 10,
    minQty: 1,
    minPurchaseAmount: 20.0,
  },
};

// 7. Below threshold — promo skipped
{
  const items = [line({ qty: 3, unitPrice: 4.0 })]; // $12 < $20
  const result = evaluatePromotions(items, [minPurchasePromo]);
  const adj = result.lineAdjustments.L1;
  expect(
    'Below minPurchase threshold — promo skipped',
    !adj || adj.promoId !== 2000,
    `Got an unexpected adjustment: ${JSON.stringify(adj)}`,
  );
}

// 8. Above threshold — promo fires
{
  const items = [line({ qty: 6, unitPrice: 4.0 })]; // $24 > $20
  const result = evaluatePromotions(items, [minPurchasePromo]);
  const adj = result.lineAdjustments.L1;
  expect(
    'Above minPurchase threshold — promo qualifies',
    adj && adj.promoId === 2000 && adj.discountValue === 10,
    `Got: ${JSON.stringify(adj)}`,
  );
}

// 9. Exactly at threshold — promo fires (≥, not >)
{
  const items = [line({ qty: 5, unitPrice: 4.0 })]; // $20 == $20
  const result = evaluatePromotions(items, [minPurchasePromo]);
  const adj = result.lineAdjustments.L1;
  expect(
    'Exactly at minPurchase threshold ($20.00) — promo qualifies',
    adj && adj.promoId === 2000,
    `Got: ${JSON.stringify(adj)}`,
  );
}

// 10. Subtotal counts only QUALIFYING lines, not whole cart
{
  // Beer (qualifies, $12) + Snacks (out of group scope, $30) — only the $12
  // Beer subtotal counts toward the $20 minimum, so promo should NOT fire.
  const items = [
    line({ qty: 3, unitPrice: 4.0 }),  // Beer  — productGroupId=42
    line({ lineId: 'L2', productId: 200, productGroupId: 99, qty: 3, unitPrice: 10.0 }), // Snacks — wrong group
  ];
  const result = evaluatePromotions(items, [minPurchasePromo]);
  const adj = result.lineAdjustments.L1;
  expect(
    'minPurchase counts qualifying-line subtotal only — out-of-scope items ignored',
    !adj || adj.promoId !== 2000,
    `Got: ${JSON.stringify(adj)}`,
  );
}

// 11. Zero / null minPurchaseAmount — no gate (back-compat with old promos)
{
  const noMinPromo = {
    ...minPurchasePromo,
    id: 2001,
    dealConfig: { discountType: 'percent', discountValue: 10, minQty: 1 },
    // no minPurchaseAmount at all
  };
  const items = [line({ qty: 1, unitPrice: 1.0 })]; // $1
  const result = evaluatePromotions(items, [noMinPromo]);
  const adj = result.lineAdjustments.L1;
  expect(
    'No minPurchaseAmount field — promo always fires (back-compat)',
    adj && adj.promoId === 2001,
    `Got: ${JSON.stringify(adj)}`,
  );
}

const passed = tests.filter(t => t.ok).length;
const total = tests.length;
console.log(`\nPromo Engine: ${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
