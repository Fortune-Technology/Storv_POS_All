/**
 * common.ts — Shared ack-parsing helpers (Session 48).
 *
 * Each manufacturer's ack file format is different but the SHAPE of the
 * parser output is identical so the reconciliation engine can stay
 * generic. Per-mfr parsers convert their flavour to this canonical shape.
 */

// ── Public types ───────────────────────────────────────────────────────────

export type AckStatus = 'accepted' | 'rejected' | 'warning' | 'unknown';

/** A single ack line in canonical form. */
export interface AckLine {
  recordRef: string;
  status: AckStatus;
  reason?: string;
  code?: string;
  txNumber?: string;
  upc?: string;
  originalLine: string;
  [extra: string]: unknown;
}

export interface AckSummary {
  acceptedCount: number;
  rejectedCount: number;
  warningCount: number;
}

/** Canonical parser output — every per-mfr parser returns this shape. */
export interface AckResult {
  mfrCode: string;
  fileName: string | null;
  processedAt: Date | null;
  summary: AckSummary;
  lines: AckLine[];
  parseErrors: string[];
  /** Set by Altria/RJR when the trailer indicates batch-level rejection. */
  batchAccepted?: boolean;
}

// ── Status normalization ──────────────────────────────────────────────────
//
// Mfrs use different vocabulary: "OK" / "ACCEPT" / "PASS" → 'accepted',
// "FAIL" / "REJECT" / "ERROR" → 'rejected'. This helper maps to the
// canonical 4-value enum.
const ACCEPTED_TOKENS = new Set<string>([
  'A', 'OK', 'ACCEPT', 'ACCEPTED', 'PASS', 'PASSED', '0', 'SUCCESS', 'P',
]);
const REJECTED_TOKENS = new Set<string>([
  'R', 'FAIL', 'FAILED', 'REJECT', 'REJECTED', 'E', 'ERROR', '1', 'X',
]);
const WARNING_TOKENS = new Set<string>([
  'W', 'WARN', 'WARNING', '2',
]);

export function normalizeStatus(token: unknown): AckStatus {
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
export function buildRecordRef(txNumber: string | null | undefined, upc: string | null | undefined): string {
  return `${(txNumber || '').trim()}|${(upc || '').trim()}`;
}

export function parseRecordRef(ref: string | null | undefined): { txNumber: string; upc: string } {
  const parts = String(ref || '').split('|');
  return { txNumber: parts[0] || '', upc: parts[1] || '' };
}

// ── Line splitting (tolerant) ────────────────────────────────────────────
// Strips trailing CR (Windows endings), skips blank lines.
export function splitLines(content: unknown): string[] {
  return String(content || '')
    .split('\n')
    .map((l: string) => l.replace(/\r$/, ''))
    .filter((l: string) => l.length > 0);
}

// ── Empty parser result (for ack files that hit a fatal parse error) ─────
export function emptyResult(mfrCode: string): AckResult {
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
export function summarize(lines: AckLine[]): AckSummary {
  let a = 0, r = 0, w = 0;
  for (const l of lines) {
    if (l.status === 'accepted') a++;
    else if (l.status === 'rejected') r++;
    else if (l.status === 'warning') w++;
  }
  return { acceptedCount: a, rejectedCount: r, warningCount: w };
}
