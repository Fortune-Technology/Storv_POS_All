/**
 * rjrEdlp.ts — RJR / RAI Every Day Low Price funded-promo feed (Session 47).
 *
 * Fixed-width records. Field positions and lengths follow RJR EDLP v4.x
 * typical layout — exact widths are tweaked during cert with Jacksonville.
 *
 * Record types (col 1):
 *   H = Header
 *   S = Sale (one per qualifying line)
 *   T = Trailer
 *
 * All amount fields are stored as cents, zero-padded, no decimal point.
 * UPC is left-padded to 12. Strings padded with spaces.
 *
 * Layout (positions are 1-indexed for cert-spec readability):
 *   Header (54 chars):
 *     1     1   recordType        'H'
 *     2     8   retailerId        right-aligned, zero-pad
 *     10    8   chainId
 *     18    16  storeId           right-aligned, space-pad
 *     34    8   periodStart       YYYYMMDD
 *     42    8   periodEnd         YYYYMMDD
 *     50    5   formatVersion     'EDLP1'
 *
 *   Sale (~140 chars):
 *     1     1   recordType        'S'
 *     2     14  txId
 *     16    8   txDate            YYYYMMDD
 *     24    6   txTime            HHMMSS
 *     30    6   register
 *     36    8   cashier
 *     44    1   saleType          S/V/R
 *     45    12  upc
 *     57    10  productCode
 *     67    8   qty               right-aligned, zero-pad (×1000 for 3-decimal qty)
 *     75    8   retailPrice       cents
 *     83    8   grossLine         cents
 *     91    8   buydownAmount     cents
 *     99    8   multipackAmount   cents
 *     107   8   mfrCouponAmount   cents
 *     115   16  mfrCouponSerial
 *     131   8   netLine           cents
 *     139   1   ageVerified       Y/N
 *
 *   Trailer (~70 chars):
 *     1     1   recordType        'T'
 *     2     8   txCount
 *     10    8   lineCount
 *     18    12  grossTotal        cents
 *     30    12  netTotal          cents
 *     42    12  buydownTotal      cents
 *     54    8   couponCount
 *     62    12  couponTotal       cents
 */

import {
  padLeft, padRight, fixedAmt, fmtDate, fmtTime, txMeta,
  extractTobaccoLines, buildTotals,
  type TxForFormat, type TobaccoProductMapByUpc, type FormatterRecord,
} from './common.js';

const FORMAT_VERSION = 'EDLP1';

export interface FormatEnrollment {
  mfrRetailerId?: string | null;
  mfrChainId?: string | null;
  storeId?: string | null;
  [extra: string]: unknown;
}

export interface FormatInput {
  enrollment: FormatEnrollment;
  transactions: TxForFormat[];
  productMapByUpc: TobaccoProductMapByUpc;
  periodStart: Date | string | number;
  periodEnd: Date | string | number;
  feedCode?: string;
}

export interface FormatResult {
  body: string;
  txCount: number;
  lineCount: number;
  couponCount: number;
  totalAmount: number;
}

export function formatRJR(
  { enrollment, transactions, productMapByUpc, periodStart, periodEnd, feedCode = 'EDLP' }: FormatInput,
): FormatResult {
  const lines: string[] = [];
  const records: FormatterRecord[] = [];

  // Header
  lines.push([
    'H',
    padLeft(enrollment.mfrRetailerId, 8),
    padLeft(enrollment.mfrChainId,    8),
    padRight(enrollment.storeId,      16),
    fmtDate(periodStart),
    fmtDate(periodEnd),
    padRight(`${FORMAT_VERSION}${feedCode === 'EDLP' ? '' : '-' + feedCode}`, 5),
  ].join(''));

  // Sale records
  for (const tx of transactions) {
    const meta = txMeta(tx);
    const rjrLines = extractTobaccoLines(tx, productMapByUpc, feedCode.toLowerCase());
    for (const li of rjrLines) {
      records.push({ tx: meta, line: li });
      lines.push([
        'S',
        padRight(meta.txNumber,      14),
        fmtDate(meta.createdAt),
        fmtTime(meta.createdAt),
        padRight(meta.stationId,      6),
        padRight(meta.cashierId,      8),
        meta.saleType,
        padLeft(li.upc,              12),
        padRight(li.productCode,     10),
        padLeft(Math.round(li.qty * 1000), 8), // 3-decimal qty
        fixedAmt(li.retailPrice,      8),
        fixedAmt(li.grossLine,        8),
        fixedAmt(li.buydownAmount,    8),
        fixedAmt(li.multipackAmount,  8),
        fixedAmt(li.mfrCouponAmount,  8),
        padRight(li.mfrCouponSerial, 16),
        fixedAmt(li.netLine,          8),
        meta.ageVerified,
      ].join(''));
    }
  }

  // Trailer
  const t = buildTotals(records);
  lines.push([
    'T',
    padLeft(t.txCount,        8),
    padLeft(t.lineCount,      8),
    fixedAmt(t.grossTotal,    12),
    fixedAmt(t.netTotal,      12),
    fixedAmt(t.buydownTotal,  12),
    padLeft(t.couponCount,    8),
    fixedAmt(t.couponTotal,   12),
  ].join(''));

  return {
    body:        lines.join('\n') + '\n',
    txCount:     t.txCount,
    lineCount:   t.lineCount,
    couponCount: t.couponCount,
    totalAmount: t.netTotal,
  };
}

export function format(args: FormatInput): FormatResult {
  return formatRJR({ ...args, feedCode: 'EDLP' });
}
