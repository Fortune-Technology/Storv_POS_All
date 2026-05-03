/**
 * altriaPmusa.ts — Altria PMUSA (Cigarettes) feed formatter (Session 47).
 *
 * Pipe-delimited. Most rigorous cert spec — rejects the entire batch on a
 * single bad record. Cashier-app must already populate every required field
 * on each line; this formatter assembles the file structure.
 *
 * File layout (Altria Retail Leaders v3.x typical structure):
 *   Header:  H|<retailerId>|<chainId>|<storeId>|<storeAddr>|<periodStart>|<periodEnd>|<formatVersion>|<generatedAt>
 *   Sale:    S|<txId>|<txDate>|<txTime>|<register>|<cashier>|<saleType>|<upc>|<productCode>|<brand>|<descr>|<qty>|<retailPrice>|<grossLine>|<buydown>|<multipack>|<mfrPromotion>|<mfrCoupon>|<couponSerial>|<retailerCoupon>|<loyalty>|<netLine>|<ageVerified>
 *   Trailer: T|<txCount>|<lineCount>|<grossTotal>|<netTotal>|<buydownTotal>|<multipackTotal>|<couponCount>|<couponTotal>
 *
 * The variant formatters (USSTC, Middleton) re-use this module with a
 * different feed-code header field. See altriaUsstc.ts / altriaMiddleton.ts.
 */

import {
  pipeEscape, fmtDate, fmtTime, txMeta,
  extractTobaccoLines, buildTotals,
  type TxForFormat, type TobaccoProductMapByUpc, type FormatterRecord,
} from './common.js';

const FORMAT_VERSION = 'PMUSA-3.5';

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

export function formatAltria(
  { enrollment, transactions, productMapByUpc, periodStart, periodEnd, feedCode = 'PMUSA' }: FormatInput,
): FormatResult {
  const lines: string[] = [];
  const records: FormatterRecord[] = [];

  // Header
  lines.push([
    'H',
    pipeEscape(enrollment.mfrRetailerId || ''),
    pipeEscape(enrollment.mfrChainId || ''),
    pipeEscape(enrollment.storeId || ''),
    pipeEscape(''), // storeAddr — admin-app config field, currently blank
    fmtDate(periodStart, '-'),
    fmtDate(periodEnd, '-'),
    feedCode,
    `${FORMAT_VERSION}-${feedCode}`,
    `${fmtDate(new Date(), '-')}T${fmtTime(new Date(), ':')}`,
  ].join('|'));

  // Sale records
  for (const tx of transactions) {
    const meta = txMeta(tx);
    const tlines = extractTobaccoLines(tx, productMapByUpc, feedCode.toLowerCase());
    for (const li of tlines) {
      records.push({ tx: meta, line: li });
      lines.push([
        'S',
        pipeEscape(meta.txNumber),
        fmtDate(meta.createdAt, '-'),
        fmtTime(meta.createdAt, ':'),
        pipeEscape(meta.stationId),
        pipeEscape(meta.cashierId),
        meta.saleType,
        li.upc,
        pipeEscape(li.productCode),
        pipeEscape(li.brandFamily),
        pipeEscape(li.description),
        String(li.qty),
        li.retailPrice.toFixed(2),
        li.grossLine.toFixed(2),
        li.buydownAmount.toFixed(2),
        li.multipackAmount.toFixed(2),
        li.mfrPromotionAmount.toFixed(2),
        li.mfrCouponAmount.toFixed(2),
        pipeEscape(li.mfrCouponSerial),
        li.retailerCouponAmount.toFixed(2),
        li.loyaltyAmount.toFixed(2),
        li.netLine.toFixed(2),
        meta.ageVerified,
      ].join('|'));
    }
  }

  // Trailer
  const t = buildTotals(records);
  lines.push([
    'T',
    String(t.txCount),
    String(t.lineCount),
    t.grossTotal.toFixed(2),
    t.netTotal.toFixed(2),
    t.buydownTotal.toFixed(2),
    t.multipackTotal.toFixed(2),
    String(t.couponCount),
    t.couponTotal.toFixed(2),
  ].join('|'));

  return {
    body:        lines.join('\n') + '\n',
    txCount:     t.txCount,
    lineCount:   t.lineCount,
    couponCount: t.couponCount,
    totalAmount: t.netTotal,
  };
}

// Default export — PMUSA cigarettes feed
export function format(args: FormatInput): FormatResult {
  return formatAltria({ ...args, feedCode: 'PMUSA' });
}
