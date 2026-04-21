// State adapter contract. Every state's adapter module must export an object
// matching this shape. The scan engine and settlement engine call these
// functions without knowing which state is active.
//
// Scan codes fall into two categories:
//   - "ticket" : a single scratch ticket's barcode (identifies ticket position)
//   - "book"   : a pack-level barcode, used at receive/activate time
//
// parseAny(raw) returns the richer object; parseTicketBarcode / parseBookBarcode
// are thin wrappers for callers that only care about one shape.

/**
 * Normalise a raw scan to a single-line, whitespace-free string.
 * Handles leading/trailing whitespace, embedded spaces (EAN-13 scanners add
 * spaces between guard patterns), and common punctuation.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalize(raw) {
  if (raw == null) return '';
  return String(raw).trim().replace(/\s+/g, '');
}

/**
 * Helper for adapters. Wraps parseAny with the typed-filter wrappers.
 * Each adapter calls `makeAdapter({ code, name, parseAny, weekStartDay, settlementRules })`.
 */
export function makeAdapter(cfg) {
  const { parseAny } = cfg;
  return {
    ...cfg,
    parseTicketBarcode(raw) {
      const r = parseAny(raw);
      return r && r.type === 'ticket' ? r : null;
    },
    parseBookBarcode(raw) {
      const r = parseAny(raw);
      return r && r.type === 'book' ? r : null;
    },
  };
}
