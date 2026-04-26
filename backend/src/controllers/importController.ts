/**
 * importController.ts
 * ─────────────────────────────────────────────────────────────
 * HTTP handlers for the bulk import pipeline.
 *
 * Routes:
 *   POST   /api/catalog/import/preview        → dry-run + validation
 *   POST   /api/catalog/import/commit         → execute import
 *   GET    /api/catalog/import/template/:type → download CSV template
 *   GET    /api/catalog/import/history        → list past jobs for org
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import multer        from 'multer';
import prisma        from '../config/postgres.js';
import {
  parseFile,
  detectColumns,
  buildContext,
  validateRows,
  importRows,
  generateTemplate,
  IMPORT_SERVICE_VERSION,
} from '../services/importService.js';
import { applyTemplate } from '../services/vendorTemplateEngine.js';

// ─── Multer: in-memory, CSV/XLSX only, 10 MB max ─────────────────────────────
const ALLOWED_MIMES = new Set([
  'text/csv', 'application/csv', 'text/plain',
  'text/tab-separated-values',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const ALLOWED_EXTS = new Set(['csv','xlsx','xls','txt','tsv']);

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (ALLOWED_MIMES.has(file.mimetype) || ALLOWED_EXTS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files (.csv, .xlsx, .xls, .tsv) are allowed'));
    }
  },
}).single('file');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getOrgId  = (req: Request): string | undefined =>
  req.tenantId || (req.user as { tenantId?: string } | undefined)?.tenantId || req.user?.orgId || undefined;
const getUserId = (req: Request): string | undefined => req.user?.id;

const VALID_TYPES = ['products','departments','vendors','promotions','deposits','invoice_costs'];

type MappingValue = string | string[];
type MappingRecord = Record<string, MappingValue>;

/**
 * Merge the auto-detected column mapping with any manual mapping sent by the
 * client. Manual wins absolutely.
 */
function mergeMapping(
  detectedMapping: MappingRecord,
  manualMappingRaw: Record<string, unknown>,
): MappingRecord {
  const isSkipped = (v: unknown): boolean =>
    v == null || v === '' || (Array.isArray(v) && v.length === 0);

  const manualMapping: MappingRecord = {};
  const skippedFields = new Set<string>();
  for (const [field, header] of Object.entries(manualMappingRaw || {})) {
    if (isSkipped(header)) {
      skippedFields.add(field);
    } else {
      manualMapping[field] = header as MappingValue;
    }
  }
  const mapping: MappingRecord = { ...detectedMapping, ...manualMapping };
  for (const f of skippedFields) delete mapping[f];
  // Prevent a raw header from being claimed twice (manual-first priority).
  const seenHeaders = new Set<string>();
  const manualFields = new Set(Object.keys(manualMapping));
  const ordered = [...manualFields, ...Object.keys(mapping).filter((k) => !manualFields.has(k))];
  const final: MappingRecord = {};
  for (const field of ordered) {
    const h = mapping[field];
    if (isSkipped(h)) continue;
    if (Array.isArray(h)) {
      const kept = h.filter((col: string) => col && !seenHeaders.has(col));
      if (kept.length === 0) continue;
      kept.forEach((col: string) => seenHeaders.add(col));
      final[field] = kept;
    } else {
      if (seenHeaders.has(h)) continue;
      seenHeaders.add(h);
      final[field] = h;
    }
  }
  return final;
}

interface PreviewBody {
  type?: string;
  storeId?: string | null;
  duplicateStrategy?: string;
  unknownDeptStrategy?: string;
  unknownVendorStrategy?: string;
  mapping?: string;
}

interface ValidationRow {
  rowNum: number;
  errors?: unknown[];
  warnings?: unknown[];
  cleaned?: Record<string, unknown>;
}

