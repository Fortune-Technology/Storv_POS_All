/**
 * importController.js
 * ─────────────────────────────────────────────────────────────
 * HTTP handlers for the bulk import pipeline.
 *
 * Routes:
 *   POST   /api/catalog/import/preview        → dry-run + validation
 *   POST   /api/catalog/import/commit         → execute import
 *   GET    /api/catalog/import/template/:type → download CSV template
 *   GET    /api/catalog/import/history        → list past jobs for org
 */

import multer        from 'multer';
import prisma        from '../config/postgres.js';
import {
  parseFile,
  detectColumns,
  buildContext,
  validateRows,
  importRows,
  generateTemplate,
} from '../services/importService.js';

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
  fileFilter: (req, file, cb) => {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (ALLOWED_MIMES.has(file.mimetype) || ALLOWED_EXTS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files (.csv, .xlsx, .xls, .tsv) are allowed'));
    }
  },
}).single('file');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getOrgId  = (req) => req.tenantId || req.user?.tenantId || req.user?.orgId;
const getUserId = (req) => req.user?.id || req.user?._id;

const VALID_TYPES = ['products','departments','vendors','promotions','deposits','invoice_costs'];

// ─── POST /api/catalog/import/preview ────────────────────────────────────────
/**
 * Parse + detect + validate, NO database writes.
 * Returns: detectedMapping, row counts, first 100 errors, first 100 warnings, 5-row sample.
 */
export const previewImport = [
  uploadMiddleware,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const type     = req.body.type;
      const storeId  = req.body.storeId || null;
      const opts = {
        duplicateStrategy:   req.body.duplicateStrategy   || 'overwrite',
        unknownDeptStrategy:   req.body.unknownDeptStrategy   || 'skip',
        unknownVendorStrategy: req.body.unknownVendorStrategy || 'skip',
      };

      if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
      }

      const orgId = getOrgId(req);
      if (!orgId) return res.status(401).json({ error: 'Cannot determine org' });

      // 1 — Parse
      const { headers, rows } = parseFile(req.file.buffer, req.file.mimetype, req.file.originalname);
      if (rows.length === 0) {
        return res.status(400).json({ error: 'File is empty or contains only headers' });
      }

      // 2 — Detect columns
      const detectedMapping = detectColumns(headers);
      // Apply any manual overrides from request
      const manualMapping = req.body.mapping ? JSON.parse(req.body.mapping) : {};
      const mapping = { ...detectedMapping, ...manualMapping };

      // 3 — Build context (dept/vendor lookups)
      const ctx = await buildContext(orgId);

      // 4 — Validate
      const { valid, invalid, warnings } = await validateRows(rows, type, mapping, ctx, opts);

      // 5 — Sample rows for UI preview
      const sample = valid.slice(0, 5).map(r => r.cleaned);

      return res.json({
        ok: true,
        fileName:        req.file.originalname,
        fileSize:        req.file.size,
        type,
        totalRows:       rows.length,
        validCount:      valid.length,
        invalidCount:    invalid.length,
        warningCount:    warnings.length,
        detectedMapping,
        appliedMapping:  mapping,
        unmappedHeaders: headers.filter(h => !Object.values(mapping).includes(h)),
        errors:          invalid.slice(0, 100).map(r => ({
          row:    r.rowNum,
          errors: r.errors,
          warnings: r.warnings,
        })),
        warnings: warnings.slice(0, 100).map(r => ({
          row:      r.rowNum,
          warnings: r.warnings,
        })),
        sample,
      });
    } catch (err) {
      console.error('[importController.previewImport]', err);
      return res.status(500).json({ error: err.message || 'Preview failed' });
    }
  },
];

// ─── POST /api/catalog/import/commit ─────────────────────────────────────────
/**
 * Full import: parse → validate → write to DB → record ImportJob.
 */
