/**
 * scanDataController.ts  (Session 45 — foundation, Sessions 46-49 add full pipeline)
 *
 * Handles:
 *   • Manufacturer catalog read   (GET /manufacturers)
 *   • Enrollment CRUD             (per store × manufacturer feed)
 *   • Tobacco product mapping     (link MasterProduct → mfr feed + brand)
 *   • Submission log read         (Session 47 will write rows here)
 *
 * Permissions:
 *   scan_data.view       — manager+   (read enrollments / mappings / submissions)
 *   scan_data.enroll     — owner+     (create/update enrollments + SFTP creds)
 *   scan_data.configure  — manager+   (product mapping)
 *   scan_data.submit     — manager+   (manual resubmit — Session 47)
 *
 * SFTP password storage: encrypted via cryptoVault.encrypt(). Never returned
 * in plaintext from any endpoint — list/get show `sftpPasswordSet: true|false`
 * + the masked last-4 of the username only.
 */

import type { Request, Response } from 'express';
import type { Prisma, ScanDataEnrollment } from '@prisma/client';
import fs from 'fs';
import prisma from '../config/postgres.js';
import { encrypt, mask } from '../utils/cryptoVault.js';
import { generateSubmission, generateForStore } from '../services/scanData/generator.js';
import { testConnection } from '../services/scanData/sftpService.js';
import { parseAck as parseAckByMfr } from '../services/scanData/ackParsers/index.js';
import { reconcileAck } from '../services/scanData/reconciliation.js';
import { generateSampleFile, CERT_SCENARIOS } from '../services/scanData/certHarness.js';
import { getChecklist as getCertChecklist } from '../services/scanData/certChecklist.js';
import { getPlaybook, listAvailablePlaybooks } from '../services/scanData/certPlaybook.js';

const getOrgId = (req: Request): string | null | undefined =>
  req.orgId || req.user?.orgId;

// Strip sftpPasswordEnc from any response and add a `sftpPasswordSet` boolean
// so the UI can render "•••• (set)" vs "Not set" without ever seeing plaintext.
function safeEnrollment<T extends Partial<ScanDataEnrollment>>(e: T | null): (Omit<T, 'sftpPasswordEnc'> & { sftpPasswordSet: boolean; sftpUsernameMasked: string | null }) | null {
  if (!e) return null;
  const { sftpPasswordEnc, ...rest } = e;
  return {
    ...rest,
    sftpPasswordSet: Boolean(sftpPasswordEnc),
    sftpUsernameMasked: e.sftpUsername ? mask(e.sftpUsername, 3) : null,
  } as Omit<T, 'sftpPasswordEnc'> & { sftpPasswordSet: boolean; sftpUsernameMasked: string | null };
}

// ══════════════════════════════════════════════════════════════════════════
// MANUFACTURER CATALOG
// ══════════════════════════════════════════════════════════════════════════

