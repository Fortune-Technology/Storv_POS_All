// @ts-nocheck — Test suite. Same convention as the rest of /backend/tests
//   (Phase 5 strict-typing rollout will tighten these later).

// Session 71 — Marketplace Markup service.
// Pure-function tests: no DB, no Prisma stubbing required.
// Locks the markup math, rounding modes, exclusion + sync-mode filtering,
// and margin guard.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMarkup,
  applyRounding,
  effectiveMarkupPercent,
  meetsMarginGuard,
  isExcluded,
  passesSyncMode,
  computeMarketplacePrice,
  normalizeConfig,
  effectiveVelocityWindow,
  computeUnknownStockQty,
} from '../src/services/marketplaceMarkup.js';
import { maxVelocityWindowDays, calculateSmartQoH } from '../src/services/inventorySyncService.js';

// ── effectiveMarkupPercent ────────────────────────────────────────────
describe('effectiveMarkupPercent', () => {
  test('returns global when no category override', () => {
    const r = effectiveMarkupPercent(7, { markupPercent: 15 });
    assert.equal(r.percent, 15);
    assert.equal(r.source, 'global');
  });

  test('category override wins over global', () => {
    const r = effectiveMarkupPercent(7, {
      markupPercent: 15,
      categoryMarkups: { '7': 25 },
    });
    assert.equal(r.percent, 25);
    assert.equal(r.source, 'category');
  });

  test('returns zero + none when nothing configured', () => {
    const r = effectiveMarkupPercent(7, {});
    assert.equal(r.percent, 0);
    assert.equal(r.source, 'none');
  });

  test('numeric department id keys correctly', () => {
    const r = effectiveMarkupPercent(42, { categoryMarkups: { '42': 10 } });
    assert.equal(r.percent, 10);
    assert.equal(r.source, 'category');
  });

  test('null department falls through to global', () => {
    const r = effectiveMarkupPercent(null, {
      markupPercent: 12,
      categoryMarkups: { '7': 25 },
    });
    assert.equal(r.percent, 12);
    assert.equal(r.source, 'global');
  });

  test('zero in categoryMarkups falls through to global (treated as not set)', () => {
    const r = effectiveMarkupPercent(7, {
      markupPercent: 15,
      categoryMarkups: { '7': 0 },
    });
    assert.equal(r.percent, 15);
    assert.equal(r.source, 'global');
  });
});

// ── applyMarkup ───────────────────────────────────────────────────────
describe('applyMarkup', () => {
  test('+15% on $10 → $11.50', () => {
    assert.equal(applyMarkup(10, 15), 11.50);
  });

  test('+0% returns base price unchanged', () => {
    assert.equal(applyMarkup(7.99, 0), 7.99);
  });

  test('rounds to 2 decimals', () => {
    // $3.99 + 15% = $4.5885 → $4.59
    assert.equal(applyMarkup(3.99, 15), 4.59);
  });

  test('negative percent (discount) is allowed', () => {
    // $10 - 5% = $9.50
    assert.equal(applyMarkup(10, -5), 9.50);
  });
});

