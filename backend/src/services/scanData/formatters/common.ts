/**
 * common.ts — Shared scan-data formatter helpers (Session 47).
 *
 * Centralises:
 *   • Tobacco-line extraction from the existing Transaction.lineItems JSON
 *   • Discount split (mfr-funded vs retailer-funded) using TobaccoProductMap.fundingType
 *   • Field-encoding helpers: pad / quote / pipe-escape / fixed-width / UPC normalisation
 *   • The shape every per-mfr formatter expects from the generator
 *
 * The discount split is the most spec-sensitive piece. The exact buydown vs
 * multipack vs promotion bucket per line drives reimbursement at the mfr.
 * We compute it deterministically here:
 *
 *   - The line's pre-coupon promo discount = (unitPrice − effectivePrice) × qty
 *   - That bucket is steered by the line's TobaccoProductMap.fundingType:
 *       'buydown'   → entire promo discount → buydownAmount
 *       'multipack' → entire promo discount → multipackAmount
 *       'promotion' → entire promo discount → mfr-promotion (separate bucket if mfr supports it; else lumped into multipack)
 *       'regular'   → entire promo discount → retailerCouponAmount
 *   - manufacturerCouponAmount + manufacturerCouponSerial come straight from the
 *     line item (Session 46) — these are coupon redemptions, distinct from buydowns.
 *   - Loyalty allocation: skipped in v1 (allocate 0). Cashier-app's
 *     loyalty discount is order-level; per-line allocation needs a separate
 *     pro-rata pass and isn't required by any mfr in our active list.
 */

// ── Public types ───────────────────────────────────────────────────────────

/** A line entry inside Transaction.lineItems JSON. */
export interface RawLineItem {
  upc?: string | null;
  name?: string | null;
  qty?: number;
  unitPrice?: number;
  effectivePrice?: number;
  lineTotal?: number;
  isLottery?: boolean;
  isFuel?: boolean;
  isBottleReturn?: boolean;
  manufacturerCouponAmount?: number;
  manufacturerCouponSerial?: string;
  [extra: string]: unknown;
}

/** A row in TobaccoProductMap. */
export interface TobaccoMapping {
  id: string;
  brandFamily: string;
  fundingType?: 'buydown' | 'multipack' | 'promotion' | 'regular' | string;
  mfrProductCode?: string | null;
  [extra: string]: unknown;
}

/** Map keyed by normalised 12-digit UPC. */
export type TobaccoProductMapByUpc = Record<string, TobaccoMapping>;

/** A normalised tobacco line ready for any per-mfr formatter. */
export interface NormalizedTobaccoLine {
  upc: string;
  productCode: string;
  brandFamily: string;
  description: string;
  qty: number;
  unitPrice: number;
  grossLine: number;
  netLine: number;
  retailPrice: number;
  buydownAmount: number;
  multipackAmount: number;
  mfrPromotionAmount: number;
  retailerCouponAmount: number;
  mfrCouponAmount: number;
  mfrCouponSerial: string;
  loyaltyAmount: number;
  mappingId: string;
  fundingType: string;
}

/** A Transaction row used by the formatters (subset of Prisma's Transaction). */
export interface TxForFormat {
  id: string;
  txNumber: string;
  createdAt: Date | string;
  cashierId?: string | null;
  stationId?: string | null;
  storeId?: string | null;
  status: string;
  lineItems?: RawLineItem[] | null;
  ageVerifications?: unknown[] | null;
  [extra: string]: unknown;
}

/** Output of `txMeta` — a flat per-tx metadata bundle for record-line emission. */
export interface TxMeta {
  txId: string;
  txNumber: string;
  createdAt: Date | string;
  cashierId: string;
  stationId: string;
  storeId: string;
  isVoid: boolean;
  isRefund: boolean;
  saleType: 'S' | 'V' | 'R';
  ageVerified: 'Y' | 'N';
}

/** A pairing of one TxMeta + one normalised line — fed into trailer aggregation. */
export interface FormatterRecord {
  tx: TxMeta;
  line: NormalizedTobaccoLine;
}

