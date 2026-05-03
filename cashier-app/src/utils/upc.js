/**
 * upc.js — UPC / EAN normalization utility (cashier-app / browser)
 *
 * Identical logic to backend/src/utils/upc.js — kept in sync manually.
 * Cannot share via import because cashier-app has no access to backend src.
 *
 * normalizeUPC('0 80686 00637 4')  → '0080686006374'
 * normalizeUPC('080686006374')     → '0080686006374'
 * normalizeUPC('0080686006374')    → '0080686006374'
 */

function expandUPCE(upce) {
  const d = String(upce).padStart(6, '0').split('');
  const last = d[5];
  switch (last) {
    case '0': case '1': case '2':
      return `${d[0]}${d[1]}${d[2]}${last}0000${d[3]}${d[4]}`;
    case '3':
      return `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`;
    case '4':
      return `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}00000`;
    default:
      return `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}${last}0000`;
  }
}

export function normalizeUPC(raw) {
  if (raw == null || raw === '') return null;
  const digits = String(raw).replace(/[\s\-\.]/g, '').replace(/\D/g, '');
  if (!digits) return null;

  switch (digits.length) {
    case 6:  return ('0' + expandUPCE(digits)).padStart(13, '0');
    case 8:  return digits.padStart(13, '0');
    case 12: return '0' + digits;
    case 13: return digits;
    case 14: return digits.slice(1);
    default: return digits.length > 0 ? digits : null;
  }
}

export function upcVariants(raw) {
  if (raw == null || raw === '') return [];
  const digits = String(raw).replace(/[\s\-\.]/g, '').replace(/\D/g, '');
  if (!digits) return [];

  // Short codes (2-5 digits) are store-assigned product identifiers cashiers
  // type on the keypad (e.g. `299`). Exact-match only — don't expand via
  // padding/stripping, which would either explode lookups or false-positive
  // against long UPCs sharing the same digits.
  if (digits.length < 6) return [digits];

  const set = new Set();
  set.add(digits);

  const normalized = normalizeUPC(digits);
  if (normalized) set.add(normalized);

  const stripped = digits.replace(/^0+/, '') || '0';
  set.add(stripped);

  if (digits.length === 13 && digits[0] === '0') {
    set.add(digits.slice(1));
    const s2 = digits.slice(1).replace(/^0+/, '');
    if (s2) set.add(s2);
  }

  if (digits.length === 12) set.add('0' + digits);
  if (digits.length === 14) set.add(digits.slice(1));

  if (digits.length >= 8) {
    const noCheck = digits.slice(0, -1);
    set.add(noCheck);
    const noCheckStripped = noCheck.replace(/^0+/, '');
    if (noCheckStripped) set.add(noCheckStripped);
  }

  return [...set].filter(v => v.length >= 2);
}