// ── applyRounding ─────────────────────────────────────────────────────
describe('applyRounding', () => {
  describe('none', () => {
    test('preserves input but rounds to 2dp', () => {
      assert.equal(applyRounding(5.27, 'none'), 5.27);
      assert.equal(applyRounding(5.273, 'none'), 5.27);
    });
  });

  describe('nearest_dollar', () => {
    test('$5.27 → $5.00', () => assert.equal(applyRounding(5.27, 'nearest_dollar'), 5.00));
    test('$5.55 → $6.00', () => assert.equal(applyRounding(5.55, 'nearest_dollar'), 6.00));
    test('$5.50 → $6.00 (banker rounding edge)', () => {
      // Math.round(5.50) === 6 in JS due to standard half-up
      assert.equal(applyRounding(5.50, 'nearest_dollar'), 6.00);
    });
  });

  describe('nearest_half', () => {
    test('$5.27 → $5.50 (closer than $5.00)', () => assert.equal(applyRounding(5.27, 'nearest_half'), 5.50));
    test('$5.20 → $5.00 (closer than $5.50)', () => assert.equal(applyRounding(5.20, 'nearest_half'), 5.00));
    test('$5.75 → $6.00 (closer than $5.50)', () => assert.equal(applyRounding(5.75, 'nearest_half'), 6.00));
    test('$5.50 → $5.50', () => assert.equal(applyRounding(5.50, 'nearest_half'), 5.50));
  });

  describe('charm_99', () => {
    test('$5.27 → $5.99', () => assert.equal(applyRounding(5.27, 'charm_99'), 5.99));
    test('$5.99 → $5.99', () => assert.equal(applyRounding(5.99, 'charm_99'), 5.99));
    test('$6.00 → $6.99 (rounds up from exact dollar)', () => {
      assert.equal(applyRounding(6.00, 'charm_99'), 6.99);
    });
    test('$5.50 → $5.99', () => assert.equal(applyRounding(5.50, 'charm_99'), 5.99));
  });

  describe('charm_95', () => {
    test('$5.27 → $5.95', () => assert.equal(applyRounding(5.27, 'charm_95'), 5.95));
    test('$5.95 → $5.95', () => assert.equal(applyRounding(5.95, 'charm_95'), 5.95));
    test('$6.00 → $6.95', () => assert.equal(applyRounding(6.00, 'charm_95'), 6.95));
  });

  describe('psych_smart', () => {
    test('$5.27 → $5.50 (closest of {5.00, 5.50, 5.99, 6.00})', () => {
      // distances: 5.00 → .27, 5.50 → .23, 5.99 → .72, 6.00 → .73
      assert.equal(applyRounding(5.27, 'psych_smart'), 5.50);
    });
    test('$5.95 → $5.99 (closest of {5.00, 5.50, 5.99, 6.00})', () => {
      // distances: 5.00 → .95, 5.50 → .45, 5.99 → .04, 6.00 → .05
      assert.equal(applyRounding(5.95, 'psych_smart'), 5.99);
    });
    test('$5.10 → $5.00', () => {
      // distances: 5.00 → .10, 5.50 → .40, 5.99 → .89, 6.00 → .90
      assert.equal(applyRounding(5.10, 'psych_smart'), 5.00);
    });
    test('$5.99 → $5.99 (exact)', () => {
      assert.equal(applyRounding(5.99, 'psych_smart'), 5.99);
    });
  });

  test('non-finite input returns 0', () => {
    assert.equal(applyRounding(NaN, 'none'), 0);
    assert.equal(applyRounding(Infinity, 'none'), 0);
  });
});

// ── meetsMarginGuard ──────────────────────────────────────────────────
describe('meetsMarginGuard', () => {
  test('30% margin passes 5% guard', () => {
    // (10 - 7) / 10 = 30% ≥ 5%
    assert.equal(meetsMarginGuard(10, 7, 5), true);
  });

  test('2% margin fails 5% guard', () => {
    // (10 - 9.80) / 10 = 2% < 5%
    assert.equal(meetsMarginGuard(10, 9.80, 5), false);
  });

  test('null cost skips guard (passes)', () => {
    assert.equal(meetsMarginGuard(10, null, 5), true);
  });

  test('zero cost skips guard (passes)', () => {
    assert.equal(meetsMarginGuard(10, 0, 5), true);
  });

  test('zero minMarginPercent disables guard (always passes)', () => {
    assert.equal(meetsMarginGuard(10, 9.99, 0), true);
  });

  test('negative price fails guard', () => {
    assert.equal(meetsMarginGuard(-1, 5, 5), false);
  });
});

