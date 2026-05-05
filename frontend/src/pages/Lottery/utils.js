// Lottery — shared helpers (May 2026 split). Pure functions extracted
// from the original Lottery.jsx so each tab/component can import only
// what it needs.

export const fmt = (n) => n == null ? 'N/A' : `$${Number(n).toFixed(2)}`;
export const fmtNum = (n) => n == null ? 'N/A' : Number(n).toLocaleString();

// Browser-local date string — NOT UTC. Earlier `d.toISOString().slice(0, 10)`
// returned UTC date which broke after ~8pm in Western timezones (Reports tab
// opened with `dateTo = tomorrow` → next day shown empty). Browser-local
// matches the store's tz in 95%+ of real-world deployments.
export const pad2 = (n) => String(n).padStart(2, '0');
export const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const todayStr = () => toDateStr(new Date());
export const daysAgoStr = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toDateStr(d); };

export const statusColor = (s) => ({
  inventory: 'lt-badge-blue',
  active: 'lt-badge-brand',
  depleted: 'lt-badge-amber',
  settled: 'lt-badge-gray',
}[s] || 'lt-badge-gray');

export const requestStatusClass = (s) => ({
  pending: 'lt-badge-amber',
  approved: 'lt-badge-green',
  rejected: 'lt-badge-red',
}[s] || 'lt-badge-gray');

/* US States + Canadian Provinces */
export const ALL_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
  'ON', 'BC', 'AB', 'MB', 'SK', 'QC', 'NS', 'NB', 'PE', 'NL', 'YT', 'NT', 'NU',
];
