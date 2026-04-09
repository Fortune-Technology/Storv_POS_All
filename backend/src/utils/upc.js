/**
 * upc.js — UPC / EAN normalization utility
 *
 * Industry standard: store everything as EAN-13 (13 digits, zero-padded).
 * This makes UPC-A (12), EAN-8 (8), UPC-E (6), and ITF-14 (14) all
 * interoperable — a scanner can emit any format and still match.
 *
 * Usage:
 *   import { normalizeUPC, upcVariants } from '../utils/upc.js';
 *
 *   normalizeUPC('0 80686 00637 4')  → '0080686006374'  (spaces stripped, padded)
 *   normalizeUPC('080686006374')     → '0080686006374'  (UPC-A → EAN-13)
 *   normalizeUPC('0080686006374')    → '0080686006374'  (already EAN-13)
 *   normalizeUPC('00080686006374')   → '0080686006374'  (ITF-14 → EAN-13)
 */

/**
 * Expand a 6-digit UPC-E to 12-digit UPC-A.
 * Algorithm per GS1 specification.
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

/**
 * Normalize any barcode string to EAN-13 (13 digits).
 *
 * Handles:
 *   - Spaces, dashes, dots between digit groups (printed labels)
 *   - UPC-E  (6 digits)  → expand to UPC-A → pad to EAN-13
 *   - EAN-8  (8 digits)  → pad to EAN-13
 *   - UPC-A  (12 digits) → pad to EAN-13
 *   - EAN-13 (13 digits) → unchanged
 *   - ITF-14 (14 digits) → strip leading digit → EAN-13
 *
 * Returns null if the input is empty or non-numeric after cleaning.
 */
export function normalizeUPC(raw) {
  if (raw == null || raw === '') return null;

  // Strip spaces, dashes, dots (common in printed/typed UPCs)
  const digits = String(raw).replace(/[\s\-\.]/g, '').replace(/\D/g, '');

  if (!digits) return null;

  switch (digits.length) {
    case 6:  return ('0' + expandUPCE(digits)).padStart(13, '0');
    case 8:  return digits.padStart(13, '0');
    case 12: return '0' + digits;
    case 13: return digits;
    case 14: return digits.slice(1);   // ITF-14: drop leading digit
    default:
      // Unknown length — return digits-only without padding (don't corrupt)
      return digits.length > 0 ? digits : null;
  }
}

/**
 * Generate every plausible variant of a UPC for DB lookups.
 * Covers: the normalized form, UPC-A, stripped leading zeros, raw.
 *
 * Use this when querying so that no matter how a UPC was stored
 * in the past, the lookup still finds it.
 */
export function upcVariants(raw) {
  if (raw == null || raw === '') return [];

  const digits = String(raw).replace(/[\s\-\.]/g, '').replace(/\D/g, '');
  if (!digits || digits.length < 6) return [];

  const set = new Set();

  // Always include the raw digits-only form
  set.add(digits);

  // Normalized EAN-13
  const normalized = normalizeUPC(digits);
  if (normalized) set.add(normalized);

  // Strip all leading zeros
  const stripped = digits.replace(/^0+/, '') || '0';
  set.add(stripped);

  // EAN-13 → UPC-A  (drop leading zero)
  if (digits.length === 13 && digits[0] === '0') {
    set.add(digits.slice(1));
    const s2 = digits.slice(1).replace(/^0+/, '');
    if (s2) set.add(s2);
  }

  // UPC-A → EAN-13  (add leading zero)
  if (digits.length === 12) set.add('0' + digits);

  // ITF-14 → EAN-13
  if (digits.length === 14) set.add(digits.slice(1));

  // Without check digit (some invoice / vendor systems strip it)
  if (digits.length >= 8) {
    const noCheck = digits.slice(0, -1);
    set.add(noCheck);
    const noCheckStripped = noCheck.replace(/^0+/, '');
    if (noCheckStripped) set.add(noCheckStripped);
  }

  return [...set].filter(v => v.length >= 6);
}