// ── isExcluded ────────────────────────────────────────────────────────
describe('isExcluded', () => {
  test('product id in exclusion list → excluded as product', () => {
    const r = isExcluded(7, 99, { excludedProductIds: [99, 100] });
    assert.equal(r.excluded, true);
    assert.equal(r.reason, 'product');
  });

  test('department id in exclusion list → excluded as department', () => {
    const r = isExcluded(7, 99, { excludedDepartmentIds: [7] });
    assert.equal(r.excluded, true);
    assert.equal(r.reason, 'department');
  });

  test('product check beats department check (product wins)', () => {
    const r = isExcluded(7, 99, {
      excludedDepartmentIds: [7],
      excludedProductIds: [99],
    });
    assert.equal(r.excluded, true);
    assert.equal(r.reason, 'product');
  });

  test('not excluded when neither matches', () => {
    const r = isExcluded(7, 99, {
      excludedDepartmentIds: [8],
      excludedProductIds: [100],
    });
    assert.equal(r.excluded, false);
  });

  test('handles string vs number coercion', () => {
    const r = isExcluded('7', 99, { excludedDepartmentIds: [7] });
    assert.equal(r.excluded, true);
    assert.equal(r.reason, 'department');
  });
});

// ── passesSyncMode ────────────────────────────────────────────────────
describe('passesSyncMode', () => {
  test('all → always true regardless of qoh/promo', () => {
    assert.equal(passesSyncMode(0, false, 'all'), true);
    assert.equal(passesSyncMode(5, true, 'all'), true);
  });

  test('in_stock_only → true only when qoh > 0', () => {
    assert.equal(passesSyncMode(5, false, 'in_stock_only'), true);
    assert.equal(passesSyncMode(0, true, 'in_stock_only'), false);
    assert.equal(passesSyncMode(null, true, 'in_stock_only'), false);
  });

  test('active_promos_only → true only when hasActivePromo', () => {
    assert.equal(passesSyncMode(5, false, 'active_promos_only'), false);
    assert.equal(passesSyncMode(5, true, 'active_promos_only'), true);
    assert.equal(passesSyncMode(0, true, 'active_promos_only'), true);
  });
});

// ── normalizeConfig ───────────────────────────────────────────────────
describe('normalizeConfig', () => {
  test('null input returns full default shape', () => {
    const c = normalizeConfig(null);
    assert.equal(c.markupPercent, 0);
    assert.equal(c.roundingMode, 'none');
    assert.equal(c.inventorySyncEnabled, true);
    assert.equal(c.syncMode, 'all');
    assert.deepEqual(c.excludedDepartmentIds, []);
  });

  test('partial input merges with defaults', () => {
    const c = normalizeConfig({ markupPercent: 15, roundingMode: 'charm_99' });
    assert.equal(c.markupPercent, 15);
    assert.equal(c.roundingMode, 'charm_99');
    assert.equal(c.inventorySyncEnabled, true);
  });

  test('inventorySyncEnabled = false is preserved (not coerced to default)', () => {
    const c = normalizeConfig({ inventorySyncEnabled: false });
    assert.equal(c.inventorySyncEnabled, false);
  });
});

