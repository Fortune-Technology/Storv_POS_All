// @ts-nocheck — Test suite. Same convention as the rest of /backend/tests
//   (Phase 5 strict-typing rollout will tighten these later).

// Session 50 — Dual Pricing service.
// Pure-function tests: no DB, no Prisma stubbing required.
// Locks the surcharge math, tier-vs-custom resolution, tax interaction,
// and disclosure fallback.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSurcharge,
  computeCardPriceForLabel,
  getEffectiveSurchargeRate,
  resolveDisclosureText,
  CARD_TENDERS,
} from '../src/services/dualPricing.js';

// ─── Fixtures ─────────────────────────────────────────────────────────
const TIER_STANDARD = { surchargePercent: 3.0,  surchargeFixedFee: 0.30, key: 'tier_1' };
const TIER_VOLUME   = { surchargePercent: 2.75, surchargeFixedFee: 0.25, key: 'tier_2' };

const STORE_INTERCHANGE = {
  pricingModel: 'interchange',
  pricingTier: TIER_STANDARD,           // tier present but ignored — model is interchange
  customSurchargePercent: null,
  customSurchargeFixedFee: null,
};

const STORE_DUAL_TIER = {
  pricingModel: 'dual_pricing',
  pricingTier: TIER_STANDARD,
  customSurchargePercent: null,
  customSurchargeFixedFee: null,
};

const STORE_DUAL_CUSTOM = {
  pricingModel: 'dual_pricing',
  pricingTier: TIER_STANDARD,           // tier set but custom takes precedence
  customSurchargePercent: 2.5,
  customSurchargeFixedFee: 0.20,
};

const STORE_DUAL_NO_RATE = {
  pricingModel: 'dual_pricing',
  pricingTier: null,
  customSurchargePercent: null,
  customSurchargeFixedFee: null,
};

const STATE_NY     = { surchargeTaxable: true,  pricingFraming: 'surcharge',     dualPricingAllowed: true };
const STATE_MA     = { surchargeTaxable: false, pricingFraming: 'cash_discount', dualPricingAllowed: false };
const STATE_GENERIC = { surchargeTaxable: false, pricingFraming: 'surcharge',     dualPricingAllowed: true };

// ─── getEffectiveSurchargeRate ─────────────────────────────────────────
describe('getEffectiveSurchargeRate', () => {
  test('returns tier rates when only tier set', () => {
    const r = getEffectiveSurchargeRate(STORE_DUAL_TIER);
    assert.equal(r.percent, 3.0);
    assert.equal(r.fixedFee, 0.30);
    assert.equal(r.source, 'tier');
    assert.equal(r.tierKey, 'tier_1');
  });

  test('custom override beats tier when both fields set', () => {
    const r = getEffectiveSurchargeRate(STORE_DUAL_CUSTOM);
    assert.equal(r.percent, 2.5);
    assert.equal(r.fixedFee, 0.20);
    assert.equal(r.source, 'custom');
    assert.equal(r.tierKey, null);
  });

  test('partial custom (percent only) falls back to tier', () => {
    const r = getEffectiveSurchargeRate({
      pricingModel: 'dual_pricing',
      pricingTier: TIER_STANDARD,
      customSurchargePercent: 5,
      customSurchargeFixedFee: null,
    });
    // Per service contract, partial custom is ignored — tier wins.
    assert.equal(r.percent, 3.0);
    assert.equal(r.source, 'tier');
  });

  test('no tier and no custom returns zero rate', () => {
    const r = getEffectiveSurchargeRate(STORE_DUAL_NO_RATE);
    assert.equal(r.percent, 0);
    assert.equal(r.fixedFee, 0);
    assert.equal(r.source, 'none');
  });
});

// ─── computeSurcharge — interchange model never charges ───────────────
describe('computeSurcharge — interchange', () => {
  test('returns zero surcharge for card tender', () => {
    const r = computeSurcharge({
      baseSubtotal: 100,
      tenderMethod: 'credit',
      store: STORE_INTERCHANGE,
      state: STATE_NY,
      taxRate: 0.085,
    });
    assert.equal(r.surcharge, 0);
    assert.equal(r.surchargeTax, 0);
    assert.equal(r.applied, false);
  });

  test('returns zero surcharge for cash tender', () => {
    const r = computeSurcharge({
      baseSubtotal: 100,
      tenderMethod: 'cash',
      store: STORE_INTERCHANGE,
      state: STATE_NY,
    });
    assert.equal(r.surcharge, 0);
    assert.equal(r.applied, false);
  });
});

