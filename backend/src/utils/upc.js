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

  // ITF-14 → EAN-13 (strip packaging indicator digit)
  if (digits.length === 14) {
    set.add(digits.slice(1));                // standard: drop first digit
    set.add(digits.slice(2));                // some use 2-digit prefix (GTIN-14 → UPC-A)
    // Also try the inner 12 digits (common vendor barcode variation)
    set.add(digits.slice(1, 13));
    set.add(digits.slice(2, 14));
  }

  // ITF-14 packaging variants: if UPC-A/EAN-13, generate ITF-14 with indicator digits 1-8
  // This helps match when invoice has case barcode but POS has unit barcode
  if (digits.length === 12 || digits.length === 13) {
    const base = digits.length === 12 ? '0' + digits : digits;
    for (let indicator = 1; indicator <= 8; indicator++) {
      set.add(indicator + base);  // 14-digit ITF-14 variant
    }
  }

  // Without check digit (some invoice / vendor systems strip it)
  if (digits.length >= 8) {
    const noCheck = digits.slice(0, -1);
    set.add(noCheck);
    const noCheckStripped = noCheck.replace(/^0+/, '');
    if (noCheckStripped) set.add(noCheckStripped);
  }

  // With check digit appended (GS1 check digit calculation)
  if (digits.length === 11 || digits.length === 12) {
    const withCheck = digits + calcCheckDigit(digits);
    set.add(withCheck);
    if (digits.length === 11) set.add('0' + withCheck); // → EAN-13
  }

  // Common vendor truncations: some invoices list only last 5-6 significant digits
  if (digits.length >= 12) {
    set.add(digits.slice(-6));  // last 6
    set.add(digits.slice(-8));  // last 8
  }

  return [...set].filter(v => v.length >= 5);
}

/**
 * Calculate GS1 check digit for a UPC/EAN string.
 * Works for UPC-A (11 digits → 12th check digit) and EAN-13 (12 digits → 13th).
 */
export function calcCheckDigit(digits) {
  const d = String(digits).replace(/\D/g, '');
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    const weight = (d.length - i) % 2 === 0 ? 1 : 3;
    sum += parseInt(d[i]) * weight;
  }
  return String((10 - (sum % 10)) % 10);
}

/**
 * Extract size/pack info from a description string.
 * Returns { size, unit, packSize } or null.
 * Examples: "12PK 12OZ CANS" → { packSize: 12, size: 12, unit: 'oz' }
 *           "750ML" → { size: 750, unit: 'ml' }
 */
export function extractSizeFromDescription(desc) {
  if (!desc) return null;
  const d = desc.toUpperCase();

  // Pack size: "12PK", "6-PACK", "24CT"
  const packMatch = d.match(/(\d+)\s*(?:PK|PACK|CT|COUNT)/);
  const packSize = packMatch ? parseInt(packMatch[1]) : null;

  // Size: "12OZ", "750ML", "1.5L", "1GAL"
  const sizeMatch = d.match(/(\d+\.?\d*)\s*(OZ|FL\.?OZ|ML|L|LTR|LITER|GAL|LB|G|KG)/);
  const size = sizeMatch ? parseFloat(sizeMatch[1]) : null;
  const unit = sizeMatch ? sizeMatch[2].replace(/\./g, '').toLowerCase() : null;

  if (!packSize && !size) return null;
  return { packSize, size, unit };
}
