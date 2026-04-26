/**
 * rjr.ts — RJR / RAI ack-file parser (EDLP / ScanData / VAP).
 *
 * RJR returns FIXED-WIDTH ack files (matching their submission format).
 * One parser handles all 3 RJR programs — the program differs only in the
 * format-version field of the header.
 *
 * Layout (positions 1-indexed):
 *   Header (60 chars):
 *     1     1   recordType        'H'
 *     2     8   retailerId
 *     10    32  originalFileName
 *     42    8   processedDate     YYYYMMDD
 *     50    6   processedTime     HHMMSS
 *     56    5   formatVersion     'EDLP1' / 'SCAN1' / 'VAP1' / 'AKEDLP'
 *
 *   Detail (~150 chars, mirrors the submission Sale record):
 *     1     1   recordType        'R'
 *     2     14  txId              right-pad spaces
 *     16    12  upc               left-pad zeros
 *     28    1   status            'A' (accepted) | 'R' (rejected)
 *     29    8   rejectCode        e.g. "E101"
 *     37    100 reasonText        right-pad spaces
 *
 *   Trailer (~50 chars):
 *     1     1   recordType        'T'
 *     2     8   acceptedCount
 *     10    8   rejectedCount
 *     18    8   totalProcessed
 *     26    1   batchStatus       'A' / 'R'
 */

import {
  splitLines, normalizeStatus, buildRecordRef, summarize, emptyResult,
  type AckResult, type AckLine,
} from './common.js';

const slice = (s: unknown, start: number, len: number): string =>
  String(s || '').slice(start, start + len);
const trim  = (s: unknown): string => String(s || '').trim();

export function parseAck(
  content: unknown,
  fileName: string | null = null,
  mfrCode = 'rjr_edlp',
): AckResult {
  const result = emptyResult(mfrCode);
  result.fileName = fileName;
  result.batchAccepted = undefined;

  const lines = splitLines(content);
  if (lines.length === 0) {
    result.parseErrors.push('Empty ack file');
    return result;
  }

  for (const raw of lines) {
    const recordType = raw[0]?.toUpperCase();

    if (recordType === 'H') {
      const dateStr = slice(raw, 41, 8);
      const timeStr = slice(raw, 49, 6);
      if (/^\d{8}$/.test(dateStr) && /^\d{6}$/.test(timeStr)) {
        const iso = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}T${timeStr.slice(0,2)}:${timeStr.slice(2,4)}:${timeStr.slice(4,6)}Z`;
        const d = new Date(iso);
        if (!isNaN(d.getTime())) result.processedAt = d;
      }
      continue;
    }

    if (recordType === 'T') {
      const batchFlag = raw[25]?.toUpperCase();
      if (batchFlag === 'A' || batchFlag === 'R') {
        result.batchAccepted = batchFlag === 'A';
      }
      continue;
    }

    if (recordType === 'R') {
      const txNumber = trim(slice(raw, 1, 14));
      const upc      = trim(slice(raw, 15, 12));
      const status   = normalizeStatus(slice(raw, 27, 1));
      const code     = trim(slice(raw, 28, 8)) || undefined;
      const reason   = trim(slice(raw, 36, 100)) || undefined;

      const line: AckLine = {
        recordRef: buildRecordRef(txNumber, upc),
        status,
        reason: status === 'accepted' ? undefined : reason,
        code:   status === 'accepted' ? undefined : code,
        txNumber,
        upc,
        originalLine: raw,
      };
      result.lines.push(line);
      continue;
    }

    result.parseErrors.push(`Unrecognised record type at col 1: "${recordType}" — line: ${raw.slice(0, 80)}`);
  }

  result.summary = summarize(result.lines);

  // Same batch-rejection escalation as Altria
  if (result.batchAccepted === false) {
    for (const l of result.lines) {
      if (l.status === 'accepted') {
        l.status = 'rejected';
        l.code = l.code || 'BATCH_REJECTED';
        l.reason = l.reason || 'Entire batch rejected by mfr; see ack header.';
      }
    }
    result.summary = summarize(result.lines);
  }

  return result;
}
