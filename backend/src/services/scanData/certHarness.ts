/**
 * certHarness.ts — Synthetic-data sample file builder for cert (Session 49).
 *
 * Manufacturers require a cert pass before activating a retailer in production.
 * Cert typically takes 2-8 weeks of submitting sample files, getting feedback,
 * fixing format issues, resubmitting. This service produces cert-ready sample
 * files WITHOUT writing anything to the DB — pure in-memory synthetic
 * transactions fed straight to the existing per-mfr formatter.
 *
 * Why in-memory: real cert traffic must NEVER pollute the dev/prod transaction
 * history. Cashiers' real sales must stay separate from cert sample data.
 */

import prisma from '../../config/postgres.js';

import { format as formatItg } from './formatters/itg.js';
import { format as formatAltriaPmusa } from './formatters/altriaPmusa.js';
import { format as formatAltriaUsstc } from './formatters/altriaUsstc.js';
import { format as formatAltriaMiddleton } from './formatters/altriaMiddleton.js';
import { format as formatRjrEdlp } from './formatters/rjrEdlp.js';
import { format as formatRjrScanData } from './formatters/rjrScanData.js';
import { format as formatRjrVap } from './formatters/rjrVap.js';

import type {
  RawLineItem,
  TxForFormat,
  TobaccoProductMapByUpc,
} from './formatters/common.js';
import type { FormatResult, FormatInput } from './formatters/itg.js';

type FormatFn = (input: FormatInput) => FormatResult;

const FORMATTERS: Record<string, FormatFn> = {
  'itg':              formatItg as FormatFn,
  'altria_pmusa':     formatAltriaPmusa as FormatFn,
  'altria_usstc':     formatAltriaUsstc as FormatFn,
  'altria_middleton': formatAltriaMiddleton as FormatFn,
  'rjr_edlp':         formatRjrEdlp as FormatFn,
  'rjr_scandata':     formatRjrScanData as FormatFn,
  'rjr_vap':          formatRjrVap as FormatFn,
};

// Cert scenarios produced by the harness — tagged on each tx so the cert
// checklist can verify coverage. The order here drives the order in the
// generated file (tx 1 → first scenario etc.)
export interface CertScenario {
  key: string;
  label: string;
}

export const CERT_SCENARIOS: CertScenario[] = [
  { key: 'single_sale',         label: 'Single tobacco sale (qty=1)' },
  { key: 'multi_qty',           label: 'Multi-quantity sale (qty=2)' },
  { key: 'multipack_promo',     label: 'Multipack-promo sale (mfr-funded discount)' },
  { key: 'mfr_coupon',          label: 'Manufacturer coupon redemption' },
  { key: 'voided_tx',           label: 'Voided transaction' },
  { key: 'refund_tx',           label: 'Refund transaction' },
  { key: 'age_verified',        label: 'Age-verified sale' },
  { key: 'mixed_line',          label: 'Mixed-line tx (tobacco + non-tobacco)' },
  { key: 'buydown_funded',      label: 'Buydown-funded product (TobaccoProductMap.fundingType=buydown)' },
];

interface MfrRow {
  id: string;
  code: string;
  name: string;
  shortName?: string | null;
  brandFamilies?: string[] | null;
  fileExtension?: string | null;
}

interface MappingRow {
  id: string;
  brandFamily: string;
  mfrProductCode?: string | null;
  fundingType?: string | null;
  masterProduct?: { upc: string | null } | null;
}

// Helper — pick the manufacturer's brand families from the seeded catalog.
function pickBrand(mfr: MfrRow | null | undefined, idx: number): string {
  const brands = mfr?.brandFamilies || [];
  if (brands.length === 0) return 'GENERIC';
  return brands[idx % brands.length];
}

interface SyntheticLineOpts {
  idx: number;
  brand: string;
  fundingType: string;
  qty?: number;
  unitPrice?: number;
  couponAmt?: number;
  couponSerial?: string | null;
  includePromo?: boolean;
}

interface SyntheticLine extends RawLineItem {
  lineId: string;
  productId: string | null;
  taxable: boolean;
  ebtEligible: boolean;
  _fundingType?: string;
}

function syntheticLine(
  { idx, brand, fundingType, qty = 1, unitPrice = 9.99, couponAmt = 0, couponSerial = null, includePromo = false }: SyntheticLineOpts,
): SyntheticLine {
  const upc = `9999${String(idx).padStart(8, '0')}`;
  const promo = includePromo ? Math.min(1.50, unitPrice * 0.15) : 0;
  const effective = Math.max(0, unitPrice - promo);
  const baseLineTotal = Number((effective * qty).toFixed(2));
  const lineTotal = Number(Math.max(0, baseLineTotal - couponAmt).toFixed(2));
  return {
    lineId:     `cert-line-${idx}`,
    upc,
    productId:  null,
    name:       `${brand} (cert sample)`,
    qty,
    unitPrice,
    effectivePrice: effective,
    lineTotal,
    manufacturerCouponAmount: couponAmt,
    manufacturerCouponSerial: couponSerial || undefined,
    taxable: true,
    ebtEligible: false,
    // The formatter doesn't read these — they're metadata for the cert checklist
    _fundingType: fundingType,
  };
}