export interface TrailerTotals {
  txCount: number;
  lineCount: number;
  grossTotal: number;
  netTotal: number;
  couponCount: number;
  couponTotal: number;
  buydownTotal: number;
  multipackTotal: number;
}

// ── UPC normalisation ─────────────────────────────────────────────────────
// All mfrs want 12-digit UPCs (UPC-A). Pad shorter codes with leading zeros.
// EAN-13 with leading zero collapses to 12. Anything longer is left as-is
// (rare, but mfrs reject on bad UPC anyway so we let them flag it).
export function normalizeUpc(upc: string | null | undefined): string {
  if (!upc) return '';
  const digits = String(upc).replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length < 12) return digits.padStart(12, '0');
  return digits;
}

// ── Field encoders ─────────────────────────────────────────────────────────
export const padLeft  = (v: unknown, n: number, ch = '0'): string => String(v ?? '').padStart(n, ch);
export const padRight = (v: unknown, n: number, ch = ' '): string => String(v ?? '').padEnd(n, ch).slice(0, n);

// Pipe-delimited: escape any literal pipes in the value
export const pipeEscape = (v: unknown): string => String(v ?? '').replace(/[|]/g, ' ');

// Fixed-width number (decimal cents). e.g. fixedAmt(1.99, 8) → "00000199"
export function fixedAmt(amount: unknown, width = 8): string {
  const cents = Math.round(Number(amount || 0) * 100);
  return padLeft(Math.abs(cents), width);
}

// Sign indicator for fixed-width records that need it
export const signOf = (n: unknown): string => (Number(n) < 0 ? '-' : ' ');

// ── Date / time encoders ──────────────────────────────────────────────────
export function fmtDate(d: Date | string | number, sep = ''): string {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}${sep}${m}${sep}${day}`;
}

export function fmtTime(d: Date | string | number, sep = ''): string {
  const date = new Date(d);
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}${sep}${m}${sep}${s}`;
}

export function fmtDateTime(d: Date | string | number): string {
  return `${fmtDate(d)}${fmtTime(d)}`;
}

// ── Line-item extraction from a Transaction row ───────────────────────────
//
// Each Transaction stores its lineItems as JSONB. Here we filter for the
// lines that:
//   1. Match a TobaccoProductMap for the target manufacturer feed
//   2. Are not lottery / fuel / bottle-return / non-product entries
//
// Returns an array of normalised line-item objects ready for any formatter.
//
// `productMapByUpc` is built once per generation pass (one query per mfr feed)
// so we don't slam the DB inside the loop.
export function extractTobaccoLines(
  transaction: TxForFormat,
  productMapByUpc: TobaccoProductMapByUpc,
  _mfrCode?: string,
): NormalizedTobaccoLine[] {
  const out: NormalizedTobaccoLine[] = [];
  const lineItems = transaction.lineItems || [];
  for (const li of lineItems) {
    if (!li.upc) continue;
    if (li.isLottery || li.isFuel || li.isBottleReturn) continue;

    const upc = normalizeUpc(li.upc);
    const mapping = productMapByUpc[upc];
    if (!mapping) continue; // line isn't on this mfr's feed

    const unitPrice    = Number(li.unitPrice ?? 0);
    const effective    = Number(li.effectivePrice ?? unitPrice);
    const qty          = Number(li.qty ?? 1);
    const lineTotal    = Number(li.lineTotal ?? 0);

    // Pre-coupon promo discount = retail × qty − effective × qty
    // This includes manual line discounts + auto promo + multipack auto.
    const promoDiscount = Math.max(0, (unitPrice - effective) * qty);

    const fundingType = mapping.fundingType || 'regular';
    let buydownAmt = 0, multipackAmt = 0, retailerCpnAmt = 0, mfrPromoAmt = 0;
    if (fundingType === 'buydown') {
      buydownAmt = promoDiscount;
    } else if (fundingType === 'multipack') {
      multipackAmt = promoDiscount;
    } else if (fundingType === 'promotion') {
      mfrPromoAmt = promoDiscount;
    } else {
      retailerCpnAmt = promoDiscount;
    }

    // Coupon discount baked into the line by the cashier (Session 46)
    const mfrCouponAmt    = Number(li.manufacturerCouponAmount || 0);
    const mfrCouponSerial = li.manufacturerCouponSerial || '';

    // Net price after ALL discounts — what the customer actually paid for this line
    const netLine = Math.max(0, lineTotal);

    out.push({
      // Identity
      upc,
      productCode: mapping.mfrProductCode || '',
      brandFamily: mapping.brandFamily,
      description: li.name || '',

      // Quantities + pricing
      qty,
      unitPrice,
      grossLine:    Number((unitPrice * qty).toFixed(2)),
      netLine:      Number(netLine.toFixed(2)),
      retailPrice:  Number(unitPrice.toFixed(2)),

      // Discount split
      buydownAmount:        Number(buydownAmt.toFixed(2)),
      multipackAmount:      Number(multipackAmt.toFixed(2)),
      mfrPromotionAmount:   Number(mfrPromoAmt.toFixed(2)),
      retailerCouponAmount: Number(retailerCpnAmt.toFixed(2)),
      mfrCouponAmount:      Number(mfrCouponAmt.toFixed(2)),
      mfrCouponSerial,
      // Loyalty allocation skipped in v1 — see file header
      loyaltyAmount:        0,

      // Metadata for the record line
      mappingId:    mapping.id,
      fundingType,
    });
  }
  return out;
}