// ── computeMarketplacePrice (orchestrator) ────────────────────────────
describe('computeMarketplacePrice', () => {
  const NO_CONFIG = {};

  test('zero config → unchanged price, not skipped', () => {
    const r = computeMarketplacePrice({ basePrice: 5.99, config: NO_CONFIG });
    assert.equal(r.skipped, false);
    assert.equal(r.price, 5.99);
    assert.equal(r.markupApplied, 0);
    assert.equal(r.markupSource, 'none');
  });

  test('global 15% markup + charm_99 rounding', () => {
    const r = computeMarketplacePrice({
      basePrice: 5.00,
      config: { markupPercent: 15, roundingMode: 'charm_99' },
    });
    // 5.00 * 1.15 = 5.75 → charm_99 → 5.99
    assert.equal(r.skipped, false);
    assert.equal(r.price, 5.99);
    assert.equal(r.markupApplied, 15);
    assert.equal(r.markupSource, 'global');
  });

  test('category override fires for matching department', () => {
    const r = computeMarketplacePrice({
      basePrice: 10,
      departmentId: 7,
      config: {
        markupPercent: 5,
        categoryMarkups: { '7': 30 },
        roundingMode: 'nearest_dollar',
      },
    });
    // 10 * 1.30 = 13 → already whole dollar
    assert.equal(r.price, 13);
    assert.equal(r.markupApplied, 30);
    assert.equal(r.markupSource, 'category');
  });

  test('excluded department → skipped with reason', () => {
    const r = computeMarketplacePrice({
      basePrice: 5,
      departmentId: 7,
      config: { excludedDepartmentIds: [7] },
    });
    assert.equal(r.skipped, true);
    assert.equal(r.skipReason, 'excluded_department');
    assert.equal(r.price, undefined);
  });

  test('excluded product → skipped with product reason', () => {
    const r = computeMarketplacePrice({
      basePrice: 5,
      productId: 99,
      config: { excludedProductIds: [99] },
    });
    assert.equal(r.skipped, true);
    assert.equal(r.skipReason, 'excluded_product');
  });

  test('sync mode in_stock_only with qoh=0 → skipped', () => {
    const r = computeMarketplacePrice({
      basePrice: 5,
      quantityOnHand: 0,
      config: { syncMode: 'in_stock_only' },
    });
    assert.equal(r.skipped, true);
    assert.equal(r.skipReason, 'sync_mode_filter');
  });

  test('sync mode active_promos_only without active promo → skipped', () => {
    const r = computeMarketplacePrice({
      basePrice: 5,
      hasActivePromo: false,
      config: { syncMode: 'active_promos_only' },
    });
    assert.equal(r.skipped, true);
    assert.equal(r.skipReason, 'sync_mode_filter');
  });

  test('thin margin → skipped with margin reason', () => {
    // base $10, cost $9.80, +5% markup = $10.50, margin = (10.50-9.80)/10.50 = 6.67%
    // not thin enough — try cost $10.20: markup = 10.50, margin = (10.50-10.20)/10.50 = 2.86% < 5%
    const r = computeMarketplacePrice({
      basePrice: 10,
      costPrice: 10.20,
      config: { markupPercent: 5, minMarginPercent: 5 },
    });
    assert.equal(r.skipped, true);
    assert.equal(r.skipReason, 'margin_too_thin');
  });

  test('thin margin guard does not skip when no cost data', () => {
    const r = computeMarketplacePrice({
      basePrice: 10,
      costPrice: null,
      config: { markupPercent: 5, minMarginPercent: 50 },  // unrealistic 50% guard
    });
    // No cost → guard skipped → product passes
    assert.equal(r.skipped, false);
    assert.equal(r.price, 10.50);
  });

  test('zero base price → skipped as invalid', () => {
    const r = computeMarketplacePrice({ basePrice: 0, config: { markupPercent: 15 } });
    assert.equal(r.skipped, true);
    assert.equal(r.skipReason, 'invalid_base_price');
  });

  test('exclusion check beats sync mode filter', () => {
    // Excluded but in stock + sync mode in_stock_only → still skipped as excluded
    const r = computeMarketplacePrice({
      basePrice: 5,
      productId: 99,
      quantityOnHand: 10,
      config: {
        excludedProductIds: [99],
        syncMode: 'in_stock_only',
      },
    });
    assert.equal(r.skipped, true);
    assert.equal(r.skipReason, 'excluded_product');
  });

  test('end-to-end: $3.99 cigarettes + 25% category markup + charm_99', () => {
    // $3.99 * 1.25 = $4.9875 → round2 = $4.99 → charm_99 keeps at $4.99
    const r = computeMarketplacePrice({
      basePrice: 3.99,
      departmentId: 5,    // tobacco dept
      costPrice: 3.20,
      config: {
        markupPercent: 15,
        categoryMarkups: { '5': 25 },
        roundingMode: 'charm_99',
        minMarginPercent: 5,
      },
    });
    assert.equal(r.skipped, false);
    assert.equal(r.price, 4.99);
    assert.equal(r.markupApplied, 25);
    assert.equal(r.markupSource, 'category');
  });
});

