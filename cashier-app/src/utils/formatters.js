export const fmt$ = (n) =>
  n == null ? '—' : '$' + Number(n).toFixed(2);

export const fmtQty = (n) =>
  Number.isInteger(n) ? String(n) : Number(n).toFixed(2);

export const fmtDate = (d) => {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const fmtTime = (d) => {
  const date = d ? (d instanceof Date ? d : new Date(d)) : new Date();
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

export const fmtTxNumber = (n) => n || '—';

/* ─────────────────────────────────────────────────────────────────────────
 * Standardized number formatters — mirror `backend/src/utils/validators.ts`
 * and the portal's `frontend/src/utils/formatters.js`. Use these for forms
 * + receipt rendering where you need a raw number string with consistent
 * precision (no "—" placeholder for missing values).
 * ─────────────────────────────────────────────────────────────────────── */

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

/** "$12.50" */
export function formatMoneyDisplay(n) {
  return `$${formatMoney(n)}`;
}

/** "3.999 gal" */
export function formatFuelDisplay(n) {
  return `${formatFuel(n)} gal`;
}
