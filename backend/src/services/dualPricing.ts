/**
 * Dual Pricing / Cash Discount service (Session 50)
 *
 * Pure functions — no DB, no I/O. Used by both the backend POS controllers
 * (when persisting transactions) AND the cashier-app cart store (mirrored as
 * dualPricing.js in the cashier-app). Keep both copies in sync.
 *
 * The pricing model decision tree at checkout:
 *
 *     Store.pricingModel === 'interchange'  → no surcharge ever
 *     Store.pricingModel === 'dual_pricing' → surcharge on credit/debit/card
 *                                              tenders only; cash + EBT exempt
 *
 * Effective rate resolution priority (see getEffectiveSurchargeRate):
 *
 *     1. customSurchargePercent + customSurchargeFixedFee on the Store row
 *        (per-store override; takes precedence even when a tier is also set)
 *     2. PricingTier referenced by Store.pricingTierId
 *     3. null → returns { percent: 0, fixedFee: 0 } (effectively disabled)
 *
 * Lottery, fuel, gift-card sales, and bottle returns are excluded from the
 * surcharge calculation by the controller (it strips those line items from
 * the baseSubtotal). This service deals only with the math.
 */

// Tender methods that DO carry the surcharge.
// Intentionally narrow — every other tender (cash/ebt/check/loyalty/etc.)
// is exempt. This is also enforced federally for EBT/SNAP.
const CARD_TENDERS = new Set([
  'credit',
  'debit',
  'card',           // generic — most cashier-app paths still use this
  'credit_card',
  'debit_card',
]);

export interface SurchargeRate {
  percent:  number;     // whole percent, e.g. 3.0 for 3%
  fixedFee: number;     // dollars, e.g. 0.30
  source:   'custom' | 'tier' | 'none';
  tierKey:  string | null;
}

export interface ComputeSurchargeInput {
  /** Pre-tax, post-discount subtotal (after promo + loyalty + manual order discounts). */
  baseSubtotal: number;
  /** Tender method string from cart — see CARD_TENDERS for which trigger surcharge. */
  tenderMethod: string | null | undefined;
  /** Store config — must include pricingModel + tier/custom rate fields. */
  store: {
    pricingModel?:           string | null;
    pricingTier?:            { surchargePercent?: number | string | null; surchargeFixedFee?: number | string | null; key?: string } | null;
    customSurchargePercent?: number | string | null;
    customSurchargeFixedFee?: number | string | null;
  };
  /** State catalog — needed for surchargeTaxable + framing. Optional. */
  state?: {
    surchargeTaxable?:  boolean | null;
    pricingFraming?:    string | null;
    dualPricingAllowed?: boolean | null;
  } | null;
  /** Effective sales tax rate (decimal — 0.0625 = 6.25%) used for surchargeTaxAmount. */
  taxRate?: number;
}

export interface ComputeSurchargeResult {
  /** Always >= 0. Zero when tender is not a card tender or model is interchange. */
  surcharge:          number;
  /** Always >= 0. Zero when state.surchargeTaxable !== true. */
  surchargeTax:       number;
  /** Snapshot of the rate used (for persistence on Transaction). */
  surchargeRate:      number;
  /** Snapshot of the fixed fee used. */
  surchargeFixedFee:  number;
  /** Snapshot of the state's taxability policy. */
  surchargeTaxable:   boolean;
  /** Where the rate came from. */
  rateSource:         'custom' | 'tier' | 'none';
  /** True only when (a) model is dual_pricing AND (b) tender is card AND (c) rate > 0. */
  applied:            boolean;
}

/**
 * Resolve which surcharge rate applies to a store. Per-store custom overrides
 * win over the assigned tier; both default to zero rate when neither is set.
 *
 * Pure function — no DB. Caller must pre-load the tier (Prisma include).
 */
export function getEffectiveSurchargeRate(store: ComputeSurchargeInput['store']): SurchargeRate {
  const customPct = toNumber(store.customSurchargePercent);
  const customFix = toNumber(store.customSurchargeFixedFee);

  // BOTH custom fields must be set for the override to apply. A partial
  // override (e.g. percent set, fixed fee null) falls through to the tier
  // for the missing piece — but to keep the contract simple we treat any
  // partial as "not set" and use the tier wholesale. Callers wanting to
  // override only one value should still set the other to its tier value.
  if (customPct != null && customFix != null) {
    return { percent: customPct, fixedFee: customFix, source: 'custom', tierKey: null };
  }

  if (store.pricingTier) {
    const tierPct = toNumber(store.pricingTier.surchargePercent);
    const tierFix = toNumber(store.pricingTier.surchargeFixedFee);
    if (tierPct != null && tierFix != null) {
      return {
        percent:  tierPct,
        fixedFee: tierFix,
        source:   'tier',
        tierKey:  store.pricingTier.key || null,
      };
    }
  }

  return { percent: 0, fixedFee: 0, source: 'none', tierKey: null };
}

