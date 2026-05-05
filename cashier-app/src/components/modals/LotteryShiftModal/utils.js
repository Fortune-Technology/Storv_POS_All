// LotteryShiftModal — shared helpers extracted from the main wizard file
// (May 2026 split). All exports are pure functions / constants — no
// component or DOM concerns.

export const fmtL = (n) => {
  const num = Number(n || 0);
  const r = Math.round(num * 100) / 100;
  return Math.abs(r - Math.round(r)) < 0.005
    ? `$${Math.round(r).toLocaleString()}`
    : `$${r.toFixed(2)}`;
};

export const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;

// May 2026 — input filter for ticket position. Allows:
//   • Digits only (e.g. "0", "5", "147")
//   • Exactly "-" (intermediate state, user is mid-typing the SO sentinel)
//   • Exactly "-1" (the soldout sentinel for descending direction)
// Rejects "-2", "-12", "1-2", letters, etc. Per user direction (May 2026):
// only -1 is valid as a negative; anything more negative is invalid input.
// For ascending books the SO sentinel is `totalTickets`, so negatives are
// always invalid for asc — backend will reject if cashier tries to save -1
// on an asc book.
export const numInput = (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return '';
  if (s === '-' || s === '-1') return s;
  return s.replace(/[^0-9]/g, '');
};

// Browser-local "today" — NOT UTC. Earlier `new Date().toISOString().slice(0, 10)`
// returned UTC date which broke after ~8pm in Western timezones — the wizard
// would stamp LotteryOnlineTotal under tomorrow's date and fetch authoritative
// total for tomorrow (returning $0 while local Step 1 sum showed actual sales).
// Browser-local matches the back-office in 95%+ of real-world deployments
// where the cashier register and back-office are in the same tz.
const _pad2 = (n) => String(n).padStart(2, '0');
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
};

// Slot-number comparator used for the EoD wizard's counter list. Books
// without a slot number fall to the end. Tiebreak by gameNumber + bookNumber
// so the order is stable when two books share a slot or both lack one.
export function byslot(a, b) {
  const sa = a?.slotNumber == null ? Number.MAX_SAFE_INTEGER : Number(a.slotNumber);
  const sb = b?.slotNumber == null ? Number.MAX_SAFE_INTEGER : Number(b.slotNumber);
  if (sa !== sb) return sa - sb;
  const ga = String(a?.game?.gameNumber || a?.gameNumber || '');
  const gb = String(b?.game?.gameNumber || b?.gameNumber || '');
  if (ga !== gb) return ga.localeCompare(gb);
  const ba = String(a?.boxNumber || '');
  const bb = String(b?.boxNumber || '');
  return ba.localeCompare(bb);
}

export const STEPS = ['Counter Scan', 'Online Sales', 'Confirm & Save'];