export const listManufacturers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.tobaccoManufacturer.findMany({
      where: { active: true },
      orderBy: [{ parentMfrCode: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// ENROLLMENTS
// ══════════════════════════════════════════════════════════════════════════

export const listEnrollments = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as { storeId?: string };
    const { storeId } = q;
    const where: Prisma.ScanDataEnrollmentWhereInput = { orgId: orgId ?? undefined };
    if (storeId) where.storeId = String(storeId);

    const rows = await prisma.scanDataEnrollment.findMany({
      where,
      include: {
        manufacturer: {
          select: {
            id: true, code: true, parentMfrCode: true, name: true,
            shortName: true, fileFormat: true, brandFamilies: true,
          },
        },
      },
      orderBy: [{ storeId: 'asc' }, { createdAt: 'asc' }],
    });
    type EnrollmentRow = (typeof rows)[number];
    res.json({ success: true, data: (rows as EnrollmentRow[]).map((r) => safeEnrollment(r)) });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const getEnrollment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const row = await prisma.scanDataEnrollment.findFirst({
      where: { id, orgId: orgId ?? undefined },
      include: { manufacturer: true },
    });
    if (!row) { res.status(404).json({ success: false, error: 'Enrollment not found' }); return; }
    res.json({ success: true, data: safeEnrollment(row) });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

interface UpsertEnrollmentBody {
  storeId?: string;
  manufacturerId?: string;
  mfrRetailerId?: string | null;
  mfrChainId?: string | null;
  sftpHost?: string | null;
  sftpPort?: number | string | null;
  sftpUsername?: string | null;
  sftpPassword?: string;    // plaintext — encrypted before persist
  clearPassword?: boolean;  // explicit "remove the stored password" flag
  sftpPath?: string | null;
  environment?: string;
  status?: string;
  notes?: string | null;
}

export const upsertEnrollment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as UpsertEnrollmentBody;
    const {
      storeId,
      manufacturerId,
      mfrRetailerId,
      mfrChainId,
      sftpHost,
      sftpPort,
      sftpUsername,
      sftpPassword,    // plaintext — encrypted before persist
      clearPassword,   // explicit "remove the stored password" flag
      sftpPath,
      environment,
      status,
      notes,
    } = body;

    if (!storeId || !manufacturerId) {
      res.status(400).json({ success: false, error: 'storeId and manufacturerId are required' });
      return;
    }

    const mfr = await prisma.tobaccoManufacturer.findUnique({ where: { id: manufacturerId } });
    if (!mfr) { res.status(400).json({ success: false, error: 'Unknown manufacturer feed' }); return; }

    const existing = await prisma.scanDataEnrollment.findUnique({
      where: { storeId_manufacturerId: { storeId, manufacturerId } },
    });

    // Build the data payload, only encrypting password when one is supplied.
    const data: Record<string, unknown> = {
      orgId,
      storeId,
      manufacturerId,
      mfrRetailerId: mfrRetailerId ?? null,
      mfrChainId:    mfrChainId ?? null,
      sftpHost:      sftpHost ?? null,
      sftpPort:      sftpPort ? Number(sftpPort) : 22,
      sftpUsername:  sftpUsername ?? null,
      sftpPath:      sftpPath ?? '/upload/',
      environment:   environment === 'production' ? 'production' : 'uat',
      status:        status || (existing?.status ?? 'draft'),
      notes:         notes ?? null,
    };

    if (sftpPassword) {
      data.sftpPasswordEnc = encrypt(sftpPassword);
    } else if (clearPassword) {
      data.sftpPasswordEnc = null;
    }

    const row = existing
      ? await prisma.scanDataEnrollment.update({
          where: { id: existing.id },
          data: data as Prisma.ScanDataEnrollmentUpdateInput,
          include: { manufacturer: true },
        })
      : await prisma.scanDataEnrollment.create({
          data: { ...data, enrolledAt: new Date() } as unknown as Prisma.ScanDataEnrollmentCreateInput,
          include: { manufacturer: true },
        });

    res.json({ success: true, data: safeEnrollment(row) });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const updateEnrollmentStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const body = (req.body || {}) as { status?: string };
    const { status } = body;
    const valid = ['draft', 'certifying', 'active', 'suspended', 'rejected'];
    if (!status || !valid.includes(status)) {
      res.status(400).json({ success: false, error: 'Invalid status' });
      return;
    }
    const row = await prisma.scanDataEnrollment.findFirst({ where: { id, orgId: orgId ?? undefined } });
    if (!row) { res.status(404).json({ success: false, error: 'Enrollment not found' }); return; }

    const data: Prisma.ScanDataEnrollmentUpdateInput = { status };
    if (status === 'active' && !row.certifiedAt) data.certifiedAt = new Date();
    if (status === 'suspended') data.suspendedAt = new Date();

    const updated = await prisma.scanDataEnrollment.update({
      where: { id },
      data,
      include: { manufacturer: true },
    });
    res.json({ success: true, data: safeEnrollment(updated) });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const deleteEnrollment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const row = await prisma.scanDataEnrollment.findFirst({ where: { id, orgId: orgId ?? undefined } });
    if (!row) { res.status(404).json({ success: false, error: 'Enrollment not found' }); return; }

    // Block deletion if any submissions exist for this enrollment
    const subCount = await prisma.scanDataSubmission.count({
      where: { orgId: orgId ?? undefined, storeId: row.storeId, manufacturerId: row.manufacturerId },
    });
    if (subCount > 0) {
      res.status(409).json({
        success: false,
        error: `Cannot delete — ${subCount} historical submissions reference this enrollment. Suspend instead.`,
      });
      return;
    }

    await prisma.scanDataEnrollment.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// TOBACCO PRODUCT MAPPINGS
// ══════════════════════════════════════════════════════════════════════════

export const listProductMappings = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as { manufacturerId?: string; brandFamily?: string; search?: string };
    const { manufacturerId, brandFamily, search } = q;

    const where: Prisma.TobaccoProductMapWhereInput = { orgId: orgId ?? undefined };
    if (manufacturerId) where.manufacturerId = String(manufacturerId);
    if (brandFamily) where.brandFamily = String(brandFamily);

    const rows = await prisma.tobaccoProductMap.findMany({
      where,
      include: {
        masterProduct: {
          select: {
            id: true, name: true, brand: true, upc: true, sku: true,
            departmentId: true, defaultRetailPrice: true,
          },
        },
        manufacturer: {
          select: {
            id: true, code: true, parentMfrCode: true, name: true,
            shortName: true, brandFamilies: true,
          },
        },
      },
      orderBy: [{ brandFamily: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
    type MappingRow = (typeof rows)[number];

    let filtered: MappingRow[] = rows as MappingRow[];
    if (search) {
      const qStr = String(search).toLowerCase();
      filtered = (rows as MappingRow[]).filter((r) =>
        (r.masterProduct?.name?.toLowerCase().includes(qStr)) ||
        (r.masterProduct?.upc?.includes(qStr)) ||
        (r.masterProduct?.brand?.toLowerCase().includes(qStr)),
      );
    }

    res.json({ success: true, data: filtered });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

interface UpsertMappingBody {
  masterProductId?: number | string;
  manufacturerId?: string;
  brandFamily?: string;
  mfrProductCode?: string | null;
  fundingType?: string;
}

export const upsertProductMapping = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as UpsertMappingBody;
    const {
      masterProductId,
      manufacturerId,
      brandFamily,
      mfrProductCode,
      fundingType,
    } = body;

    if (!masterProductId || !manufacturerId || !brandFamily) {
      res.status(400).json({
        success: false,
        error: 'masterProductId, manufacturerId, and brandFamily are required',
      });
      return;
    }

    const product = await prisma.masterProduct.findFirst({
      where: { id: Number(masterProductId), orgId: orgId ?? undefined },
    });
    if (!product) { res.status(404).json({ success: false, error: 'Product not found' }); return; }

    const mfr = await prisma.tobaccoManufacturer.findUnique({
      where: { id: String(manufacturerId) },
    });
    if (!mfr) { res.status(400).json({ success: false, error: 'Unknown manufacturer feed' }); return; }

    const data = {
      orgId: orgId as string,
      masterProductId: Number(masterProductId),
      manufacturerId,
      brandFamily: String(brandFamily),
      mfrProductCode: mfrProductCode || null,
      fundingType: fundingType || 'regular',
    };

    const row = await prisma.tobaccoProductMap.upsert({
      where: { masterProductId_manufacturerId: { masterProductId: data.masterProductId, manufacturerId } },
      create: data,
      update: { brandFamily: data.brandFamily, mfrProductCode: data.mfrProductCode, fundingType: data.fundingType },
      include: { masterProduct: true, manufacturer: true },
    });

    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

interface BulkMappingEntry {
  masterProductId?: number | string;
  manufacturerId?: string;
  brandFamily?: string;
  mfrProductCode?: string | null;
  fundingType?: string;
}

interface BulkMappingResult {
  created: number;
  updated: number;
  errors: Array<{ masterProductId?: number | string; error: string }>;
}

export const bulkUpsertProductMappings = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as { mappings?: BulkMappingEntry[] };
    const { mappings } = body;
    if (!Array.isArray(mappings) || mappings.length === 0) {
      res.status(400).json({ success: false, error: 'mappings[] is required' });
      return;
    }

    const results: BulkMappingResult = { created: 0, updated: 0, errors: [] };

    for (const m of mappings) {
      try {
        const data = {
          orgId: orgId as string,
          masterProductId: Number(m.masterProductId),
          manufacturerId: String(m.manufacturerId),
          brandFamily: String(m.brandFamily),
          mfrProductCode: m.mfrProductCode || null,
          fundingType: m.fundingType || 'regular',
        };

        const existing = await prisma.tobaccoProductMap.findUnique({
          where: { masterProductId_manufacturerId: { masterProductId: data.masterProductId, manufacturerId: data.manufacturerId } },
        });

        if (existing) {
          await prisma.tobaccoProductMap.update({
            where: { id: existing.id },
            data: { brandFamily: data.brandFamily, mfrProductCode: data.mfrProductCode, fundingType: data.fundingType },
          });
          results.updated++;
        } else {
          await prisma.tobaccoProductMap.create({ data });
          results.created++;
        }
      } catch (err) {
        results.errors.push({ masterProductId: m.masterProductId, error: (err as Error).message });
      }
    }

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const deleteProductMapping = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const row = await prisma.tobaccoProductMap.findFirst({ where: { id, orgId: orgId ?? undefined } });
    if (!row) { res.status(404).json({ success: false, error: 'Mapping not found' }); return; }

    await prisma.tobaccoProductMap.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// Lists products that ARE flagged as tobacco (taxClass='tobacco' OR have a
// tobacco product mapping already) — used by the Tobacco Catalog tab to
// render the bulk-tag list.
export const listTobaccoProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as { search?: string; departmentId?: string; unmappedOnly?: string };
    const { search, departmentId, unmappedOnly } = q;

    const where: Prisma.MasterProductWhereInput = {
      orgId: orgId ?? undefined,
      deleted: false,
      OR: [
        { taxClass: 'tobacco' },
        { tobaccoProductMaps: { some: {} } },
      ],
    };
    if (departmentId) where.departmentId = Number(departmentId);
    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { upc:  { contains: String(search) } },
        { brand: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    const products = await prisma.masterProduct.findMany({
      where,
      include: {
        tobaccoProductMaps: {
          include: {
            manufacturer: {
              select: { id: true, code: true, name: true, shortName: true, parentMfrCode: true },
            },
          },
        },
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ name: 'asc' }],
      take: 500,
    });
    type ProductRow = (typeof products)[number];

    let result: ProductRow[] = products as ProductRow[];
    if (unmappedOnly === 'true') {
      result = (products as ProductRow[]).filter((p) => p.tobaccoProductMaps.length === 0);
    }

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// SUBMISSIONS  (read-only in Session 45 — Session 47 ships file generation)
// ══════════════════════════════════════════════════════════════════════════

export const listSubmissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as { storeId?: string; manufacturerId?: string; status?: string; limit?: string };
    const { storeId, manufacturerId, status, limit } = q;

    const where: Prisma.ScanDataSubmissionWhereInput = { orgId: orgId ?? undefined };
    if (storeId)        where.storeId = String(storeId);
    if (manufacturerId) where.manufacturerId = String(manufacturerId);
    if (status)         where.status = String(status);

    const rows = await prisma.scanDataSubmission.findMany({
      where,
      include: {
        manufacturer: {
          select: { id: true, code: true, name: true, shortName: true, parentMfrCode: true },
        },
      },
      orderBy: [{ submissionDate: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(Number(limit) || 100, 500),
    });

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── POST /scan-data/submissions/regenerate (manager+ via scan_data.submit) ──
//
// Manual replay. Use cases:
//   • A scheduler tick failed and you want to retry now without waiting
//   • You want to dry-run a date range to inspect the file before sending
//   • A manufacturer asks for a re-send of a specific date
//
// Body:
//   { storeId, manufacturerId?, periodStart, periodEnd, dryRun?: bool }
// If `manufacturerId` is omitted, regenerates for every active enrollment
// at this store.
interface RegenBody {
  storeId?: string;
  manufacturerId?: string;
  periodStart?: string | Date;
  periodEnd?: string | Date;
  dryRun?: boolean;
}

export const regenerateSubmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as RegenBody;
    const { storeId, manufacturerId, periodStart, periodEnd, dryRun = false } = body;
    if (!storeId || !periodStart || !periodEnd) {
      res.status(400).json({ success: false, error: 'storeId, periodStart, periodEnd are required' });
      return;
    }

    if (manufacturerId) {
      const r = await generateSubmission({
        orgId: orgId as string, storeId, manufacturerId,
        periodStart: periodStart as string,
        periodEnd: periodEnd as string,
        dryRun: Boolean(dryRun),
      } as Parameters<typeof generateSubmission>[0]);
      // Strip the file body from the response — it's enormous; download via /:id/download instead.
      const { body: fileBody, ...summary } = r as unknown as { body?: string } & Record<string, unknown>;
      res.json({ success: true, data: summary, dryRunBody: dryRun ? fileBody : undefined });
      return;
    }

    const results = await generateForStore({ orgId: orgId as string, storeId, periodStart: periodStart as string, periodEnd: periodEnd as string, dryRun: Boolean(dryRun) } as Parameters<typeof generateForStore>[0]);
    res.json({ success: true, data: { results } });
  } catch (err) {
    console.error('[scanData] regenerate failed:', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── GET /scan-data/submissions/:id/download (manager+ via scan_data.view) ──
//
// Streams the stored submission file. Used during cert to inspect the exact
// bytes that were uploaded — invaluable when the mfr says "your line 47 is
// malformed" and we need to see what we actually sent.
export const downloadSubmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const sub = await prisma.scanDataSubmission.findFirst({ where: { id, orgId: orgId ?? undefined } });
    if (!sub) { res.status(404).json({ success: false, error: 'Submission not found' }); return; }
    if (!sub.fileStoragePath || !fs.existsSync(sub.fileStoragePath)) {
      res.status(410).json({ success: false, error: 'File no longer available on disk.' });
      return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${sub.fileName}"`);
    const stream = fs.createReadStream(sub.fileStoragePath);
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── POST /scan-data/submissions/:id/process-ack (manager+ via scan_data.submit) ──
//
// Manual ack reconciliation. Two body shapes supported:
//   { ackContent: "<raw text>", fileName?: "STORV-001_20260424.csv.ack" }
//     → parse with the manufacturer's parser, run reconciliation
//   { ackLines: [{ recordRef, status, reason?, code?, ... }] }
//     → already-parsed structure, skip parser, run reconciliation directly
//
// Use case: during cert, mfrs often deliver ack files via email or web
// portal rather than SFTP. Admins paste the file body here to drive the
// same reconciliation flow as the automated SFTP poller.
interface AckLine {
  recordRef?: string;
  status?: string;
  reason?: string;
  code?: string;
}

interface ProcessAckBody {
  ackContent?: string;
  fileName?: string;
  ackLines?: AckLine[];
}

export const processSubmissionAck = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const body = (req.body || {}) as ProcessAckBody;
    const { ackContent, fileName, ackLines } = body;
    if (!ackContent && !Array.isArray(ackLines)) {
      res.status(400).json({ success: false, error: 'ackContent (raw text) or ackLines (parsed array) is required.' });
      return;
    }

    const submission = await prisma.scanDataSubmission.findFirst({
      where: { id, orgId: orgId ?? undefined },
      include: { manufacturer: true },
    });
    if (!submission) { res.status(404).json({ success: false, error: 'Submission not found' }); return; }

    type AckResult = ReturnType<typeof parseAckByMfr>;
    let parsed: AckResult;
    if (Array.isArray(ackLines)) {
      // Pre-parsed shape — assume the caller knows what they're doing
      const accepted = ackLines.filter((l) => l.status === 'accepted').length;
      const rejected = ackLines.filter((l) => l.status === 'rejected').length;
      const warning  = ackLines.filter((l) => l.status === 'warning').length;
      parsed = {
        mfrCode: submission.manufacturer.code,
        fileName: fileName || null,
        processedAt: new Date(),
        summary: { acceptedCount: accepted, rejectedCount: rejected, warningCount: warning },
        lines: ackLines,
        parseErrors: [],
      } as unknown as AckResult;
    } else {
      parsed = parseAckByMfr({
        mfrCode:  submission.manufacturer.code,
        content:  ackContent,
        fileName: fileName || null,
      });
    }

    const result = await reconcileAck({ submission, ack: parsed } as Parameters<typeof reconcileAck>[0]);
    res.json({ success: true, data: { ...result, parseErrors: (parsed as { parseErrors: unknown[] }).parseErrors } });
  } catch (err) {
    console.error('[scanData] processSubmissionAck failed:', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── GET /scan-data/submissions/:id/ack-lines (manager+ via scan_data.view) ──
//
// Fetches the ackLines JSON for a submission so the portal SubmissionDetailModal
// can render the per-line status table. Returns the raw array; UI filters/sorts
// client-side.
export const getSubmissionAckLines = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const submission = await prisma.scanDataSubmission.findFirst({
      where: { id, orgId: orgId ?? undefined },
      include: { manufacturer: { select: { id: true, code: true, name: true, shortName: true } } },
    });
    if (!submission) { res.status(404).json({ success: false, error: 'Submission not found' }); return; }
    res.json({
      success: true,
      data: {
        submission: {
          id:             submission.id,
          fileName:       submission.fileName,
          status:         submission.status,
          ackedAt:        submission.ackedAt,
          acceptedCount:  submission.acceptedCount,
          rejectedCount:  submission.rejectedCount,
          txCount:        submission.txCount,
          couponCount:    submission.couponCount,
          totalAmount:    submission.totalAmount,
          periodStart:    submission.periodStart,
          periodEnd:      submission.periodEnd,
          uploadedAt:     submission.uploadedAt,
          errorMessage:   submission.errorMessage,
          manufacturer:   submission.manufacturer,
        },
        ackLines: Array.isArray(submission.ackLines) ? submission.ackLines : [],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── POST /scan-data/cert/sample-file (manager+ via scan_data.submit) ──────
//
// Builds a representative sample file for cert in-memory and returns the
// file body + scenario coverage report. NO DB writes — synthetic
// transactions never pollute real tx history.
export const generateCertSampleFile = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body || {}) as { manufacturerId?: string; periodStart?: string };
    const { manufacturerId, periodStart } = body;
    if (!manufacturerId) { res.status(400).json({ success: false, error: 'manufacturerId is required' }); return; }

    const result = await generateSampleFile({ orgId: orgId as string, manufacturerId, periodStart } as Parameters<typeof generateSampleFile>[0]);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[scanData] generateCertSampleFile failed:', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── GET /scan-data/cert/checklist?enrollmentId=... (manager+ via scan_data.view) ──
//
// Derives the cert progress for a given enrollment from the DB. Used by
// the portal CertModal to render the green/amber/grey step list.
export const getEnrollmentCertChecklist = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as { enrollmentId?: string };
    const { enrollmentId } = q;
    if (!enrollmentId) { res.status(400).json({ success: false, error: 'enrollmentId is required' }); return; }

    const checklist = await getCertChecklist({ orgId: orgId as string, enrollmentId } as Parameters<typeof getCertChecklist>[0]);
    res.json({ success: true, data: checklist });
  } catch (err) {
    console.error('[scanData] getEnrollmentCertChecklist failed:', err);
    const e = err as Error;
    res.status(e.message === 'Enrollment not found' ? 404 : 500).json({ success: false, error: e.message });
  }
};

// ── GET /scan-data/cert/playbook/:mfrCode (manager+ via scan_data.view) ───
//
// Returns the per-mfr cert guide content. Sub-feeds (altria_pmusa, rjr_edlp,
// etc.) all return their parent's playbook since cert is conducted at the
// parent-mfr level.
export const getCertPlaybook = async (req: Request, res: Response): Promise<void> => {
  try {
    const { mfrCode } = req.params;
    const playbook = getPlaybook(mfrCode);
    if (!playbook) {
      res.status(404).json({
        success: false,
        error: `No playbook for manufacturer code: ${mfrCode}`,
        available: listAvailablePlaybooks(),
      });
      return;
    }
    res.json({ success: true, data: playbook });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── GET /scan-data/cert/scenarios (manager+ via scan_data.view) ───────────
//
// Returns the canonical list of cert scenarios the harness covers. The
// CertModal uses this for the "scenarios covered" checklist.
export const getCertScenarios = async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: { scenarios: CERT_SCENARIOS } });
};

// ── POST /scan-data/enrollments/:id/test-connection (owner+ via scan_data.enroll) ──
//
// SFTP smoke test for a single enrollment. Connects, lists the upload dir,
// reports success or the exact error. Useful before flipping cert→active.
export const testEnrollmentConnection = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const enrollment = await prisma.scanDataEnrollment.findFirst({ where: { id, orgId: orgId ?? undefined } });
    if (!enrollment) { res.status(404).json({ success: false, error: 'Enrollment not found' }); return; }

    const result = await testConnection(enrollment as Parameters<typeof testConnection>[0]);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

export const getSubmissionStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const q = req.query as { storeId?: string; days?: string };
    const { storeId, days } = q;

    const since = new Date();
    since.setDate(since.getDate() - (Number(days) || 30));

    const where: Prisma.ScanDataSubmissionWhereInput = { orgId: orgId ?? undefined, createdAt: { gte: since } };
    if (storeId) where.storeId = String(storeId);

    const [total, byStatus] = await Promise.all([
      prisma.scanDataSubmission.count({ where }),
      prisma.scanDataSubmission.groupBy({
        where,
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    type GroupRow = { status: string; _count: { _all: number } };
    res.json({
      success: true,
      data: {
        total,
        byStatus: (byStatus as GroupRow[]).reduce((acc: Record<string, number>, r) => {
          acc[r.status] = r._count._all;
          return acc;
        }, {}),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};