// ─── POST /api/catalog/import/preview ────────────────────────────────────────
export const previewImport = [
  uploadMiddleware,
  async (req: Request, res: Response) => {
    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

      const body = req.body as PreviewBody;
      const type     = body.type;
      const opts = {
        duplicateStrategy:     (body.duplicateStrategy   || 'overwrite') as 'error' | 'skip' | 'update' | undefined,
        unknownDeptStrategy:   body.unknownDeptStrategy   || 'skip',
        unknownVendorStrategy: body.unknownVendorStrategy || 'skip',
      };

      if (!type || !VALID_TYPES.includes(type)) {
        res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
        return;
      }

      const orgId = getOrgId(req);
      if (!orgId) { res.status(401).json({ error: 'Cannot determine org' }); return; }

      // 1 — Parse
      const { headers, rows } = parseFile(file.buffer, file.mimetype, file.originalname);
      if (rows.length === 0) {
        res.status(400).json({ error: 'File is empty or contains only headers' });
        return;
      }

      // 2 — Detect columns + merge manual overrides (manual wins absolutely)
      const detectedMapping = detectColumns(headers) as MappingRecord;
      const manualMappingRaw = body.mapping ? JSON.parse(body.mapping) : {};
      const mapping = mergeMapping(detectedMapping, manualMappingRaw);

      // 3 — Build context (dept/vendor lookups)
      const ctx = await buildContext(orgId);

      // 4 — Validate
      const { valid, invalid, warnings } = await validateRows(
        rows,
        type as Parameters<typeof validateRows>[1],
        mapping as unknown as Parameters<typeof validateRows>[2],
        ctx,
        opts,
      );

      // 5 — Sample rows for UI preview
      const sample = (valid as unknown as ValidationRow[]).slice(0, 5).map((r: ValidationRow) => r.cleaned);

      // Build the union of all headers claimed in the mapping (which may be
      // strings OR arrays of strings for multi-source fields).
      const claimedHeaders = new Set<string>();
      for (const v of Object.values(mapping)) {
        if (Array.isArray(v)) v.forEach((h: string) => claimedHeaders.add(h));
        else if (typeof v === 'string') claimedHeaders.add(v);
      }

      res.json({
        ok: true,
        importerVersion: IMPORT_SERVICE_VERSION,
        fileName:        file.originalname,
        fileSize:        file.size,
        type,
        totalRows:       rows.length,
        validCount:      valid.length,
        invalidCount:    invalid.length,
        warningCount:    warnings.length,
        detectedMapping,
        appliedMapping:  mapping,
        unmappedHeaders: headers.filter((h: string) => !claimedHeaders.has(h)),
        errors:          (invalid as unknown as ValidationRow[]).slice(0, 100).map((r: ValidationRow) => ({
          row:    r.rowNum,
          errors: r.errors,
          warnings: r.warnings,
        })),
        warnings: (warnings as unknown as ValidationRow[]).slice(0, 100).map((r: ValidationRow) => ({
          row:      r.rowNum,
          warnings: r.warnings,
        })),
        sample,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Preview failed';
      console.error('[importController.previewImport]', err);
      res.status(500).json({ error: message });
    }
  },
];

interface CommitBody extends PreviewBody {
  templateId?: string | number;
  unknownUpcStrategy?: string;
}

// ─── POST /api/catalog/import/commit ─────────────────────────────────────────
export const commitImport = [
  uploadMiddleware,
  async (req: Request, res: Response) => {
    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

      const body = req.body as CommitBody;
      const type    = body.type;
      // Resolve target store for StoreProduct stock writes.
      let storeId: string | null = body.storeId
        || (req.headers['x-store-id'] as string | undefined)
        || null;
      const templateId = body.templateId ? parseInt(String(body.templateId)) : null;
      // Default 'fail' when a template is in use.
      const unknownUpcStrategy = body.unknownUpcStrategy || (templateId ? 'fail' : 'create');
      const opts = {
        duplicateStrategy:     (body.duplicateStrategy     || 'overwrite') as 'error' | 'skip' | 'update' | undefined,
        unknownDeptStrategy:   body.unknownDeptStrategy   || 'skip',
        unknownVendorStrategy: body.unknownVendorStrategy || 'skip',
        unknownUpcStrategy,
      };

      if (!type || !VALID_TYPES.includes(type)) {
        res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
        return;
      }

      const orgId  = getOrgId(req);
      const userId = getUserId(req);
      if (!orgId) { res.status(401).json({ error: 'Cannot determine org' }); return; }

      // If still no storeId and this is a product import, fall back to the first
      // active store in the org so quantityOnHand is written somewhere meaningful.
      if (!storeId && type === 'products') {
        const firstStore = await prisma.store.findFirst({
          where: { orgId, isActive: true },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });
        if (firstStore) {
          storeId = firstStore.id;
          console.log(`[importController] No storeId in request → falling back to active store ${storeId}`);
        }
      }

      // 1 — Parse
      const { headers, rows } = parseFile(file.buffer, file.mimetype, file.originalname);
      if (rows.length === 0) { res.status(400).json({ error: 'File is empty' }); return; }

      // 1b — Session 5: if a vendor template was selected, apply it BEFORE
      // column detection.
      let workingRows = rows;
      let workingHeaders = headers;
      let templateWarnings: unknown[] = [];
      let templateApplied: { id: number; name: string; slug: string } | null = null;

      if (templateId) {
        const tmpl = await prisma.vendorImportTemplate.findUnique({
          where: { id: templateId },
          include: { mappings: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!tmpl) { res.status(400).json({ error: `Vendor template ${templateId} not found` }); return; }
        if (tmpl.target !== type) {
          res.status(400).json({ error: `Template "${tmpl.name}" targets "${tmpl.target}" but upload type is "${type}"` });
          return;
        }
        const applied = applyTemplate(rows as Record<string, unknown>[], tmpl);
        workingRows = applied.transformedRows as typeof rows;
        templateWarnings = applied.warnings;
        templateApplied = { id: tmpl.id, name: tmpl.name, slug: tmpl.slug };
        // Canonical headers = union of keys present in the transformed rows
        const keySet = new Set<string>();
        for (const r of workingRows as Record<string, unknown>[]) Object.keys(r).forEach((k) => keySet.add(k));
        workingHeaders = [...keySet];
      }

      // 2 — Build column mapping.
      const manualMappingRaw = body.mapping ? JSON.parse(body.mapping) : {};
      const detectedMapping = templateId
        ? Object.fromEntries(workingHeaders.map((h: string) => [h, h])) as MappingRecord
        : (detectColumns(workingHeaders) as MappingRecord);
      const mapping = mergeMapping(detectedMapping, manualMappingRaw);

      // 3 — Build context
      const ctx = await buildContext(orgId);

      // 4 — Validate
      const { valid, invalid, warnings } = await validateRows(
        workingRows,
        type as Parameters<typeof validateRows>[1],
        mapping as unknown as Parameters<typeof validateRows>[2],
        ctx,
        opts,
      );

      // 5 — Create import job record (status = importing)
      const job = await prisma.importJob.create({
        data: {
          orgId,
          storeId,
          type,
          fileName: file.originalname,
          fileSize: file.size,
          totalRows: rows.length,
          status:   'importing',
          options:  opts as unknown as Prisma.InputJsonValue,
          createdBy: String(userId || 'system'),
        },
      });

      // 6 — Import valid rows
      const result = await importRows(
        valid,
        type as Parameters<typeof importRows>[1],
        orgId,
        storeId,
        opts,
      );

      // 7 — Compile all errors (validation + runtime)
      const allErrors = [
        ...(invalid as unknown as ValidationRow[]).map((r: ValidationRow) => ({
          row:     r.rowNum,
          type:    'error',
          errors:  r.errors,
          warnings:r.warnings,
        })),
        ...(result.errors as Record<string, unknown>[]).map((e: Record<string, unknown>) => ({ type: 'error', ...e })),
        ...(warnings as unknown as ValidationRow[]).map((r: ValidationRow) => ({
          row:      r.rowNum,
          type:     'warning',
          warnings: r.warnings,
        })),
      ];

      // 8 — Update job to done
      const completedJob = await prisma.importJob.update({
        where: { id: job.id },
        data: {
          status:      'done',
          successRows: result.created + result.updated,
          failedRows:  invalid.length + result.errors.length,
          skippedRows: result.skipped,
          errors:      allErrors.slice(0, 500) as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });

      res.json({
        ok: true,
        jobId:       completedJob.id,
        type,
        fileName:    file.originalname,
        totalRows:   rows.length,
        created:     result.created,
        updated:     result.updated,
        skipped:     result.skipped,
        failed:      invalid.length + result.errors.length,
        warnings:    warnings.length,
        errors:      allErrors.slice(0, 50), // return first 50 in response
        template:    templateApplied,
        templateWarnings: templateWarnings.slice(0, 20),
        message:     `Import complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${invalid.length + result.errors.length} failed${templateApplied ? ` (using "${templateApplied.name}")` : ''}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      console.error('[importController.commitImport]', err);
      res.status(500).json({ error: message });
    }
  },
];

// ─── GET /api/catalog/import/template/:type ───────────────────────────────────
export const getImportTemplate = (req: Request, res: Response): void => {
  const { type } = req.params;
  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
    return;
  }

  const buffer = generateTemplate(type as Parameters<typeof generateTemplate>[0]);
  if (!buffer) { res.status(404).json({ error: 'Template not found' }); return; }

  const filename = `storeveu_import_template_${type}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
};

// ─── GET /api/catalog/import/history ─────────────────────────────────────────
export const getImportHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) { res.status(401).json({ error: 'Cannot determine org' }); return; }

    const page  = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(100, parseInt(String(req.query.limit)) || 20);
    const type  = req.query.type as string | undefined; // optional filter

    const where: Prisma.ImportJobWhereInput = {
      orgId,
      ...(type && VALID_TYPES.includes(type) ? { type } : {}),
    };

    const [jobs, total] = await Promise.all([
      prisma.importJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:  (page - 1) * limit,
        take:  limit,
        select: {
          id: true, type: true, fileName: true, fileSize: true,
          totalRows: true, successRows: true, failedRows: true, skippedRows: true,
          status: true, options: true, createdBy: true, createdAt: true, completedAt: true,
        },
      }),
      prisma.importJob.count({ where }),
    ]);

    res.json({
      ok: true,
      jobs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[importController.getImportHistory]', err);
    res.status(500).json({ error: 'Failed to fetch import history' });
  }
};

// ─── GET /api/catalog/import/history/:id ─────────────────────────────────────
export const getImportJob = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const job   = await prisma.importJob.findUnique({ where: { id: parseInt(req.params.id) } });

    if (!job || job.orgId !== orgId) { res.status(404).json({ error: 'Job not found' }); return; }

    res.json({ ok: true, job });
  } catch {
    res.status(500).json({ error: 'Failed to fetch job' });
  }
};
