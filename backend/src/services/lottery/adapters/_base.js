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
 * spaces between guard patterns), and common scanner-emitted prefix chars.
 *
 * Why the leading-prefix strip:
 *   Some scanner firmware is configured to emit a "start-of-data" marker
 *   such as `~`, `*`, `>`, `|` or an AIM symbology prefix before the
 *   payload. Real MA QR / Data Matrix payloads are pure digits (possibly
 *   with dashes), so any non-alphanumeric leading char is safe to drop.
 *
 *   Observed live samples with `~` prefix (SureSTS etc.):
 *     ~38705740670045005000000000080 → game 387, book 574067, ticket 4, pack 50
 *     ~52300200080872010000000000057 → game 523, book 020008, ticket 87, pack 100
 *   After stripping, the standard regexes parse them cleanly.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalize(raw) {
  if (raw == null) return '';
  return String(raw)
    .trim()
    .replace(/\s+/g, '')
    .replace(/^[^a-zA-Z0-9]+/, '');   // strip scanner-added leading prefix chars
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
