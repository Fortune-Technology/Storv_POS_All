/**
 * Shared formatting utilities — single source of truth.
 * Import these instead of defining local fmt/fmtDate/todayStr functions.
 */

/** Format number as currency: $1,234.56 */
export function fmt$(n) {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Format number as simple currency: $1234.56 (no comma) */
export function fmtMoney(n) {
  if (n == null) return '—';
  return '$' + Number(n).toFixed(2);
}

/** Format percentage: 5.0% */
export function fmtPct(n) {
  if (n == null) return '—';
  return `${Number(n).toFixed(1)}%`;
}

/** Format date: "Apr 10, 2026" */
export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Format date+time: "Apr 10, 02:30 PM" */
export function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Format time only: "02:30 PM" */
export function fmtTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/** Today as ISO string: "2026-04-10" */
export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** First of current month: "2026-04-01" */
export function firstOfMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Convert Date to ISO date string: "2026-04-10" */
export function toDateStr(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/** Format duration in minutes: "2h 14m" */
export function fmtDuration(mins) {
  if (!mins && mins !== 0) return '—';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Format large numbers: 1.2K, 3.4M */
export function fmtCompact(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Standardized number formatters — mirror `backend/src/utils/validators.ts`
 * so a value formatted client-side and one returned from the API render
 * identically. Use these for FORM inputs and reports where you need a raw
 * number string (no "—" placeholder).
 *
 *   formatMoney(n)     → "12.50"        (always 2 decimals)
 *   formatFuel(n)      → "3.999"        (always 3 decimals)
 *   formatCount(n)     → "12"           (integer)
 *   formatPercent(0.05) → "5.00%"
 *
 * Existing fmt$/fmtMoney/fmtPct keep their "—" placeholder behavior — those
 * are tuned for table cells where a missing value should be visually
 * distinct.
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