// Build the synthetic transactions array. Each tx represents one scenario.
function buildSyntheticTransactions(
  { mfr, mappings, periodStart }: { mfr: MfrRow; mappings: MappingRow[]; periodStart: Date },
): TxForFormat[] {
  const baseTime = new Date(periodStart);
  baseTime.setHours(10, 0, 0, 0); // 10am store-local

  const realMappings = mappings.filter((m: MappingRow) => m.masterProduct?.upc);
  const useReal = realMappings.length > 0;
  const realUpc = (i: number): string => realMappings[i % realMappings.length].masterProduct!.upc as string;

  const tx = (
    scenarioKey: string,
    lines: SyntheticLine[],
    status: string = 'complete',
    extras: { ageVerified?: boolean } = {},
  ): TxForFormat => {
    const idx = CERT_SCENARIOS.findIndex((s) => s.key === scenarioKey);
    const ts = new Date(baseTime.getTime() + idx * 60 * 1000);
    return {
      id: `cert-tx-${scenarioKey}`,
      txNumber: `CERT-${idx + 1}-${scenarioKey.toUpperCase()}`,
      status,
      createdAt: ts,
      cashierId: 'cert-cashier',
      stationId: 'cert-station-1',
      storeId:   'cert-store',
      lineItems: lines,
      ageVerifications: extras.ageVerified
        ? [{ productId: lines[0].lineId, age: 21, verifiedAt: ts.toISOString() }]
        : null,
    };
  };

  // Override the synthetic UPC with a real-mapped UPC when available
  const realLine = (idx: number, opts: Omit<SyntheticLineOpts, 'idx'>): SyntheticLine => {
    const line = syntheticLine({ idx, ...opts });
    if (useReal) line.upc = realUpc(idx);
    return line;
  };

  const txs: TxForFormat[] = [];

  // 1. Single sale
  txs.push(tx('single_sale', [
    realLine(0, { brand: pickBrand(mfr, 0), fundingType: 'regular' }),
  ]));

  // 2. Multi-quantity
  txs.push(tx('multi_qty', [
    realLine(1, { brand: pickBrand(mfr, 1), fundingType: 'regular', qty: 2 }),
  ]));

  // 3. Multipack-promo (line with promo discount)
  txs.push(tx('multipack_promo', [
    realLine(2, { brand: pickBrand(mfr, 0), fundingType: 'multipack', qty: 2, includePromo: true }),
  ]));

  // 4. Mfr-coupon redemption
  txs.push(tx('mfr_coupon', [
    realLine(3, { brand: pickBrand(mfr, 0), fundingType: 'regular', couponAmt: 1.00, couponSerial: 'CERT-COUPON-001' }),
  ]));

  // 5. Voided tx
  txs.push(tx('voided_tx', [
    realLine(4, { brand: pickBrand(mfr, 0), fundingType: 'regular' }),
  ], 'voided'));

  // 6. Refund tx
  txs.push(tx('refund_tx', [
    realLine(5, { brand: pickBrand(mfr, 0), fundingType: 'regular' }),
  ], 'refund'));

  // 7. Age-verified
  txs.push(tx('age_verified', [
    realLine(6, { brand: pickBrand(mfr, 0), fundingType: 'regular' }),
  ], 'complete', { ageVerified: true }));

  // 8. Mixed-line (tobacco + non-tobacco — formatter must filter out the non-tobacco line)
  txs.push(tx('mixed_line', [
    realLine(7, { brand: pickBrand(mfr, 0), fundingType: 'regular' }),
    {
      lineId: 'cert-line-mixed-nontobacco',
      upc: '012345678901', // not in product map → formatter skips it
      name: 'Cert Coffee (non-tobacco)',
      productId: null,
      qty: 1, unitPrice: 3.50, effectivePrice: 3.50, lineTotal: 3.50,
      taxable: true, ebtEligible: false,
    } as SyntheticLine,
  ]));

  // 9. Buydown-funded
  txs.push(tx('buydown_funded', [
    realLine(8, { brand: pickBrand(mfr, 0), fundingType: 'buydown', includePromo: true }),
  ]));

  return txs;
}

