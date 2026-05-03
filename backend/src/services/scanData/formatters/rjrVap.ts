/**
 * rjrVap.ts — RJR Valued Adult Program (smokeless / pouch) feed.
 *
 * Same fixed-width body as EDLP but flagged 'VAP'. Brand families are
 * Grizzly + Camel Snus only.
 */

import { formatRJR, type FormatInput, type FormatResult } from './rjrEdlp.js';

export function format(args: FormatInput): FormatResult {
  return formatRJR({ ...args, feedCode: 'VAP' });
}
