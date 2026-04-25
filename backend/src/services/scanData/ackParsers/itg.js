/**
 * itg.js — ITG Brands ack-file parser (Session 48).
 *
 * ITG returns pipe-delimited ack files with one record per submitted line:
 *
 *   H|<retailerId>|<originalFile>|<processedAt>|ITG-ACK-1.0
 *   A|<txNumber>|<upc>|ACCEPTED
 *   A|<txNumber>|<upc>|REJECTED|<reason text>
 *   A|<txNumber>|<upc>|REJECTED|E101|Invalid UPC format
 *   T|<acceptedCount>|<rejectedCount>|<totalProcessed>
 *
 * Tolerant: extra trailing fields are kept in `originalLine` for audit;
 * unrecognised record-type letters are skipped (parseError logged).
 */

import { splitLines, normalizeStatus, buildRecordRef, summarize, emptyResult } from './common.js';

export function parseAck(content, fileName = null) {
  const result = emptyResult('itg');
  result.fileName = fileName;

  const lines = splitLines(content);
  if (lines.length === 0) {
    result.parseErrors.push('Empty ack file');
    return result;
  }

  for (const raw of lines) {
    const fields = raw.split('|');
    const recordType = fields[0]?.toUpperCase();

    if (recordType === 'H') {
      // Header: H|retailerId|originalFile|processedAt|version
      const ts = fields[3];
      if (ts) {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) result.processedAt = d;
      }
      continue;
    }

    if (recordType === 'T') {
      // Trailer — counts already aggregated in `summary`, ignore mfr-reported values
      continue;
    }

    if (recordType === 'A') {
      // Detail: A|txNumber|upc|STATUS[|reasonOrCode][|reasonText]
      const txNumber = fields[1] || '';
      const upc      = fields[2] || '';
      const status   = normalizeStatus(fields[3]);
      const fourth   = fields[4] || '';
      const fifth    = fields[5] || '';

      // If status is rejected, fields[4] could be either a reason code or
      // free-text reason. Convention: short ALL-CAPS+digits = code (e.g. "E101"),
      // otherwise treat as reason text.
      let code = null, reason = null;
      if (status === 'rejected' || status === 'warning') {
        if (fourth && /^[A-Z0-9_-]{1,8}$/.test(fourth)) {
          code   = fourth;
          reason = fifth || null;
        } else if (fourth) {
          reason = fourth;
        }
      }

      result.lines.push({
        recordRef: buildRecordRef(txNumber, upc),
        status,
        reason,
        code,
        txNumber,
        upc,
        originalLine: raw,
      });
      continue;
    }

    // Unknown record type — log but keep going
    result.parseErrors.push(`Unrecognised record type: "${recordType}" — line: ${raw.slice(0, 80)}`);
  }

  result.summary = summarize(result.lines);
  return result;
}