/**
 * Compute surcharge + surcharge tax for a single transaction.
 *
 * Returns ZERO surcharge in any of these cases (no exception thrown — the
 * controller can apply the result unconditionally):
 *   - store.pricingModel !== 'dual_pricing'
 *   - tenderMethod is not a card/debit tender (cash, EBT, check, etc.)
 *   - resolved rate is { percent: 0, fixedFee: 0 } (no tier + no override)
 *   - baseSubtotal < 0 (refund — handled separately by refund flow)
 *
 * The `applied` flag in the result lets the caller distinguish "no surcharge
 * because cash" from "no surcharge because rate is zero" for analytics.
 */
export function computeSurcharge(input: ComputeSurchargeInput): ComputeSurchargeResult {
  const baseSubtotal  = Number(input.baseSubtotal) || 0;
  const tenderMethod  = String(input.tenderMethod || '').toLowerCase().trim();
  const isDualPricing = input.store?.pricingModel === 'dual_pricing';
  const isCardTender  = CARD_TENDERS.has(tenderMethod);

  const rate = getEffectiveSurchargeRate(input.store);
  const surchargeTaxable = !!input.state?.surchargeTaxable;

  // Snapshot fields are populated even when not applied — so historical
  // Transaction rows record the policy that WOULD have applied. Useful for
  // the EoD audit if a card transaction was unexpectedly run as cash.
  const baseResult: ComputeSurchargeResult = {
    surcharge:          0,
    surchargeTax:       0,
    surchargeRate:      rate.percent,
    surchargeFixedFee:  rate.fixedFee,
    surchargeTaxable,
    rateSource:         rate.source,
    applied:            false,
  };

  if (!isDualPricing) return baseResult;
  if (!isCardTender)  return baseResult;
  if (baseSubtotal <= 0) return baseResult; // refund or empty cart — handled elsewhere
  if (rate.percent <= 0 && rate.fixedFee <= 0) return baseResult;

  // surcharge = (baseSubtotal × percent / 100) + fixedFee — rounded to 2dp
  const surcharge = round2((baseSubtotal * rate.percent) / 100 + rate.fixedFee);

  // Surcharge tax — only when state policy allows it. Some states (NY/FL/TX/
  // PA/NJ/MD/VA/NC/SC/GA) require sales tax on the surcharge; others don't.
  const taxRate = Number(input.taxRate) || 0;
  const surchargeTax = surchargeTaxable && taxRate > 0
    ? round2(surcharge * taxRate)
    : 0;

  return {
    ...baseResult,
    surcharge,
    surchargeTax,
    applied: true,
  };
}

/**
 * Compute the per-line "card price" preview shown on shelf labels and the
 * customer display. This is per-item and DOES NOT include the per-tx fixed
 * fee (that fee is only relevant at checkout, not per item).
 *
 * Returns the same `unitPrice` if the store isn't on dual pricing or has no
 * configured surcharge rate.
 */
export function computeCardPriceForLabel(
  unitPrice: number,
  store: ComputeSurchargeInput['store'],
): number {
  if (store?.pricingModel !== 'dual_pricing') return round2(unitPrice);
  const rate = getEffectiveSurchargeRate(store);
  if (rate.percent <= 0) return round2(unitPrice);
  return round2(unitPrice * (1 + rate.percent / 100));
}

/**
 * Resolve the disclosure text that should print on the receipt and appear
 * on shelf labels for a store on dual pricing. Falls back through:
 *   1. Store.dualPricingDisclosure (per-store override)
 *   2. State.surchargeDisclosureText (state default)
 *   3. Universal fallback
 */
export function resolveDisclosureText(
  store: { dualPricingDisclosure?: string | null; pricingModel?: string | null },
  state: { surchargeDisclosureText?: string | null } | null | undefined,
): string {
  if (store?.pricingModel !== 'dual_pricing') return '';
  if (store?.dualPricingDisclosure?.trim()) return store.dualPricingDisclosure.trim();
  if (state?.surchargeDisclosureText?.trim()) return state.surchargeDisclosureText.trim();
  return 'A cash discount is available on this transaction. ' +
         'Credit and debit transactions include a processing fee.';
}

/** Convert any number-ish input to number, returning null for blank/invalid. */
function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Round to 2 decimal places — standard money rounding for surcharge math. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// CARD_TENDERS exported for tests + reuse in cashier-app mirror.
export { CARD_TENDERS };
