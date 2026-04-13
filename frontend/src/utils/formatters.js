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