// ─── computeSurcharge — dual_pricing model ─────────────────────────────
describe('computeSurcharge — dual_pricing', () => {
  test('credit tender on $100 cart with 3% + $0.30 → $3.30', () => {
    const r = computeSurcharge({
      baseSubtotal: 100,
      tenderMethod: 'credit',
      store: STORE_DUAL_TIER,
      state: STATE_GENERIC,
    });
    assert.equal(r.surcharge, 3.30);
    assert.equal(r.applied, true);
    assert.equal(r.rateSource, 'tier');
  });

  test('debit tender same surcharge as credit', () => {
    const r = computeSurcharge({
      baseSubtotal: 100,
      tenderMethod: 'debit',
      store: STORE_DUAL_TIER,
      state: STATE_GENERIC,
    });
    assert.equal(r.surcharge, 3.30);
    assert.equal(r.applied, true);
  });

  test('cash tender — never surcharged even on dual_pricing', () => {
    const r = computeSurcharge({
      baseSubtotal: 100,
      tenderMethod: 'cash',
      store: STORE_DUAL_TIER,
      state: STATE_GENERIC,
    });
    assert.equal(r.surcharge, 0);
    assert.equal(r.applied, false);
  });

  test('EBT tender — never surcharged (federal rule)', () => {
    const r = computeSurcharge({
      baseSubtotal: 100,
      tenderMethod: 'ebt',
      store: STORE_DUAL_TIER,
      state: STATE_GENERIC,
    });
    assert.equal(r.surcharge, 0);
    assert.equal(r.applied, false);
  });

  test('check tender — never surcharged', () => {
    const r = computeSurcharge({
      baseSubtotal: 50,
      tenderMethod: 'check',
      store: STORE_DUAL_TIER,
      state: STATE_GENERIC,
    });
    assert.equal(r.surcharge, 0);
    assert.equal(r.applied, false);
  });

  test('gift card — never surcharged', () => {
    const r = computeSurcharge({
      baseSubtotal: 50,
      tenderMethod: 'gift_card',
      store: STORE_DUAL_TIER,
      state: STATE_GENERIC,
    });
    assert.equal(r.surcharge, 0);
    assert.equal(r.applied, false);
  });

  test('custom override applies on credit tender', () => {
    // 2.5% × $100 + $0.20 = $2.50 + $0.20 = $2.70
    const r = computeSurcharge({
      baseSubtotal: 100,
      tenderMethod: 'credit',
      store: STORE_DUAL_CUSTOM,
      state: STATE_GENERIC,
    });
    assert.equal(r.surcharge, 2.70);
    assert.equal(r.applied, true);
    assert.equal(r.rateSource, 'custom');
  });

  test('zero rate (no tier, no custom) — no surcharge even on dual_pricing', () => {
    const r = computeSurcharge({
      baseSubtotal: 100,
      tenderMethod: 'credit',
      store: STORE_DUAL_NO_RATE,
      state: STATE_GENERIC,
    });
    assert.equal(r.surcharge, 0);
    assert.equal(r.applied, false);
  });

  test('zero subtotal (empty cart) — no surcharge', () => {
    const r = computeSurcharge({
      baseSubtotal: 0,
      tenderMethod: 'credit',
      store: STORE_DUAL_TIER,
      state: STATE_GENERIC,
    });
    assert.equal(r.surcharge, 0);
    assert.equal(r.applied, false);
  });

  test('negative subtotal (refund) — no surcharge (handled by refund flow)', () => {
    const r = computeSurcharge({
      baseSubtotal: -50,
      tenderMethod: 'credit',
      store: STORE_DUAL_TIER,
      state: STATE_GENERIC,
    });
    assert.equal(r.surcharge, 0);
    assert.equal(r.applied, false);
  });

  test('rounding: $33.33 × 3% + $0.30 = $1.30 (rounded from $1.2999)', () => {
    const r = computeSurcharge({
      baseSubtotal: 33.33,
      tenderMethod: 'credit',
      store: STORE_DUAL_TIER,
      state: STATE_GENERIC,
    });
    // 33.33 × 0.03 = 0.9999 → + 0.30 = 1.2999 → round2 = 1.30
    assert.equal(r.surcharge, 1.30);
  });
});

// ─── computeSurcharge — surcharge tax interaction ─────────────────────
describe('computeSurcharge — surchargeTax', () => {
  test('NY (taxable) — 8.5% tax applied to surcharge', () => {
    const r = computeSurcharge({
      baseSubtotal: 100,
      tenderMethod: 'credit',
      store: STORE_DUAL_TIER,
      state: STATE_NY,
      taxRate: 0.085,
    });
    // surcharge = 3.30, tax on it = 3.30 × 0.085 = 0.2805 → round2 = 0.28
    assert.equal(r.surcharge, 3.30);
    assert.equal(r.surchargeTax, 0.28);
    assert.equal(r.surchargeTaxable, true);
  });

  test('MA (not taxable) — no tax on surcharge', () => {
    const r = computeSurcharge({
      baseSubtotal: 100,
      tenderMethod: 'credit',
      store: STORE_DUAL_TIER,
      state: STATE_MA,
      taxRate: 0.0625,
    });
    assert.equal(r.surcharge, 3.30);
    assert.equal(r.surchargeTax, 0);
    assert.equal(r.surchargeTaxable, false);
  });

  test('no state passed (legacy store) — no tax on surcharge', () => {
    const r = computeSurcharge({
      baseSubtotal: 100,
      tenderMethod: 'credit',
      store: STORE_DUAL_TIER,
      taxRate: 0.085,
    });
    assert.equal(r.surcharge, 3.30);
    assert.equal(r.surchargeTax, 0);
  });
});