export const commitImport = [
  uploadMiddleware,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const type    = req.body.type;
      const storeId = req.body.storeId || null;
      const opts = {
        duplicateStrategy:     req.body.duplicateStrategy     || 'overwrite',
        unknownDeptStrategy:   req.body.unknownDeptStrategy   || 'skip',
        unknownVendorStrategy: req.body.unknownVendorStrategy || 'skip',
      };

      if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
      }

      const orgId  = getOrgId(req);
      const userId = getUserId(req);
      if (!orgId) return res.status(401).json({ error: 'Cannot determine org' });

      // 1 — Parse
      const { headers, rows } = parseFile(req.file.buffer, req.file.mimetype, req.file.originalname);
      if (rows.length === 0) return res.status(400).json({ error: 'File is empty' });

      // 2 — Detect + merge manual mapping
      const detectedMapping = detectColumns(headers);
      const manualMapping   = req.body.mapping ? JSON.parse(req.body.mapping) : {};
      const mapping         = { ...detectedMapping, ...manualMapping };

      // 3 — Build context
      const ctx = await buildContext(orgId);

      // 4 — Validate
      const { valid, invalid, warnings } = await validateRows(rows, type, mapping, ctx, opts);

      // 5 — Create import job record (status = importing)
      const job = await prisma.importJob.create({
        data: {
          orgId,
          storeId,
          type,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          totalRows: rows.length,
          status:   'importing',
          options:  opts,
          createdBy: String(userId || 'system'),
        },
      });

      // 6 — Import valid rows
      const result = await importRows(valid, type, orgId, storeId, opts);

      // 7 — Compile all errors (validation + runtime)
      const allErrors = [
        ...invalid.map(r => ({
          row:     r.rowNum,
          type:    'error',
          errors:  r.errors,
          warnings:r.warnings,
        })),
        ...result.errors.map(e => ({ type: 'error', ...e })),
        ...warnings.map(r => ({
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
          errors:      allErrors.slice(0, 500), // cap stored errors at 500 rows
          completedAt: new Date(),
        },
      });

      return res.json({
        ok: true,
        jobId:       completedJob.id,
        type,
        fileName:    req.file.originalname,
        totalRows:   rows.length,
        created:     result.created,
        updated:     result.updated,
        skipped:     result.skipped,
        failed:      invalid.length + result.errors.length,
        warnings:    warnings.length,
        errors:      allErrors.slice(0, 50), // return first 50 in response
        message:     `Import complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${invalid.length + result.errors.length} failed`,
      });
    } catch (err) {
      console.error('[importController.commitImport]', err);
      return res.status(500).json({ error: err.message || 'Import failed' });
    }
  },
];

// ─── GET /api/catalog/import/template/:type ───────────────────────────────────
export const getImportTemplate = (req, res) => {
  const { type } = req.params;
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
  }

  const buffer = generateTemplate(type);
  if (!buffer) return res.status(404).json({ error: 'Template not found' });

  const filename = `storeveu_import_template_${type}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  return res.send(buffer);
};

// ─── GET /api/catalog/import/history ─────────────────────────────────────────
export const getImportHistory = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Cannot determine org' });

    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const type  = req.query.type; // optional filter

    const where = { orgId, ...(type && VALID_TYPES.includes(type) ? { type } : {}) };

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
          // Omit full errors array from list view — fetch single job for details
        },
      }),
      prisma.importJob.count({ where }),
    ]);

    return res.json({
      ok: true,
      jobs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[importController.getImportHistory]', err);
    return res.status(500).json({ error: 'Failed to fetch import history' });
  }
};

// ─── GET /api/catalog/import/history/:id ─────────────────────────────────────
export const getImportJob = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const job   = await prisma.importJob.findUnique({ where: { id: parseInt(req.params.id) } });

    if (!job || job.orgId !== orgId) return res.status(404).json({ error: 'Job not found' });

    return res.json({ ok: true, job });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch job' });
  }
};
