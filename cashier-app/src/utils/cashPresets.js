/**
 * Smart cash preset generator — shared between TenderModal and POSScreen.
 *
 * Rounds up to every useful denomination so the right amount always appears.
 * The $0.05 denomination ensures values like $26.94 → $26.95 are included.
 *
 * Examples:
 *   $6.09  → [$6.10, $6.25, $7, $10, $20, $50, $100]
 *   $19.67 → [$19.70, $19.75, $20, $50, $100]
 *   $26.94 → [$26.95, $27, $30, $50, $100]
 *   $156.61→ [$156.65, $156.75, $157, $160, $200]
 */
export function getSmartCashPresets(total) {
  if (!total || total <= 0) return [5, 10, 20, 50, 100];

  const round2  = (n) => Math.round(n * 100) / 100;
  const roundUp = (n, unit) => round2(Math.ceil(round2(n / unit)) * unit);

  const suggestions = new Set();

  // Round up to every standard denomination — $0.05 first so nearest nickel always shows
  for (const denom of [0.05, 0.25, 1, 5, 10, 20, 50, 100, 200]) {
    const rounded = roundUp(total, denom);
    if (rounded > total + 0.004) suggestions.add(rounded);
  }

  return Array.from(suggestions).sort((a, b) => a - b);
}

/**
 * Apply cash rounding to a change amount.
 * rounding: 'none' | '0.05'
 */
export function applyRounding(amount, rounding) {
  if (rounding === '0.05') {
    return Math.round(Math.round(amount * 100) / 5) * 5 / 100;
  }
  return Math.round(amount * 100) / 100;
}
