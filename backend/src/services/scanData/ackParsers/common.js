/**
 * common.js — Shared ack-parsing helpers (Session 48).
 *
 * Each manufacturer's ack file format is different but the SHAPE of the
 * parser output is identical so the reconciliation engine can stay
 * generic. Per-mfr parsers convert their flavour to this canonical shape.
 *
 * ─── Canonical ack-line shape ────────────────────────────────────────────
 *   {
 *     recordRef:   string,   // identifies the original line — typically `${txNumber}|${upc}`
 *                            // some mfrs send a sequence index — that's also valid
 *     status:      'accepted' | 'rejected' | 'warning' | 'unknown',
 *     reason:      string?,  // free-text rejection reason
 *     code:        string?,  // mfr-specific reject code (e.g. "E101")
 *     txNumber:    string?,  // parsed from recordRef when available
 *     upc:         string?,  // parsed from recordRef when available
 *     originalLine: string,  // the raw ack file line for audit
 *   }
 *
 * ─── Canonical parser output ─────────────────────────────────────────────
 *   {
 *     mfrCode:   string,                 // 'itg' | 'altria_pmusa' | 'rjr_edlp' | etc.
 *     fileName:  string?,                // ack filename if known (poller can pass)
 *     processedAt: Date?,                // timestamp from ack header if present
 *     summary: {
 *       acceptedCount: number,
 *       rejectedCount: number,
 *       warningCount:  number,
 *     },
 *     lines: AckLine[],                  // per-record details
 *     parseErrors: string[],             // lines we couldn't parse — logged, not thrown
 *   }
 */

// ── Status normalization ──────────────────────────────────────────────────
//
// Mfrs use different vocabulary: "OK" / "ACCEPT" / "PASS" → 'accepted',
// "FAIL" / "REJECT" / "ERROR" → 'rejected'. This helper maps to the
// canonical 4-value enum.
const ACCEPTED_TOKENS = new Set([
  'A', 'OK', 'ACCEPT', 'ACCEPTED', 'PASS', 'PASSED', '0', 'SUCCESS', 'P',
]);
const REJECTED_TOKENS = new Set([
  'R', 'FAIL', 'FAILED', 'REJECT', 'REJECTED', 'E', 'ERROR', '1', 'X',
]);
const WARNING_TOKENS = new Set([
  'W', 'WARN', 'WARNING', '2',
]);

export function normalizeStatus(token) {
  if (!token) return 'unknown';
  const upper = String(token).toUpperCase().trim();
  if (ACCEPTED_TOKENS.has(upper)) return 'accepted';
  if (REJECTED_TOKENS.has(upper)) return 'rejected';
  if (WARNING_TOKENS.has(upper))  return 'warning';
  return 'unknown';
}

// ── Record-ref builder ────────────────────────────────────────────────────
//
// Most mfrs return a `txNumber` + `upc` per line. Build a stable lookup key
// so the reconciliation engine can find the original record without doing
// O(n²) string matching.
export function buildRecordRef(txNumber, upc) {
  return `${(txNumber || '').trim()}|${(upc || '').trim()}`;
}

export function parseRecordRef(ref) {
  const parts = String(ref || '').split('|');
  return { txNumber: parts[0] || '', upc: parts[1] || '' };
}

// ── Line splitting (tolerant) ────────────────────────────────────────────
// Strips trailing CR (Windows endings), skips blank lines.
export function splitLines(content) {
  return String(content || '')
    .split('\n')
    .map(l => l.replace(/\r$/, ''))
    .filter(l => l.length > 0);
}

// ── Empty parser result (for ack files that hit a fatal parse error) ─────
export function emptyResult(mfrCode) {
  return {
    mfrCode,
    fileName: null,
    processedAt: null,
    summary: { acceptedCount: 0, rejectedCount: 0, warningCount: 0 },
    lines: [],
    parseErrors: [],
  };
}

// ── Aggregate summary from line array ────────────────────────────────────
export function summarize(lines) {
  let a = 0, r = 0, w = 0;
  for (const l of lines) {
    if (l.status === 'accepted') a++;
    else if (l.status === 'rejected') r++;
    else if (l.status === 'warning') w++;
  }
  return { acceptedCount: a, rejectedCount: r, warningCount: w };
}
