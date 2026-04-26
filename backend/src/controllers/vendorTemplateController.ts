/**
 * vendorTemplateController.ts — Session 5
 *
 * CRUD + apply endpoints for VendorImportTemplate. Templates themselves are
 * superadmin-curated (global, not tenant-scoped) but every org can READ the
 * list to pick one at upload time.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { applyTemplate, validateTemplate, listTransforms as listTransformsFn } from '../services/vendorTemplateEngine.js';

interface MappingInput {
  vendorColumn?: string;
  targetField?: string | null;
  transform?: string | null;
  transformArgs?: unknown;
  constantValue?: string | null;
  skip?: boolean;
  sortOrder?: number;
}

interface TemplateBody {
  name?: string;
  slug?: string | null;
  description?: string | null;
  target?: string;
  vendorHint?: string | null;
  active?: boolean;
  mappings?: MappingInput[];
}

// ─── GET /api/vendor-templates ───────────────────────────────────────────────
// Public to any authenticated user — retailers need this to populate the
// "I'm uploading a file from: [vendor]" dropdown.
export const listVendorTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const { target, active } = req.query as { target?: string; active?: string };
    const where: Prisma.VendorImportTemplateWhereInput = {
      ...(target && { target }),
      ...(active !== undefined && { active: active === 'true' }),
    };
    const rows = await prisma.vendorImportTemplate.findMany({
      where,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { mappings: true } } },
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ─── GET /api/vendor-templates/:id ───────────────────────────────────────────
export const getVendorTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const tmpl = await prisma.vendorImportTemplate.findUnique({
      where: { id },
      include: { mappings: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!tmpl) { res.status(404).json({ success: false, error: 'Template not found' }); return; }
    res.json({ success: true, data: tmpl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ─── POST /api/vendor-templates (superadmin) ─────────────────────────────────
export const createVendorTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, slug, description, target, vendorHint, active, mappings = [] } = req.body as TemplateBody;

    const errs = validateTemplate({ name, target, mappings } as unknown as Parameters<typeof validateTemplate>[0]);
    if (errs.length) { res.status(400).json({ success: false, errors: errs }); return; }

    const tmpl = await prisma.vendorImportTemplate.create({
      data: {
        name: name as string,
        slug: slug || String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        description: description || null,
        target: target as string,
        vendorHint: vendorHint || null,
        active: active !== false,
        createdById: String(req.user?.id || 'system'),
        mappings: {
          create: (mappings as MappingInput[]).map((m: MappingInput, i: number) => ({
            vendorColumn:  m.vendorColumn || '',
            targetField:   m.targetField  || null,
            transform:     m.transform    || null,
            transformArgs: (m.transformArgs as Prisma.InputJsonValue) || undefined,
            constantValue: m.constantValue || null,
            skip:          !!m.skip,
            sortOrder:     m.sortOrder ?? i,
          })),
        },
      },
      include: { mappings: true },
    });
    res.status(201).json({ success: true, data: tmpl });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'P2002') { res.status(409).json({ success: false, error: 'A template with that slug already exists' }); return; }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ─── PUT /api/vendor-templates/:id (superadmin) ──────────────────────────────
export const updateVendorTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { name, slug, description, target, vendorHint, active, mappings } = req.body as TemplateBody;

    const updates: Prisma.VendorImportTemplateUpdateInput = {};
    if (name        !== undefined) updates.name        = name;
    if (slug        !== undefined) updates.slug        = slug || undefined;
    if (description !== undefined) updates.description = description || null;
    if (target      !== undefined) updates.target      = target;
    if (vendorHint  !== undefined) updates.vendorHint  = vendorHint || null;
    if (active      !== undefined) updates.active      = Boolean(active);

    // Replace-all semantics on mappings when the array is provided.
    if (Array.isArray(mappings)) {
      await prisma.vendorImportTemplateMapping.deleteMany({ where: { templateId: id } });
      await prisma.vendorImportTemplateMapping.createMany({
        data: mappings.map((m: MappingInput, i: number) => ({
          templateId:    id,
          vendorColumn:  m.vendorColumn || '',
          targetField:   m.targetField  || null,
          transform:     m.transform    || null,
          transformArgs: (m.transformArgs as Prisma.InputJsonValue) ?? undefined,
          constantValue: m.constantValue || null,
          skip:          !!m.skip,
          sortOrder:     m.sortOrder ?? i,
        })),
      });
    }

    const tmpl = await prisma.vendorImportTemplate.update({
      where: { id },
      data: updates,
      include: { mappings: { orderBy: { sortOrder: 'asc' } } },
    });
    res.json({ success: true, data: tmpl });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'P2025') { res.status(404).json({ success: false, error: 'Template not found' }); return; }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ─── DELETE /api/vendor-templates/:id (superadmin) ───────────────────────────
export const deleteVendorTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    await prisma.vendorImportTemplate.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'P2025') { res.status(404).json({ success: false, error: 'Template not found' }); return; }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

// ─── GET /api/vendor-templates/transforms ────────────────────────────────────
export const listTransforms = (_req: Request, res: Response): void => {
  res.json({ success: true, data: listTransformsFn() });
};

// ─── POST /api/vendor-templates/:id/preview ──────────────────────────────────
// Body: raw rows (or upload path via multipart — simpler here: JSON rows).
// Returns first 10 transformed rows so the retailer can sanity-check the
// template before committing the real import.
export const previewVendorTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const body = (req.body as { rows?: unknown[] } | undefined) || {};
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const tmpl = await prisma.vendorImportTemplate.findUnique({
      where: { id },
      include: { mappings: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!tmpl) { res.status(404).json({ success: false, error: 'Template not found' }); return; }

    const sample = rows.slice(0, 10) as Record<string, unknown>[];
    const { transformedRows, warnings } = applyTemplate(sample, tmpl);
    res.json({ success: true, data: { transformedRows, warnings, total: rows.length } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};
