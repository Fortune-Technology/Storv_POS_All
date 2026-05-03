/**
 * rjrScanData.ts — RJR Scan Data Reporting feed.
 *
 * Same fixed-width body as EDLP but flagged 'SCAN' in the format-version
 * header field. This feed reports POS sales for category-insight purposes
 * (no funded promos), so buydown/multipack columns are typically zero.
 */

import { formatRJR, type FormatInput, type FormatResult } from './rjrEdlp.js';

export function format(args: FormatInput): FormatResult {
  return formatRJR({ ...args, feedCode: 'SCAN' });
}
