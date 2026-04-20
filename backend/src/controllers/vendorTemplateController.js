/**
 * vendorTemplateController.js — Session 5
 *
 * CRUD + apply endpoints for VendorImportTemplate. Templates themselves are
 * superadmin-curated (global, not tenant-scoped) but every org can READ the
 * list to pick one at upload time.
 */

import prisma from '../config/postgres.js';
import { applyTemplate, validateTemplate, listTransforms as listTransformsFn } from '../services/vendorTemplateEngine.js';

// ─── GET /api/vendor-templates ───────────────────────────────────────────────
// Public to any authenticated user — retailers need this to populate the
// "I'm uploading a file from: [vendor]" dropdown.
export const listVendorTemplates = async (req, res) => {
  try {
    const { target, active } = req.query;
    const where = {
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
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── GET /api/vendor-templates/:id ───────────────────────────────────────────
export const getVendorTemplate = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const tmpl = await prisma.vendorImportTemplate.findUnique({
      where: { id },
      include: { mappings: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!tmpl) return res.status(404).json({ success: false, error: 'Template not found' });
    res.json({ success: true, data: tmpl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── POST /api/vendor-templates (superadmin) ─────────────────────────────────
export const createVendorTemplate = async (req, res) => {
  try {
    const { name, slug, description, target, vendorHint, active, mappings = [] } = req.body;

    const errs = validateTemplate({ name, target, mappings });
    if (errs.length) return res.status(400).json({ success: false, errors: errs });

    const tmpl = await prisma.vendorImportTemplate.create({
      data: {
        name,
        slug: slug || String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        description: description || null,
        target,
        vendorHint: vendorHint || null,
        active: active !== false,
        createdById: String(req.user?.id || 'system'),
        mappings: {
          create: mappings.map((m, i) => ({
            vendorColumn:  m.vendorColumn || '',
            targetField:   m.targetField  || null,
            transform:     m.transform    || null,
            transformArgs: m.transformArgs || null,
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
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'A template with that slug already exists' });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── PUT /api/vendor-templates/:id (superadmin) ──────────────────────────────
export const updateVendorTemplate = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, slug, description, target, vendorHint, active, mappings } = req.body;

    const updates = {};
    if (name        !== undefined) updates.name        = name;
    if (slug        !== undefined) updates.slug        = slug;
    if (description !== undefined) updates.description = description || null;
    if (target      !== undefined) updates.target      = target;
    if (vendorHint  !== undefined) updates.vendorHint  = vendorHint || null;
    if (active      !== undefined) updates.active      = Boolean(active);

    // Replace-all semantics on mappings when the array is provided.
    if (Array.isArray(mappings)) {
      await prisma.vendorImportTemplateMapping.deleteMany({ where: { templateId: id } });
      await prisma.vendorImportTemplateMapping.createMany({
        data: mappings.map((m, i) => ({
          templateId:    id,
          vendorColumn:  m.vendorColumn || '',
          targetField:   m.targetField  || null,
          transform:     m.transform    || null,
          transformArgs: m.transformArgs || null,
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
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Template not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── DELETE /api/vendor-templates/:id (superadmin) ───────────────────────────
export const deleteVendorTemplate = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.vendorImportTemplate.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Template not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── GET /api/vendor-templates/transforms ────────────────────────────────────
export const listTransforms = (_req, res) => {
  res.json({ success: true, data: listTransformsFn() });
};

// ─── POST /api/vendor-templates/:id/preview ──────────────────────────────────
// Body: raw rows (or upload path via multipart — simpler here: JSON rows).
// Returns first 10 transformed rows so the retailer can sanity-check the
// template before committing the real import.
export const previewVendorTemplate = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const tmpl = await prisma.vendorImportTemplate.findUnique({
      where: { id },
      include: { mappings: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!tmpl) return res.status(404).json({ success: false, error: 'Template not found' });

    const sample = rows.slice(0, 10);
    const { transformedRows, warnings } = applyTemplate(sample, tmpl);
    res.json({ success: true, data: { transformedRows, warnings, total: rows.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
