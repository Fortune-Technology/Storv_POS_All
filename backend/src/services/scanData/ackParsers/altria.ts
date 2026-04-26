/**
 * altria.ts — Altria ack-file parser (PMUSA / USSTC / Middleton).
 *
 * Altria returns pipe-delimited ack files closely mirroring their submission
 * format. All 3 sub-feeds share a single response format:
 *
 *   H|<retailerId>|<feedCode>|<originalFile>|<processedAt>|PMUSA-ACK-3.5
 *   R|<txNumber>|<upc>|<status>|<rejectCode>|<reasonText>
 *   T|<acceptedCount>|<rejectedCount>|<totalProcessed>|<batchAccepted>
 *
 * The `batchAccepted` trailer flag is Altria-specific: 'Y' = the whole
 * batch was accepted, 'N' = whole batch rejected (their strict-cert rule).
 *
 * The same parser handles all 3 feeds — the per-feed differences are
 * cosmetic (feedCode in header) and don't affect line-level matching.
 */

import {
  splitLines, normalizeStatus, buildRecordRef, summarize, emptyResult,
  type AckResult, type AckLine,
} from './common.js';

export function parseAck(
  content: unknown,
  fileName: string | null = null,
  mfrCode = 'altria_pmusa',
): AckResult {
  const result = emptyResult(mfrCode);
  result.fileName = fileName;
  // Altria-specific extra: trailer flag indicating whole-batch accept/reject.
  // Stays undefined when the trailer didn't carry the flag.
  result.batchAccepted = undefined;

  const lines = splitLines(content);
  if (lines.length === 0) {
    result.parseErrors.push('Empty ack file');
    return result;
  }

  for (const raw of lines) {
    const fields = raw.split('|');
    const recordType = fields[0]?.toUpperCase();

    if (recordType === 'H') {
      // H|retailerId|feedCode|originalFile|processedAt|version
      const ts = fields[4];
      if (ts) {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) result.processedAt = d;
      }
      continue;
    }

    if (recordType === 'T') {
      // T|accepted|rejected|total|batchAccepted
      const batchFlag = fields[4]?.toUpperCase();
      if (batchFlag === 'Y' || batchFlag === 'N') result.batchAccepted = batchFlag === 'Y';
      continue;
    }

    if (recordType === 'R') {
      // R|txNumber|upc|status|rejectCode|reasonText
      const txNumber = fields[1] || '';
      const upc      = fields[2] || '';
      const status   = normalizeStatus(fields[3]);
      const code     = fields[4] || undefined;
      const reason   = fields[5] || undefined;

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

    result.parseErrors.push(`Unrecognised record type: "${recordType}" — line: ${raw.slice(0, 80)}`);
  }

  result.summary = summarize(result.lines);

  // Altria's strict-batch rule: if Altria flagged batchAccepted=N, force every
  // accepted-status line to rejected with the batch-level reason. This keeps
  // the reconciliation engine simple — it just iterates lines and updates
  // redemptions per status.
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