// ── S71c — Inventory estimation ───────────────────────────────────────
describe('effectiveVelocityWindow', () => {
  test('returns global default when no per-dept override', () => {
    assert.equal(effectiveVelocityWindow(7, { velocityWindowDays: 14 }), 14);
  });

  test('per-dept override beats global', () => {
    assert.equal(
      effectiveVelocityWindow(7, {
        velocityWindowDays: 14,
        velocityWindowByDepartment: { '7': 30 },
      }),
      30,
    );
  });

  test('per-dept override of 7 (perishables) wins over global 14', () => {
    assert.equal(
      effectiveVelocityWindow(143, {
        velocityWindowDays: 14,
        velocityWindowByDepartment: { '143': 7 },
      }),
      7,
    );
  });

  test('null department falls through to global', () => {
    assert.equal(
      effectiveVelocityWindow(null, {
        velocityWindowDays: 14,
        velocityWindowByDepartment: { '7': 30 },
      }),
      14,
    );
  });

  test('returns null when nothing configured', () => {
    assert.equal(effectiveVelocityWindow(7, {}), null);
  });

  test('zero or negative override is ignored (falls through)', () => {
    assert.equal(
      effectiveVelocityWindow(7, {
        velocityWindowDays: 14,
        velocityWindowByDepartment: { '7': 0 },
      }),
      14,
    );
  });

  test('rounds fractional days', () => {
    assert.equal(effectiveVelocityWindow(7, { velocityWindowDays: 14.7 }), 15);
  });
});

describe('computeUnknownStockQty', () => {
  test('send_zero (default) returns 0 regardless of velocity', () => {
    assert.equal(computeUnknownStockQty({ unknownStockBehavior: 'send_zero' }, 5), 0);
    assert.equal(computeUnknownStockQty({}, 5), 0);  // default mode
  });

  test('send_default returns the configured qty', () => {
    assert.equal(
      computeUnknownStockQty({ unknownStockBehavior: 'send_default', unknownStockDefaultQty: 99 }, 5),
      99,
    );
  });

  test('send_default with no qty configured returns 0', () => {
    assert.equal(computeUnknownStockQty({ unknownStockBehavior: 'send_default' }, 5), 0);
  });

  test('estimate_from_velocity: avgDaily=3, daysOfCover=2 → 6', () => {
    assert.equal(
      computeUnknownStockQty(
        { unknownStockBehavior: 'estimate_from_velocity', unknownStockDaysOfCover: 2 },
        3,
      ),
      6,
    );
  });

  test('estimate_from_velocity: avgDaily=2.7, daysOfCover=3 → ceil(8.1) = 9', () => {
    assert.equal(
      computeUnknownStockQty(
        { unknownStockBehavior: 'estimate_from_velocity', unknownStockDaysOfCover: 3 },
        2.7,
      ),
      9,
    );
  });

  test('estimate_from_velocity: avgDaily=0 → 0 (no sales = no estimate)', () => {
    assert.equal(
      computeUnknownStockQty(
        { unknownStockBehavior: 'estimate_from_velocity', unknownStockDaysOfCover: 2 },
        0,
      ),
      0,
    );
  });

  test('estimate_from_velocity: daysOfCover=0 → 0', () => {
    assert.equal(
      computeUnknownStockQty(
        { unknownStockBehavior: 'estimate_from_velocity', unknownStockDaysOfCover: 0 },
        5,
      ),
      0,
    );
  });

  test('estimate_from_velocity: null avgDaily → 0', () => {
    assert.equal(
      computeUnknownStockQty(
        { unknownStockBehavior: 'estimate_from_velocity', unknownStockDaysOfCover: 2 },
        null,
      ),
      0,
    );
  });

  test('negative defaultQty floors to 0', () => {
    assert.equal(
      computeUnknownStockQty({ unknownStockBehavior: 'send_default', unknownStockDefaultQty: -5 }, 0),
      0,
    );
  });
});

