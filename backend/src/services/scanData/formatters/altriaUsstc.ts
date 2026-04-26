/**
 * altriaUsstc.ts — Altria USSTC (Smokeless) feed formatter.
 *
 * Same body structure as PMUSA but tagged with feedCode='USSTC' in the
 * header. Brand families differ (Copenhagen / Skoal / Husky / Red Seal /
 * Revel) and any cert-time field tweaks should land here.
 */

import { formatAltria, type FormatInput, type FormatResult } from './altriaPmusa.js';

export function format(args: FormatInput): FormatResult {
  return formatAltria({ ...args, feedCode: 'USSTC' });
}
