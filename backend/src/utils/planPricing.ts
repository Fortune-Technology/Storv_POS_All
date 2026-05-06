/**
 * Plan Pricing — dynamic bundle pricing for Pro-style "everything included" plans.
 *
 * Resolution order (computeEffectivePlanPrice):
 *   1. priceOverride        → return verbatim (admin hand-tune, e.g. promo pricing)
 *   2. bundleDiscountPercent → compute (basePrice + Σ addonPrices) × (1 - pct/100)
 *   3. basePrice            → return as-is (Starter and other flat-priced plans)
 *
 * This is read by the seeder and any admin endpoint that mutates Starter base
 * price, addon prices, or bundle discount %. After mutation, the seeder/endpoint
 * should call recomputeBundlePlanBasePrices() to keep the persisted basePrice in
 * sync so reads (pricing page, billing math) stay O(1).
 */

export interface AddonLike {
  price: number | string | { toString(): string };
}

export interface PlanLike {
  basePrice: number | string | { toString(): string };
  bundleDiscountPercent?: number | string | { toString(): string } | null;
  priceOverride?: number | string | { toString(): string } | null;
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v) || 0;
  // Prisma Decimal — has .toString() that yields a clean numeric literal
  const s = (v as { toString(): string }).toString();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the bundle base price (before override).
 *
 *   bundleBase = sourceBase + Σ addonPrices
 *   discounted = bundleBase × (1 - pct/100)
 *
 * Returns the discounted value rounded to 2 decimals. When pct is null/0 or
 * addons is empty, this collapses to sourceBase (no discount applied).
 */
export function computeBundleBasePrice(
  sourceBase: number | string | { toString(): string },
  addons: AddonLike[],
  bundleDiscountPercent: number | string | { toString(): string } | null | undefined,
): number {
  const base = toNumber(sourceBase);
  const addonsTotal = (addons ?? []).reduce((sum, a) => sum + toNumber(a.price), 0);
  const pct = toNumber(bundleDiscountPercent);
  const bundleBase = base + addonsTotal;
  const factor = Math.max(0, 1 - pct / 100);
  return round2(bundleBase * factor);
}

/**
 * Effective price shown to customers. Honors override > computed > basePrice.
 *
 * For plans with no bundleDiscountPercent + no override, returns basePrice as-is.
 * For Pro: pass the Starter plan + Starter's addons as `source` + `addons` so
 * the discount is applied to the actual bundle, not to Pro's already-computed
 * basePrice (which would double-discount on every recompute).
 */
export function computeEffectivePlanPrice(
  plan: PlanLike,
  source?: PlanLike,
  addons?: AddonLike[],
): number {
  const override = plan.priceOverride;
  if (override !== null && override !== undefined && override !== '') {
    const n = toNumber(override);
    if (n > 0) return round2(n);
  }
  const pct = toNumber(plan.bundleDiscountPercent);
  if (pct > 0 && source) {
    return computeBundleBasePrice(source.basePrice, addons ?? [], pct);
  }
  return round2(toNumber(plan.basePrice));
}

/**
 * Convenience: for the Pro recompute path. Returns both the new basePrice and
 * the matching annualPrice (basePrice × 12) so the caller can write both atomically.
 */
export function computeBundlePlanPricing(
  source: PlanLike,
  addons: AddonLike[],
  bundleDiscountPercent: number | string | { toString(): string } | null | undefined,
  priceOverride?: number | string | { toString(): string } | null,
): { basePrice: number; annualPrice: number } {
  let basePrice: number;
  if (priceOverride !== null && priceOverride !== undefined && priceOverride !== '') {
    const n = toNumber(priceOverride);
    basePrice = n > 0 ? round2(n) : computeBundleBasePrice(source.basePrice, addons, bundleDiscountPercent);
  } else {
    basePrice = computeBundleBasePrice(source.basePrice, addons, bundleDiscountPercent);
  }
  return { basePrice, annualPrice: round2(basePrice * 12) };
}