// ── Transaction-level metadata ────────────────────────────────────────────
//
// What every formatter needs per transaction: tx id, timestamps, register,
// cashier, status (sale / void / refund), age verification flag.
export function txMeta(tx: TxForFormat): TxMeta {
  const isVoid   = tx.status === 'voided';
  const isRefund = tx.status === 'refund';
  return {
    txId:        tx.id,
    txNumber:    tx.txNumber,
    createdAt:   tx.createdAt,
    cashierId:   tx.cashierId || '',
    stationId:   tx.stationId || '',
    storeId:     tx.storeId || '',
    isVoid,
    isRefund,
    saleType:    isVoid ? 'V' : isRefund ? 'R' : 'S',
    ageVerified: Array.isArray(tx.ageVerifications) && tx.ageVerifications.length > 0
      ? 'Y' : 'N',
  };
}

// ── Filename helpers ──────────────────────────────────────────────────────
//
// Most mfrs want the filename to encode store + date so dropped files into
// a shared SFTP bucket can be sorted. Format: `{retailerId}_{YYYYMMDD}.{ext}`.
export function buildFilename(
  { retailerId, date, ext }: { retailerId?: string | null; date: Date | string | number; ext?: string },
): string {
  const datePart = fmtDate(date);
  const retPart  = String(retailerId || 'STORE').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${retPart}_${datePart}.${ext || 'txt'}`;
}

// ── Aggregate counters for trailer records ────────────────────────────────
export function buildTotals(records: FormatterRecord[]): TrailerTotals {
  const out = {
    txCount:        new Set<string>(),
    lineCount:      0,
    grossTotal:     0,
    netTotal:       0,
    couponCount:    0,
    couponTotal:    0,
    buydownTotal:   0,
    multipackTotal: 0,
  };
  for (const r of records) {
    out.txCount.add(r.tx.txId);
    out.lineCount       += 1;
    out.grossTotal      += r.line.grossLine;
    out.netTotal        += r.line.netLine;
    out.buydownTotal    += r.line.buydownAmount;
    out.multipackTotal  += r.line.multipackAmount;
    if (r.line.mfrCouponAmount > 0) {
      out.couponCount += 1;
      out.couponTotal += r.line.mfrCouponAmount;
    }
  }
  return {
    txCount:        out.txCount.size,
    lineCount:      out.lineCount,
    grossTotal:     Number(out.grossTotal.toFixed(2)),
    netTotal:       Number(out.netTotal.toFixed(2)),
    couponCount:    out.couponCount,
    couponTotal:    Number(out.couponTotal.toFixed(2)),
    buydownTotal:   Number(out.buydownTotal.toFixed(2)),
    multipackTotal: Number(out.multipackTotal.toFixed(2)),
  };
}
