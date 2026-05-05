/**
 * F32 — Storefront Pricing Transform smoke (pure function level)
 *
 * Verifies the JS port of marketplaceMarkup helpers in
 * ecom-backend/src/utils/marketplaceMarkup.js produces identical results to
 * the canonical TypeScript source. No backend required — pure functions only.
 *
 * Run: cd ecom-backend && node tests/_smoke_storefront_transform.mjs
 */

import {
  computeMarketplacePrice,
  applyMarkup,
  applyRounding,
  isExcluded,
  passesSyncMode,
  computeUnknownStockQty,
  effectiveMarkupPercent,
  effectiveVelocityWindow,
  meetsMarginGuard,
  normalizeConfig,
} from '../src/utils/marketplaceMarkup.js';

let pass = 0, fail = 0;
const log = (label, ok, detail = '') => {
  const sym = ok ? '✓' : '✗';
  console.log(`  ${sym} ${label}${detail ? '  — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

console.log('=== F32 STOREFRONT TRANSFORM SMOKE ===\n');

// ── normalizeConfig ──────────────────────────────────────────────────
console.log('[1] normalizeConfig — empty input gets full defaults');
{
  const c = normalizeConfig({});
  log('markupPercent default 0', c.markupPercent === 0);
  log('roundingMode default "none"', c.roundingMode === 'none');
  log('inventorySyncEnabled default true', c.inventorySyncEnabled === true);
  log('syncMode default "all"', c.syncMode === 'all');
  log('unknownStockBehavior default "send_zero"', c.unknownStockBehavior === 'send_zero');
  log('velocityWindowDays default 14', c.velocityWindowDays === 14);
}

// ── applyMarkup ──────────────────────────────────────────────────────
console.log('\n[2] applyMarkup — base × (1 + pct/100), rounded 2dp');
{
  log('$10 × +15% = $11.50', applyMarkup(10, 15) === 11.5);
  log('$10 × 0% = $10.00', applyMarkup(10, 0) === 10);
  log('$3.99 × 15% = $4.59', applyMarkup(3.99, 15) === 4.59);
  log('$10 × -5% = $9.50', applyMarkup(10, -5) === 9.5);
}

// ── applyRounding ────────────────────────────────────────────────────
console.log('\n[3] applyRounding — six modes');
{
  log('$5.27 none → $5.27', applyRounding(5.27, 'none') === 5.27);
  log('$5.27 nearest_dollar → $5', applyRounding(5.27, 'nearest_dollar') === 5);
  log('$5.55 nearest_dollar → $6', applyRounding(5.55, 'nearest_dollar') === 6);
  log('$5.27 nearest_half → $5.50', applyRounding(5.27, 'nearest_half') === 5.5);
  log('$5.20 nearest_half → $5.00', applyRounding(5.2, 'nearest_half') === 5);
  log('$5.27 charm_99 → $5.99', applyRounding(5.27, 'charm_99') === 5.99);
  log('$6.00 charm_99 → $6.99', applyRounding(6, 'charm_99') === 6.99);
  log('$5.27 charm_95 → $5.95', applyRounding(5.27, 'charm_95') === 5.95);
  log('$5.27 psych_smart → $5.50', applyRounding(5.27, 'psych_smart') === 5.5);
  log('$5.95 psych_smart → $5.99', applyRounding(5.95, 'psych_smart') === 5.99);
}

// ── effectiveMarkupPercent ───────────────────────────────────────────
console.log('\n[4] effectiveMarkupPercent — per-dept beats global');
{
  const r1 = effectiveMarkupPercent(7, { markupPercent: 15 });
  log('global 15 with no dept override returns 15/global', r1.percent === 15 && r1.source === 'global');
  const r2 = effectiveMarkupPercent(7, { markupPercent: 15, categoryMarkups: { '7': 25 } });
  log('global 15 with dept 25 override returns 25/category', r2.percent === 25 && r2.source === 'category');
}

// ── isExcluded ───────────────────────────────────────────────────────
console.log('\n[5] isExcluded');
{
  const r1 = isExcluded(7, 99, { excludedProductIds: [99] });
  log('product 99 excluded → reason "product"', r1.excluded && r1.reason === 'product');
  const r2 = isExcluded(7, 99, { excludedDepartmentIds: [7] });
  log('dept 7 excluded → reason "department"', r2.excluded && r2.reason === 'department');
  const r3 = isExcluded(8, 100, { excludedDepartmentIds: [7], excludedProductIds: [99] });
  log('not excluded when neither matches', !r3.excluded);
}

// ── passesSyncMode ───────────────────────────────────────────────────
console.log('\n[6] passesSyncMode');
{
  log('all + qoh=0 → true', passesSyncMode(0, false, 'all') === true);
  log('in_stock_only + qoh=5 → true', passesSyncMode(5, false, 'in_stock_only') === true);
  log('in_stock_only + qoh=0 → false', passesSyncMode(0, false, 'in_stock_only') === false);
  log('active_promos_only + hasActivePromo → true', passesSyncMode(5, true, 'active_promos_only') === true);
}

// ── meetsMarginGuard ─────────────────────────────────────────────────
console.log('\n[7] meetsMarginGuard');
{
  log('30% margin passes 5% guard', meetsMarginGuard(10, 7, 5) === true);
  log('2% margin fails 5% guard', meetsMarginGuard(10, 9.8, 5) === false);
  log('null cost skips guard (passes)', meetsMarginGuard(10, null, 5) === true);
  log('zero minMarginPercent disables guard', meetsMarginGuard(10, 9.99, 0) === true);
}

// ── effectiveVelocityWindow ─────────────────────────────────────────
console.log('\n[8] effectiveVelocityWindow — per-dept beats store-wide');
{
  log('global 14 + no dept → 14',
    effectiveVelocityWindow(7, { velocityWindowDays: 14 }) === 14);
  log('global 14 + dept 7 → 7 (perishables)',
    effectiveVelocityWindow(7, { velocityWindowDays: 14, velocityWindowByDepartment: { '7': 7 } }) === 7);
  log('null dept falls through to global',
    effectiveVelocityWindow(null, { velocityWindowDays: 14, velocityWindowByDepartment: { '7': 30 } }) === 14);
  log('nothing configured → null',
    effectiveVelocityWindow(7, {}) === null);
}

// ── computeUnknownStockQty ──────────────────────────────────────────
console.log('\n[9] computeUnknownStockQty — three policies');
{
  log('send_zero → 0', computeUnknownStockQty({ unknownStockBehavior: 'send_zero' }, 5) === 0);
  log('send_default 99 → 99',
    computeUnknownStockQty({ unknownStockBehavior: 'send_default', unknownStockDefaultQty: 99 }, 5) === 99);
  log('estimate_from_velocity avg=3, days=2 → 6',
    computeUnknownStockQty({ unknownStockBehavior: 'estimate_from_velocity', unknownStockDaysOfCover: 2 }, 3) === 6);
  log('estimate avg=2.7, days=3 → ceil(8.1) = 9',
    computeUnknownStockQty({ unknownStockBehavior: 'estimate_from_velocity', unknownStockDaysOfCover: 3 }, 2.7) === 9);
  log('estimate avg=0 → 0',
    computeUnknownStockQty({ unknownStockBehavior: 'estimate_from_velocity', unknownStockDaysOfCover: 2 }, 0) === 0);
}

// ── computeMarketplacePrice (orchestrator) ──────────────────────────
console.log('\n[10] computeMarketplacePrice — orchestrator');
{
  // Zero config → unchanged
  const r1 = computeMarketplacePrice({ basePrice: 5.99, config: {} });
  log('no config → unchanged price 5.99, not skipped',
    !r1.skipped && r1.price === 5.99 && r1.markupApplied === 0);

  // Global 15% + charm_99
  const r2 = computeMarketplacePrice({
    basePrice: 5.0,
    config: { markupPercent: 15, roundingMode: 'charm_99' },
  });
  log('5.00 × +15% = 5.75 → charm_99 → $5.99',
    !r2.skipped && r2.price === 5.99 && r2.markupApplied === 15 && r2.markupSource === 'global');

  // Excluded dept
  const r3 = computeMarketplacePrice({
    basePrice: 5,
    departmentId: 7,
    config: { excludedDepartmentIds: [7] },
  });
  log('excluded dept → skipped/excluded_department',
    r3.skipped && r3.skipReason === 'excluded_department');

  // Excluded product
  const r4 = computeMarketplacePrice({
    basePrice: 5,
    productId: 99,
    config: { excludedProductIds: [99] },
  });
  log('excluded product → skipped/excluded_product',
    r4.skipped && r4.skipReason === 'excluded_product');

  // Sync mode in_stock_only with qoh=0
  const r5 = computeMarketplacePrice({
    basePrice: 5,
    quantityOnHand: 0,
    config: { syncMode: 'in_stock_only' },
  });
  log('in_stock_only + qoh=0 → skipped/sync_mode_filter',
    r5.skipped && r5.skipReason === 'sync_mode_filter');

  // Estimate qty when qoh=0 + estimate mode
  const r6 = computeMarketplacePrice({
    basePrice: 10,
    quantityOnHand: 0,
    avgDaily: 4,
    config: {
      markupPercent: 0,  // no markup so price stays
      unknownStockBehavior: 'estimate_from_velocity',
      unknownStockDaysOfCover: 2,
    },
  });
  log('qoh=0 + estimate → qty=8 (4×2)', !r6.skipped && r6.qty === 8 && r6.price === 10);

  // Real-world: $3.99 cigarette + 25% markup + charm_99
  const r7 = computeMarketplacePrice({
    basePrice: 3.99,
    departmentId: 5,
    quantityOnHand: 24,
    config: {
      markupPercent: 15,
      categoryMarkups: { '5': 25 },
      roundingMode: 'charm_99',
    },
  });
  // 3.99 × 1.25 = 4.9875 → round2 4.99 → charm_99 keeps 4.99
  log('cigarette $3.99 → +25% dept → charm_99 → $4.99',
    !r7.skipped && r7.price === 4.99 && r7.markupSource === 'category');
}

// ── End-to-end realism: emulate a sync upsert ─────────────────────────
console.log('\n[11] Sync upsert simulation — mirrors syncRoutes.js applyStorefrontTransform()');
{
  // Storefront config: 12% global, charm_99 rounding
  // Product: $10 default, qty 5
  // Expected EcomProduct: retailPrice=$11.99, qty=5, visible=true
  const transform = (() => {
    const config = {
      markupPercent: 12,
      roundingMode: 'charm_99',
      unknownStockBehavior: 'send_zero',
    };
    const r = computeMarketplacePrice({
      basePrice: 10,
      quantityOnHand: 5,
      config,
    });
    return {
      skipped: r.skipped,
      retailPrice: r.skipped ? 10 : r.price,
      qty: r.skipped ? 0 : r.qty,
      visible: !r.skipped,
    };
  })();
  log('sync upsert: $10 + 12% + charm_99 → retailPrice=$11.99, qty=5, visible=true',
    !transform.skipped && transform.retailPrice === 11.99 && transform.qty === 5 && transform.visible === true);

  // Excluded product simulation
  const transform2 = (() => {
    const config = {
      excludedProductIds: [50369],  // tobacco product
      markupPercent: 12,
    };
    const r = computeMarketplacePrice({
      basePrice: 11.99,
      productId: 50369,
      config,
    });
    return { skipped: r.skipped, visible: !r.skipped };
  })();
  log('excluded product → visible: false (hidden on storefront)',
    transform2.skipped && transform2.visible === false);
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`✓ pass: ${pass}`);
console.log(`✗ fail: ${fail}`);
console.log(`total:  ${pass + fail}`);

process.exit(fail > 0 ? 1 : 0);
