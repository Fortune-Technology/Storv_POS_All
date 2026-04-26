/**
 * altriaMiddleton.ts — Altria John Middleton (Cigars) feed formatter.
 *
 * Same body as PMUSA but feedCode='MIDDLETON'. Single brand family
 * (Black & Mild) but the structure carries the brand field for forward
 * compatibility if Middleton expands.
 */

import { formatAltria, type FormatInput, type FormatResult } from './altriaPmusa.js';

export function format(args: FormatInput): FormatResult {
  return formatAltria({ ...args, feedCode: 'MIDDLETON' });
}
