/**
 * Pure tax calculation utilities.
 * No side effects — safe to unit test.
 *
 * Session 56b — `computeTax` and `matchesTaxClass` were removed when the
 * legacy class matcher was deleted. The cart's authoritative tax math now
 * lives in `selectTotals` in `useCartStore.js`, which uses the 2-tier
 * resolution chain (per-product taxRuleId → department-linked rule).
 * This file kept only because `round2` is imported by `useCartStore.js`.
 */

export function round2(n) {
  return Math.round(n * 100) / 100;
}