// ─── End-to-end: loyalty + tax + surcharge order of operations ────────
describe('end-to-end checkout math', () => {
  test('NY $100 cart, 10% loyalty discount, card → $97.65 cash / $100.91 card (per plan example)', () => {
    // Per the plan: cart=$100 → loyalty=−$10 → baseSubtotal=$90 → tax 8.5% on $90 = $7.65
    // → surcharge on $90 = $90 × 0.03 + $0.30 = $3.00 → surchargeTax = $3.00 × 0.085 = $0.255 ≈ $0.26
    // Cash:  $90 + $7.65 = $97.65
    // Card:  $90 + $7.65 + $3.00 + $0.26 = $100.91
    const baseSubtotal = 90; // post-loyalty
    const cashTotal = baseSubtotal + 7.65;
    const r = computeSurcharge({
      baseSubtotal,
      tenderMethod: 'credit',
      store: STORE_DUAL_TIER,
      state: STATE_NY,
      taxRate: 0.085,
    });
    assert.equal(r.surcharge, 3.00);
    assert.equal(r.surchargeTax, 0.26);
    const cardTotal = baseSubtotal + 7.65 + r.surcharge + r.surchargeTax;
    assert.equal(round2(cardTotal), 100.91);
    assert.equal(cashTotal, 97.65);
    // Cash savings shown on receipt:
    assert.equal(round2(cardTotal - cashTotal), 3.26);
  });
});

// ─── computeCardPriceForLabel ──────────────────────────────────────────
describe('computeCardPriceForLabel', () => {
  test('interchange store — card price equals base price', () => {
    assert.equal(computeCardPriceForLabel(10, STORE_INTERCHANGE), 10);
  });

  test('dual_pricing with 3% rate — $10 base → $10.30 card', () => {
    assert.equal(computeCardPriceForLabel(10, STORE_DUAL_TIER), 10.30);
  });

  test('dual_pricing with 2.5% custom — $10 base → $10.25 card', () => {
    assert.equal(computeCardPriceForLabel(10, STORE_DUAL_CUSTOM), 10.25);
  });

  test('dual_pricing but no rate configured — card price equals base', () => {
    assert.equal(computeCardPriceForLabel(10, STORE_DUAL_NO_RATE), 10);
  });

  test('rounding: $9.99 × 1.03 = $10.29 (rounded from $10.2897)', () => {
    assert.equal(computeCardPriceForLabel(9.99, STORE_DUAL_TIER), 10.29);
  });
});

// ─── resolveDisclosureText ────────────────────────────────────────────
describe('resolveDisclosureText', () => {
  test('store override wins over state default', () => {
    const text = resolveDisclosureText(
      { pricingModel: 'dual_pricing', dualPricingDisclosure: 'STORE-OVERRIDE' },
      { surchargeDisclosureText: 'STATE-DEFAULT' },
    );
    assert.equal(text, 'STORE-OVERRIDE');
  });

  test('state default used when no store override', () => {
    const text = resolveDisclosureText(
      { pricingModel: 'dual_pricing' },
      { surchargeDisclosureText: 'STATE-DEFAULT' },
    );
    assert.equal(text, 'STATE-DEFAULT');
  });

  test('universal fallback when neither set', () => {
    const text = resolveDisclosureText({ pricingModel: 'dual_pricing' }, null);
    assert.match(text, /cash discount/i);
  });

  test('returns empty string when interchange model', () => {
    const text = resolveDisclosureText(
      { pricingModel: 'interchange', dualPricingDisclosure: 'X' },
      { surchargeDisclosureText: 'Y' },
    );
    assert.equal(text, '');
  });

  test('whitespace-only override ignored', () => {
    const text = resolveDisclosureText(
      { pricingModel: 'dual_pricing', dualPricingDisclosure: '   ' },
      { surchargeDisclosureText: 'STATE-DEFAULT' },
    );
    assert.equal(text, 'STATE-DEFAULT');
  });
});

// ─── CARD_TENDERS catalog ─────────────────────────────────────────────
describe('CARD_TENDERS', () => {
  test('contains the expected tender strings', () => {
    assert.ok(CARD_TENDERS.has('credit'));
    assert.ok(CARD_TENDERS.has('debit'));
    assert.ok(CARD_TENDERS.has('card'));
    assert.ok(CARD_TENDERS.has('credit_card'));
    assert.ok(CARD_TENDERS.has('debit_card'));
  });

  test('does NOT contain exempt tenders', () => {
    assert.equal(CARD_TENDERS.has('cash'), false);
    assert.equal(CARD_TENDERS.has('ebt'), false);
    assert.equal(CARD_TENDERS.has('ebt_cash'), false);
    assert.equal(CARD_TENDERS.has('check'), false);
    assert.equal(CARD_TENDERS.has('gift_card'), false);
    assert.equal(CARD_TENDERS.has('house_charge'), false);
  });
});

// Local helper — same shape as the service's internal round2.
function round2(n) { return Math.round(n * 100) / 100; }
