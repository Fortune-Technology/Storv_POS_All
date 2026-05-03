/**
 * Dual Pricing / Cash Discount calculator (cashier-app mirror — Session 51).
 *
 * Pure functions, no React, no I/O. Mirrors backend/src/services/dualPricing.ts
 * line-for-line. Keep the two in sync — if you change the math here, change it
 * there too. Backend tests in `backend/tests/dual_pricing.test.ts` lock the
 * contract; cashier-app uses the same shape for client-side preview + payload
 * snapshot.
 *
 * Decision tree (matches backend):
 *
 *   pricingModel === 'interchange'  → no surcharge ever
 *   pricingModel === 'dual_pricing' → surcharge applies to credit/debit/card
 *                                      tenders only; cash + EBT exempt
 *
 * Effective rate priority (matches getEffectiveSurchargeRate):
 *   1. customSurchargePercent + customSurchargeFixedFee both set on Store
 *   2. pricingTier rates (when pricingTierId set)
 *   3. zero — surcharge effectively disabled even on dual_pricing
 *
 * Lottery, fuel, gift-card, and bottle-return line items are excluded from
 * baseSubtotal by the cart store before this function runs (see useCartStore
 * selectTotals — it filters by !item.isLottery && !item.isFuel etc.).
 */

const CARD_TENDERS = new Set([
  'credit',
  'debit',
  'card',
  'credit_card',
  'debit_card',
]);

/**
 * Resolve effective surcharge rate from the dualPricing config block returned
 * by /pos-terminal/config. Returns the rate the cashier app would apply at
 * checkout — does NOT decide whether the surcharge fires (that's tender-aware).
 */
export function getEffectiveSurchargeRate(dualPricing) {
  if (!dualPricing) return { percent: 0, fixedFee: 0, source: 'none', tierKey: null };

  const customPct = toNumber(dualPricing.customSurchargePercent);
  const customFix = toNumber(dualPricing.customSurchargeFixedFee);

  if (customPct != null && customFix != null) {
    return { percent: customPct, fixedFee: customFix, source: 'custom', tierKey: null };
  }

  if (dualPricing.pricingTier) {
    const tierPct = toNumber(dualPricing.pricingTier.surchargePercent);
    const tierFix = toNumber(dualPricing.pricingTier.surchargeFixedFee);
    if (tierPct != null && tierFix != null) {
      return {
        percent:  tierPct,
        fixedFee: tierFix,
        source:   'tier',
        tierKey:  dualPricing.pricingTier.key || null,
      };
    }
  }

  return { percent: 0, fixedFee: 0, source: 'none', tierKey: null };
}

/**
 * Compute the dollar surcharge that would apply to a card tender for a given
 * post-discount baseSubtotal. Returns 0 in five cases (matches backend):
 *
 *   - dualPricing.pricingModel !== 'dual_pricing'
 *   - tenderMethod is not in CARD_TENDERS (cash/EBT/check/gift card → 0)
 *   - resolved rate is { percent: 0, fixedFee: 0 }
 *   - baseSubtotal <= 0 (refund or empty cart)
 *
 * The shape `applied: boolean` lets the caller distinguish "no surcharge
 * because tender is cash" from "no surcharge because rate is zero" for
 * analytics + UI hints.
 *
 * @param {Object} input
 * @param {number} input.baseSubtotal - Post-loyalty + post-promo + post-manual-discount subtotal
 * @param {string} input.tenderMethod - 'cash' | 'credit' | 'debit' | 'card' | 'ebt' | etc.
 * @param {Object} input.dualPricing  - The config block from usePOSConfig
 * @param {number} [input.taxRate]    - Effective sales-tax rate as decimal (e.g. 0.085)
 */
export function computeSurcharge({ baseSubtotal, tenderMethod, dualPricing, taxRate = 0 }) {
  const sub          = Number(baseSubtotal) || 0;
  const tender       = String(tenderMethod || '').toLowerCase().trim();
  const isDual       = dualPricing?.pricingModel === 'dual_pricing';
  const isCardTender = CARD_TENDERS.has(tender);
  const rate         = getEffectiveSurchargeRate(dualPricing);
  const surchargeTaxable = !!dualPricing?.state?.surchargeTaxable;

  const base = {
    surcharge:         0,
    surchargeTax:      0,
    surchargeRate:     rate.percent,
    surchargeFixedFee: rate.fixedFee,
    surchargeTaxable,
    rateSource:        rate.source,
    applied:           false,
  };

  if (!isDual) return base;
  if (!isCardTender) return base;
  if (sub <= 0) return base;
  if (rate.percent <= 0 && rate.fixedFee <= 0) return base;

  const surcharge = round2((sub * rate.percent) / 100 + rate.fixedFee);
  const surchargeTax = surchargeTaxable && taxRate > 0
    ? round2(surcharge * taxRate)
    : 0;

  return {
    ...base,
    surcharge,
    surchargeTax,
    applied: true,
  };
}

/**
 * Compute per-item card price for label/customer-display preview.
 * Excludes the per-tx fixed fee (which is ONLY relevant at checkout, not per
 * item). When a state caps the surcharge or doesn't allow it, the rate from
 * getEffectiveSurchargeRate naturally returns 0.
 */
export function computeCardPriceForLabel(unitPrice, dualPricing) {
  if (dualPricing?.pricingModel !== 'dual_pricing') return round2(unitPrice);
  const rate = getEffectiveSurchargeRate(dualPricing);
  if (rate.percent <= 0) return round2(unitPrice);
  return round2(unitPrice * (1 + rate.percent / 100));
}

/**
 * Resolve the disclosure text for receipts and labels. Falls back through:
 *   1. Store override (dualPricing.dualPricingDisclosure)
 *   2. State default (dualPricing.state.surchargeDisclosureText)
 *   3. Universal fallback
 *
 * Returns empty string when not on dual pricing.
 */
export function resolveDisclosureText(dualPricing) {
  if (dualPricing?.pricingModel !== 'dual_pricing') return '';
  const storeText = (dualPricing.dualPricingDisclosure || '').trim();
  if (storeText) return storeText;
  const stateText = (dualPricing.state?.surchargeDisclosureText || '').trim();
  if (stateText) return stateText;
  return 'A cash discount is available on this transaction. ' +
         'Credit and debit transactions include a processing fee.';
}

/**
 * Convenience: returns true if the active pricing model affects the cart at
 * checkout. UI components use this to conditionally render dual-price columns,
 * disclosure blocks, etc. without duplicating the model check.
 */
export function isDualPricingActive(dualPricing) {
  return dualPricing?.pricingModel === 'dual_pricing';
}

/**
 * Returns the framing label ("surcharge" or "cash_discount") that drives
 * receipt + customer-display copy. MA + CT force cash_discount.
 */
export function resolveFraming(dualPricing) {
  if (!isDualPricingActive(dualPricing)) return 'surcharge';
  return dualPricing.state?.pricingFraming === 'cash_discount'
    ? 'cash_discount'
    : 'surcharge';
}

function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export { CARD_TENDERS };
