// LotteryBackOffice — shared helpers (May 2026 split). Pure functions.

export const fmtMoney = (n) => n == null ? '$0.00' : `$${Number(n).toFixed(2)}`;

// Lottery-specific money formatter — tickets are whole-dollar prices
// ($1/$2/$5/$10/$20/$30/$50), so sums are always whole. Strip the .00
// trailing zeros for cleaner display ($769 instead of $769.00). Only
// shows decimals when an actual cent value exists (e.g. $1113.82 from
// mixed cart with tax — that keeps its full precision).
export const fmtLottery = (n) => {
  if (n == null) return '$0';
  const num = Number(n);
  const rounded = Math.round(num * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 0.005) {
    return `$${Math.round(rounded).toLocaleString()}`;
  }
  return `$${rounded.toFixed(2)}`;
};

export const fmtInt   = (n) => n == null ? '0' : Number(n).toLocaleString();
export const pad2     = (n) => String(n).padStart(2, '0');
export const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

// Browser-local "today" — NOT UTC. Earlier `new Date().toISOString().slice(0, 10)`
// returned UTC date which broke after ~8pm in Western timezones (page opened to
// tomorrow → empty data). Browser-local matches the store's tz in 95%+ of
// real-world deployments where the manager + store are in the same tz.
export const todayStr = () => toDateStr(new Date());

export function fmtDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' });
}

export function guessPack(price) {
  const p = Number(price || 0);
  if (p <= 1)  return 300;
  if (p <= 2)  return 200;
  if (p <= 3)  return 200;
  if (p <= 5)  return 100;
  if (p <= 10) return 50;
  if (p <= 20) return 30;
  if (p <= 30) return 20;
  return 10;
}