describe('maxVelocityWindowDays', () => {
  test('returns 0 when nothing configured', () => {
    assert.equal(maxVelocityWindowDays({}), 0);
  });

  test('returns global when only global set', () => {
    assert.equal(maxVelocityWindowDays({ velocityWindowDays: 14 }), 14);
  });

  test('returns max of global + per-dept overrides', () => {
    assert.equal(
      maxVelocityWindowDays({
        velocityWindowDays: 14,
        velocityWindowByDepartment: { '7': 30, '143': 7, '145': 60 },
      }),
      60,  // 145's 60-day window is the largest
    );
  });

  test('global only when no overrides', () => {
    assert.equal(
      maxVelocityWindowDays({
        velocityWindowDays: 14,
        velocityWindowByDepartment: {},
      }),
      14,
    );
  });

  test('ignores invalid (non-positive) values', () => {
    assert.equal(
      maxVelocityWindowDays({
        velocityWindowDays: 14,
        velocityWindowByDepartment: { '7': 0, '143': -5 },
      }),
      14,
    );
  });
});

describe('calculateSmartQoH', () => {
  const masterProductBread = { id: 50362, departmentId: 143 };
  const baseProduct = (qoh: number | null) => ({
    quantityOnHand: qoh,
    masterProduct: masterProductBread,
  });

  test('positive qoh returns qoh as-is (normal case)', () => {
    assert.equal(calculateSmartQoH(baseProduct(5) as any, {}, {}, new Map()), 5);
  });

  test('zero qoh + send_zero (default) → 0', () => {
    assert.equal(
      calculateSmartQoH(baseProduct(0) as any, {}, { unknownStockBehavior: 'send_zero' }, new Map()),
      0,
    );
  });

  test('zero qoh + send_default → configured qty', () => {
    assert.equal(
      calculateSmartQoH(
        baseProduct(0) as any,
        {},
        { unknownStockBehavior: 'send_default', unknownStockDefaultQty: 25 },
        new Map(),
      ),
      25,
    );
  });

  test('zero qoh + estimate_from_velocity uses velocity map', () => {
    const velocityMap = new Map([[50362, 4]]);  // 4 units/day avg
    assert.equal(
      calculateSmartQoH(
        baseProduct(0) as any,
        {},
        { unknownStockBehavior: 'estimate_from_velocity', unknownStockDaysOfCover: 3 },
        velocityMap,
      ),
      12,  // ceil(4 × 3)
    );
  });

  test('negative qoh treated as unknown (estimate path fires)', () => {
    const velocityMap = new Map([[50362, 2]]);
    assert.equal(
      calculateSmartQoH(
        baseProduct(-3) as any,
        {},
        { unknownStockBehavior: 'estimate_from_velocity', unknownStockDaysOfCover: 2 },
        velocityMap,
      ),
      4,  // ceil(2 × 2) — negative qoh ≤ 0 so estimate fires
    );
  });

  test('estimate mode but product not in velocity map → 0 (no sales = no estimate)', () => {
    assert.equal(
      calculateSmartQoH(
        baseProduct(0) as any,
        {},
        { unknownStockBehavior: 'estimate_from_velocity', unknownStockDaysOfCover: 2 },
        new Map(),  // empty
      ),
      0,
    );
  });

  test('inventoryConfig.departments.fixedQoH still wins (legacy override)', () => {
    assert.equal(
      calculateSmartQoH(
        baseProduct(0) as any,
        { departments: { '143': { fixedQoH: 99 } } },
        { unknownStockBehavior: 'estimate_from_velocity', unknownStockDaysOfCover: 2 },
        new Map([[50362, 5]]),
      ),
      99,  // legacy fixedQoH override wins even when estimate mode is on
    );
  });

  test('positive qoh wins over fixedQoH override (only fires when stock is unknown)', () => {
    // The fixedQoH check happens BEFORE the qoh > 0 check — so if a dept has
    // fixedQoH=99 set, that pins the value regardless of actual stock.
    // This is intentional for "hide actual count, always show 99" use case.
    assert.equal(
      calculateSmartQoH(
        baseProduct(50) as any,
        { departments: { '143': { fixedQoH: 99 } } },
        {},
        new Map(),
      ),
      99,
    );
  });
});
