/**
 * Shared display formatters — admin-app.
 *
 * Mirrors `backend/src/utils/validators.ts` and
 * `frontend/src/utils/formatters.js` so a value formatted in any of the 3
 * apps + the API renders identically.
 */

/** Money — always 2 decimals. Returns "0.00" for null/NaN. */
export function formatMoney(n) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '0.00';
  return v.toFixed(2);
}

/** Fuel — always 3 decimals. Returns "0.000" for null/NaN. */
export function formatFuel(n) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '0.000';
  return v.toFixed(3);
}

/** Count — integer only. Returns "0" for null/NaN. */
export function formatCount(n) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '0';
  return String(Math.trunc(v));
}

/** "$12.50" — money with explicit symbol. */
export function formatMoneyDisplay(n) {
  return `$${formatMoney(n)}`;
}

/** "3.999 gal" — fuel with explicit unit. */
export function formatFuelDisplay(n) {
  return `${formatFuel(n)} gal`;
}

/** Count with locale-thousands grouping (12345 → "12,345"). */
export function formatCountDisplay(n) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '0';
  return Math.trunc(v).toLocaleString('en-US');
}

/** Percent — 2 decimals default. `formatPercent(0.05)` → "5.00%". */
export function formatPercent(n, decimals = 2) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '0%';
  return `${(v * 100).toFixed(decimals)}%`;
}

export default {
  formatMoney,
  formatFuel,
  formatCount,
  formatMoneyDisplay,
  formatFuelDisplay,
  formatCountDisplay,
  formatPercent,
};
