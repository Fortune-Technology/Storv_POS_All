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

// ── Public domain shapes ────────────────────────────────────────────────────

export type StateCode = 'MA' | 'ME' | string;

/** A successfully-parsed ticket-level scan. */
export interface ParsedTicket {
  type: 'ticket';
  gameNumber: string;
  bookNumber: string;
  ticketNumber: number;
  state: StateCode;
  /** Optional state-specific fields. */
  checkDigit?: string;
  packSize?: number | null;
  source?: string;
  /** Pass-through bag for state-specific extras. */
  [extra: string]: unknown;
}

/** A successfully-parsed book-/pack-level scan. */
export interface ParsedBook {
  type: 'book';
  gameNumber?: string;
  bookNumber?: string;
  state: StateCode;
  checkDigit?: string;
  bookCode?: string;
  packSize?: number | null;
  source?: string;
  [extra: string]: unknown;
}

export type ParseResult = ParsedTicket | ParsedBook | null;

/** Settlement rules attached to each adapter. */
export interface SettlementRules {
  pctThreshold: number | null;
  maxDaysActive: number | null;
}

/** Config a concrete state adapter passes into `makeAdapter`. */
export interface AdapterConfig {
  code: StateCode;
  name: string;
  parseAny: (raw: unknown) => ParseResult;
  /** 0 = Sunday, 1 = Monday, … */
  weekStartDay: number;
  settlementRules: SettlementRules;
}

/** What `makeAdapter` returns — the contract every adapter exposes. */
export interface StateAdapter extends AdapterConfig {
  parseTicketBarcode: (raw: unknown) => ParsedTicket | null;
  parseBookBarcode:   (raw: unknown) => ParsedBook | null;
}

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
 */
export function normalize(raw: unknown): string {
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
export function makeAdapter(cfg: AdapterConfig): StateAdapter {
  const { parseAny } = cfg;
  return {
    ...cfg,
    parseTicketBarcode(raw: unknown): ParsedTicket | null {
      const r = parseAny(raw);
      return r && r.type === 'ticket' ? r : null;
    },
    parseBookBarcode(raw: unknown): ParsedBook | null {
      const r = parseAny(raw);
      return r && r.type === 'book' ? r : null;
    },
  };
}
