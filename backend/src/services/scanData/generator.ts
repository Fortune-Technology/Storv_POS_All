/**
 * generator.ts — Scan-data file generator (Session 47).
 *
 * Orchestrates one (store × manufacturer-feed × date) pass:
 *   1. Resolve the formatter by manufacturer code
 *   2. Build the product-mapping lookup (UPC → mfrProductCode + brandFamily + fundingType)
 *   3. Query transactions in the period window (org+store, status complete | refund | voided)
 *   4. Call the formatter to produce file body + counts
 *   5. Write the file to local storage
 *   6. Upload via SFTP (if configured + dependency installed)
 *   7. Insert/update ScanDataSubmission row with status + ack-pending state
 *
 * Dry-run mode (`{ dryRun: true }`) skips the SFTP upload step and returns
 * the in-memory file body for inspection. The submission row is still
 * written so the back-office UI sees it.
 *
 * The submitted file is also kept on disk under
 *   `backend/uploads/scan-data/{yyyy-mm-dd}/{storeId}/{mfrCode}.{ext}`
 * so we can replay or inspect during cert.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../../config/postgres.js';
import { uploadFile, type SftpEnrollment } from './sftpService.js';
import { buildFilename } from './formatters/common.js';
import type { TxForFormat, TobaccoProductMapByUpc } from './formatters/common.js';
import type { FormatResult, FormatInput } from './formatters/itg.js';

import { format as formatItg } from './formatters/itg.js';
import { format as formatAltriaPmusa } from './formatters/altriaPmusa.js';
import { format as formatAltriaUsstc } from './formatters/altriaUsstc.js';
import { format as formatAltriaMiddleton } from './formatters/altriaMiddleton.js';
import { format as formatRjrEdlp } from './formatters/rjrEdlp.js';
import { format as formatRjrScanData } from './formatters/rjrScanData.js';
import { format as formatRjrVap } from './formatters/rjrVap.js';

type FormatFn = (input: FormatInput) => FormatResult;

// ── Formatter dispatch table ──────────────────────────────────────────────
const FORMATTERS: Record<string, FormatFn> = {
  'itg':              formatItg as FormatFn,
  'altria_pmusa':     formatAltriaPmusa as FormatFn,
  'altria_usstc':     formatAltriaUsstc as FormatFn,
  'altria_middleton': formatAltriaMiddleton as FormatFn,
  'rjr_edlp':         formatRjrEdlp as FormatFn,
  'rjr_scandata':     formatRjrScanData as FormatFn,
  'rjr_vap':          formatRjrVap as FormatFn,
};

// ── File storage location ─────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const UPLOADS_ROOT = path.resolve(__dirname, '..', '..', '..', 'uploads', 'scan-data');

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function dateFolderName(d: Date | string | number): string {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface MappingRow {
  id: string;
  brandFamily: string;
  mfrProductCode?: string | null;
  fundingType?: string | null;
  masterProduct?: { upc: string | null } | null;
}

// ── Build the productMapByUpc lookup once per pass ────────────────────────
async function loadProductMappings(
  { orgId, manufacturerId }: { orgId: string; manufacturerId: string },
): Promise<TobaccoProductMapByUpc> {
  const mappings = await prisma.tobaccoProductMap.findMany({
    where: { orgId, manufacturerId, active: true },
    include: { masterProduct: { select: { upc: true } } },
  }) as unknown as MappingRow[];
  const byUpc: TobaccoProductMapByUpc = {};
  for (const m of mappings) {
    if (!m.masterProduct?.upc) continue;
    byUpc[m.masterProduct.upc] = {
      id:             m.id,
      brandFamily:    m.brandFamily,
      mfrProductCode: m.mfrProductCode || undefined,
      fundingType:    m.fundingType || undefined,
    };
  }
  return byUpc;
}

export interface GenerateSubmissionInput {
  orgId: string;
  storeId: string;
  manufacturerId: string;
  periodStart: Date | string | number;
  periodEnd: Date | string | number;
  dryRun?: boolean;
}

export interface GenerateSubmissionResult {
  submissionId: string;
  filename: string;
  filePath: string;
  body?: string;
  txCount: number;
  lineCount: number;
  couponCount: number;
  totalAmount: number;
  uploaded: boolean;
  skipped: boolean;
  attempts: number;
  error?: string;
  status: string;
}

// ── Public: generate one submission ───────────────────────────────────────
export async function generateSubmission({
  orgId,
  storeId,
  manufacturerId,
  periodStart,
  periodEnd,
  dryRun = false,
}: GenerateSubmissionInput): Promise<GenerateSubmissionResult> {
  // 1. Resolve enrollment + manufacturer + formatter
  const enrollment = await prisma.scanDataEnrollment.findFirst({
    where: { orgId, storeId, manufacturerId },
    include: { manufacturer: true },
  });
  if (!enrollment) {
    throw new Error(`No enrollment for store ${storeId} × manufacturer ${manufacturerId}.`);
  }
  const mfr = enrollment.manufacturer;
  const formatter = FORMATTERS[mfr.code];
  if (!formatter) {
    throw new Error(`No formatter registered for manufacturer code: ${mfr.code}`);
  }

  // 2. Build product-mapping lookup (UPC → mapping)
  const productMapByUpc = await loadProductMappings({ orgId, manufacturerId });
  if (Object.keys(productMapByUpc).length === 0) {
    // Allow generation with zero mappings — produces an empty file (header + trailer only).
    // Mfrs may require a daily file even when no qualifying products were sold.
    console.warn(`[ScanData/Generator] No product mappings for ${mfr.code} at store ${storeId}. Generating empty file.`);
  }

  // 3. Query transactions in the date window
  const periodStartDate = new Date(periodStart);
  const periodEndDate   = new Date(periodEnd);
  // Inclusive end-of-day for periodEnd
  const periodEndClosed = new Date(periodEndDate);
  periodEndClosed.setHours(23, 59, 59, 999);

  const transactions = await prisma.transaction.findMany({
    where: {
      orgId,
      storeId,
      createdAt: { gte: periodStartDate, lte: periodEndClosed },
      status:    { in: ['complete', 'refund', 'voided'] },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, txNumber: true, status: true, createdAt: true,
      cashierId: true, stationId: true, storeId: true,
      lineItems: true, ageVerifications: true,
    },
  }) as unknown as TxForFormat[];

  // 4. Format
  const result = formatter({
    enrollment,
    transactions,
    productMapByUpc,
    periodStart: periodStartDate,
    periodEnd:   periodEndDate,
  });

  // 5. Write to local storage
  const filename = buildFilename({
    retailerId: enrollment.mfrRetailerId || storeId,
    date:       periodStartDate,
    ext:        mfr.fileExtension || 'txt',
  });
  const dir = path.join(UPLOADS_ROOT, dateFolderName(periodStartDate), storeId, mfr.code);
  ensureDir(dir);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, result.body, 'utf8');
  const fileSize = Buffer.byteLength(result.body, 'utf8');

  // 6. Upload (skipped in dry-run)
  const attemptLog: { attempt: number; error: string | null; at: Date }[] = [];
  let uploadResult: { uploaded: boolean; skipped: boolean; attempts: number; error?: string }
    = { uploaded: false, skipped: true, attempts: 0, error: undefined };

  if (!dryRun) {
    uploadResult = await uploadFile({
      enrollment: enrollment as unknown as SftpEnrollment,
      localFilePath: filePath,
      remoteFilename: filename,
      onAttempt: (n: number, err: Error | null) =>
        attemptLog.push({ attempt: n, error: err?.message || null, at: new Date() }),
    });
  } else {
    uploadResult.error = 'dry-run mode';
  }

  // 7. Persist submission row
  const status: string = dryRun
    ? 'queued'
    : uploadResult.uploaded
      ? 'uploaded'
      : uploadResult.skipped
        ? 'queued'   // SFTP skipped — leave queued for retry by next scheduler tick
        : 'failed';

  const submission = await prisma.scanDataSubmission.create({
    data: {
      orgId,
      storeId,
      manufacturerId,
      submissionDate:  new Date(),
      periodStart:     periodStartDate,
      periodEnd:       periodEndClosed,
      fileName:        filename,
      fileSize,
      fileStoragePath: filePath,
      txCount:         result.txCount     || 0,
      couponCount:     result.couponCount || 0,
      totalAmount:     result.totalAmount || 0,
      status,
      uploadedAt:      uploadResult.uploaded ? new Date() : null,
      errorMessage:    uploadResult.error || null,
      attempts:        uploadResult.attempts,
    },
  });

  // Update the enrollment's denormalized status fields
  await prisma.scanDataEnrollment.update({
    where: { id: enrollment.id },
    data: {
      lastSubmissionAt: new Date(),
      lastStatus:       status === 'failed' ? 'rejected' : 'ok',
      lastErrorMsg:     uploadResult.error || null,
    },
  });

  // Mark the redemptions in the window as submitted (Session 48 will set
  // reimbursedAt on ack receipt; for now just stamp submittedAt).
  if (!dryRun && uploadResult.uploaded) {
    await prisma.couponRedemption.updateMany({
      where: {
        orgId, storeId,
        manufacturerId,
        submittedAt: null,
        createdAt:   { gte: periodStartDate, lte: periodEndClosed },
      },
      data: {
        submittedAt:  new Date(),
        submissionId: submission.id,
      },
    });
  }

  return {
    submissionId: submission.id,
    filename,
    filePath,
    body:         dryRun ? result.body : undefined,
    txCount:      result.txCount     || 0,
    lineCount:    result.lineCount   || 0,
    couponCount:  result.couponCount || 0,
    totalAmount:  result.totalAmount || 0,
    uploaded:     uploadResult.uploaded,
    skipped:      uploadResult.skipped,
    attempts:     uploadResult.attempts,
    error:        uploadResult.error,
    status,
  };
}

export interface GenerateForStoreInput {
  orgId: string;
  storeId: string;
  periodStart: Date | string | number;
  periodEnd: Date | string | number;
  dryRun?: boolean;
}

export interface GenerateForStoreResultEntry {
  ok: boolean;
  mfr: string;
  error?: string;
  /** Present when ok=true — same fields as generateSubmission's return shape. */
  submissionId?: string;
  filename?: string;
  filePath?: string;
  body?: string;
  txCount?: number;
  lineCount?: number;
  couponCount?: number;
  totalAmount?: number;
  uploaded?: boolean;
  skipped?: boolean;
  attempts?: number;
  status?: string;
}

// ── Generate for every active enrollment of a store ───────────────────────
export async function generateForStore(
  { orgId, storeId, periodStart, periodEnd, dryRun = false }: GenerateForStoreInput,
): Promise<GenerateForStoreResultEntry[]> {
  const enrollments = await prisma.scanDataEnrollment.findMany({
    where: {
      orgId, storeId,
      status: { in: ['active', 'certifying'] },
    },
    include: { manufacturer: true },
  });

  const results: GenerateForStoreResultEntry[] = [];
  for (const e of enrollments) {
    try {
      const r = await generateSubmission({
        orgId, storeId,
        manufacturerId: e.manufacturerId,
        periodStart, periodEnd, dryRun,
      });
      results.push({ ok: true, mfr: e.manufacturer.code, ...r });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ScanData/Generator] ${e.manufacturer.code} failed:`, message);
      results.push({ ok: false, mfr: e.manufacturer.code, error: message });
    }
  }
  return results;
}