// Build a productMapByUpc lookup matching what the generator builds at runtime.
function buildProductMapByUpc(
  { mfr, mappings, syntheticTxs }: { mfr: MfrRow; mappings: MappingRow[]; syntheticTxs: TxForFormat[] },
): TobaccoProductMapByUpc {
  const byUpc: TobaccoProductMapByUpc = {};

  // Real mappings keyed by their UPC
  for (const m of mappings) {
    if (m.masterProduct?.upc) {
      byUpc[m.masterProduct.upc] = {
        id:             m.id,
        brandFamily:    m.brandFamily,
        mfrProductCode: m.mfrProductCode || undefined,
        fundingType:    m.fundingType || undefined,
      };
    }
  }

  // Transient mappings for synthetic UPCs (lines whose UPC isn't in real mappings).
  for (const t of syntheticTxs) {
    for (const line of t.lineItems || []) {
      const upc = line.upc;
      if (!upc) continue;
      if (byUpc[upc]) continue;
      if (upc.startsWith('9999')) {
        const brand = (line.name || '').split(' (')[0] || (mfr.brandFamilies?.[0] || 'GENERIC');
        const fundingType = (line as SyntheticLine)._fundingType || 'regular';
        byUpc[upc] = {
          id:             `cert-mapping-${upc}`,
          brandFamily:    brand,
          mfrProductCode: 'CERT-PRODUCT',
          fundingType,
        };
      }
    }
  }

  return byUpc;
}

export interface GenerateSampleFileInput {
  orgId: string;
  manufacturerId: string;
  periodStart?: Date | string | null;
}

export interface GenerateSampleFileResult {
  manufacturer: { code: string; name: string; shortName?: string | null; fileExtension?: string | null };
  filename: string;
  body: string;
  scenarios: (CertScenario & { included: boolean })[];
  txCount: number;
  lineCount: number;
  couponCount: number;
  totalAmount: number;
  warnings: string[];
}

/**
 * Generate a sample cert file for an enrollment.
 */
export async function generateSampleFile(
  { orgId, manufacturerId, periodStart = null }: GenerateSampleFileInput,
): Promise<GenerateSampleFileResult> {
  const mfr = await prisma.tobaccoManufacturer.findUnique({ where: { id: manufacturerId } }) as MfrRow | null;
  if (!mfr) throw new Error(`Manufacturer not found: ${manufacturerId}`);

  const formatter = FORMATTERS[mfr.code];
  if (!formatter) throw new Error(`No formatter for manufacturer code: ${mfr.code}`);

  const mappings = await prisma.tobaccoProductMap.findMany({
    where: { orgId, manufacturerId, active: true },
    include: { masterProduct: { select: { upc: true } } },
  }) as unknown as MappingRow[];

  const periodStartDate = periodStart ? new Date(periodStart) : new Date();
  const periodEndDate   = new Date(periodStartDate);
  periodEndDate.setHours(23, 59, 59, 999);

  const syntheticTxs = buildSyntheticTransactions({
    mfr, mappings, periodStart: periodStartDate,
  });
  const productMapByUpc = buildProductMapByUpc({ mfr, mappings, syntheticTxs });

  // Build a synthetic enrollment-shape so the formatter has the fields it
  // expects without us needing a real ScanDataEnrollment row in cert mode.
  const certEnrollment = {
    orgId,
    storeId:        'cert-store',
    mfrRetailerId:  'CERT-RETAILER',
    mfrChainId:     'CERT-CHAIN',
    sftpHost:       null,
    manufacturer:   mfr,
  };

  const result = formatter({
    enrollment:    certEnrollment,
    transactions:  syntheticTxs,
    productMapByUpc,
    periodStart:   periodStartDate,
    periodEnd:     periodEndDate,
  });

  // Verify scenario coverage by walking what got included in the final file.
  const scenarios = CERT_SCENARIOS.map((s: CertScenario) => {
    const t = syntheticTxs.find((tx: TxForFormat) => tx.txNumber.includes(s.key.toUpperCase()));
    const txInFile = t ? result.body.includes(t.txNumber) : false;
    return { ...s, included: txInFile };
  });

  const warnings: string[] = [];
  if (mappings.length === 0) {
    warnings.push('No real tobacco product mappings configured for this manufacturer — sample file uses synthetic UPCs (9999xxxxxxxx). Mfrs may flag "unknown UPC" during cert; the FORMAT itself is what\'s being certified, so this is usually accepted as a smoke test.');
  } else if (mappings.length < 5) {
    warnings.push(`Only ${mappings.length} product mapping(s) configured — recommend at least 5 brand-family-diverse mappings for thorough cert coverage.`);
  }

  const filename = `CERT-${mfr.code.toUpperCase()}-${periodStartDate.toISOString().slice(0,10)}.${mfr.fileExtension || 'txt'}`;

  return {
    manufacturer: { code: mfr.code, name: mfr.name, shortName: mfr.shortName, fileExtension: mfr.fileExtension },
    filename,
    body:         result.body,
    scenarios,
    txCount:      result.txCount     || 0,
    lineCount:    result.lineCount   || 0,
    couponCount:  result.couponCount || 0,
    totalAmount:  result.totalAmount || 0,
    warnings,
  };
}
