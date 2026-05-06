/**
 * Catalog — Departments + Department Attributes (Session 4 attrs).
 * Split from `catalogController.ts` (S81, refactor pass D, S53 pattern).
 *
 * Handlers:
 *   Departments (5):
 *     - getDepartments         GET    /catalog/departments
 *     - createDepartment       POST   /catalog/departments
 *     - updateDepartment       PUT    /catalog/departments/:id
 *                              (supports `cascadeToProducts: true` to push
 *                               taxClass/ageRequired/ebtEligible to all
 *                               products in the department)
 *     - deleteDepartment       DELETE /catalog/departments/:id
 *     - applyDepartmentTemplate POST  /catalog/departments/:id/apply
 *                              (S72 / C7 — force-push dept defaults to all
 *                               member products without changing the dept)
 *
 *   Department Attributes (5):
 *     - getDepartmentAttributes      GET    /catalog/department-attributes
 *     - createDepartmentAttribute    POST   /catalog/department-attributes
 *     - updateDepartmentAttribute    PUT    /catalog/department-attributes/:id
 *     - applyStandardAttributes      POST   /catalog/departments/:id/apply-standard-attributes
 *     - deleteDepartmentAttribute    DELETE /catalog/department-attributes/:id
 *
 * Cascade contract (CASCADABLE_DEPT_FIELDS): when an admin saves a dept with
 * `cascadeToProducts=true`, the changed values for `taxClass`, `ageRequired`,
 * and `ebtEligible` are pushed to every active, non-deleted product whose
 * `departmentId` matches. The cascade is whitelisted by name so a future
 * dept-field rename doesn't accidentally cascade unrelated columns.
 */

import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/postgres.js';
import { errMsg, errCode } from '../../utils/typeHelpers.js';
import { logAudit } from '../../services/auditService.js';
import { getOrgId, emitDepartmentSync } from './helpers.js';

// ═══════════════════════════════════════════════════════
// DEPARTMENTS
// ═══════════════════════════════════════════════════════

export const getDepartments = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const showInactive = req.query.includeInactive === 'true';

    const departments = await prisma.department.findMany({
      where: { orgId, ...(showInactive ? {} : { active: true }) },
      orderBy: { sortOrder: 'asc' },
      // Per-department product count — used by the cascade-edit modal so the
      // admin sees "Apply to 47 products?" before pulling the trigger. Counts
      // active, non-deleted products only (the cascade also targets only those).
      include: {
        _count: {
          select: { products: { where: { deleted: false } } },
        },
      },
    });

    res.json({ success: true, data: departments });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

const VALID_DEPT_CATEGORIES = ['wine', 'liquor', 'beer', 'tobacco', 'general'];

// Auto-guess a dept's category from name/code — used as a default when the
// retailer doesn't pick one explicitly. See also `categorize()` in seedDeptAttributes.
function guessDeptCategory(name: string, code: string | null | undefined): string | null {
  const n = String(name || '').toLowerCase();
  const c = String(code || '').toLowerCase();
  if (c === 'wine' || n.includes('wine') || n.includes('champagne') || n.includes('vino'))
    return 'wine';
  if (
    c === 'beer' ||
    n.includes('beer') ||
    n.includes('cerveza') ||
    n.includes('cider') ||
    n.includes('malt')
  )
    return 'beer';
  if (
    ['liquor', 'spirits', 'spirit', 'liq', 'spir'].includes(c) ||
    n.includes('liquor') ||
    n.includes('spirit') ||
    n.includes('whiskey') ||
    n.includes('licor')
  )
    return 'liquor';
  if (
    ['tobac', 'tobacco', 'vape', 'smoke'].some((t) => c.includes(t)) ||
    n.includes('tobacco') ||
    n.includes('vape') ||
    n.includes('cigar') ||
    n.includes('smoke')
  )
    return 'tobacco';
  return null;
}

export const createDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const {
      name,
      code,
      description,
      ageRequired,
      ebtEligible,
      taxClass,
      bottleDeposit,
      sortOrder,
      color,
      showInPOS,
      category,
    } = req.body;

    if (!name) {
      res.status(400).json({ success: false, error: 'name is required' });
      return;
    }

    // Explicit category wins; otherwise auto-guess from name/code.
    let finalCategory: string | null = null;
    if (category && VALID_DEPT_CATEGORIES.includes(category)) finalCategory = category;
    else if (category === null || category === '') finalCategory = null;
    else finalCategory = guessDeptCategory(name, code);

    const dept = await prisma.department.create({
      data: {
        orgId,
        name,
        code: code?.toUpperCase() || null,
        description: description || null,
        ageRequired: ageRequired ? parseInt(ageRequired) : null,
        ebtEligible: Boolean(ebtEligible),
        taxClass: taxClass || null,
        bottleDeposit: Boolean(bottleDeposit),
        sortOrder: parseInt(sortOrder) || 0,
        color: color || null,
        showInPOS: showInPOS !== undefined ? Boolean(showInPOS) : true,
        category: finalCategory,
      },
    });

    emitDepartmentSync(orgId, dept.id, 'create', dept);
    res.status(201).json({ success: true, data: dept });
  } catch (err) {
    if (errCode(err) === 'P2002') {
      res.status(409).json({ success: false, error: 'Department code already exists' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// Fields that exist on BOTH Department and MasterProduct and can be safely
// cascaded (i.e. an admin editing a department can opt-in to overwrite the
// same field on every product in that department). Mapping is dept-key →
// product-key — they happen to be identical names today but we keep the map
// explicit so future renames don't accidentally cascade unrelated fields.
const CASCADABLE_DEPT_FIELDS = {
  taxClass:     'taxClass',
  ageRequired:  'ageRequired',
  ebtEligible:  'ebtEligible',
} as const;

export const updateDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const {
      name,
      code,
      description,
      ageRequired,
      ebtEligible,
      taxClass,
      bottleDeposit,
      sortOrder,
      color,
      showInPOS,
      active,
      category,
      // Cascade controls — set by the dept-edit form when the admin opts in
      // to apply field changes to every product in this department.
      cascadeToProducts,   // boolean — true = cascade, missing/false = save dept only
      cascadedFields,      // string[] — which fields to cascade. Filtered against
                           // CASCADABLE_DEPT_FIELDS allowlist below.
    } = req.body;

    // Validate + normalize category. Empty string clears the category.
    let categoryUpdate: string | null | undefined;
    if (category !== undefined) {
      if (category === null || category === '') categoryUpdate = null;
      else if (VALID_DEPT_CATEGORIES.includes(category)) categoryUpdate = category;
      else {
        res.status(400).json({
          success: false,
          error: `Invalid category. Must be one of: ${VALID_DEPT_CATEGORIES.join(', ')}`,
        });
        return;
      }
    }

    const dept = await prisma.department.update({
      where: { id, orgId },
      data: {
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code: code?.toUpperCase() }),
        ...(description !== undefined && { description }),
        ...(ageRequired !== undefined && {
          ageRequired: ageRequired ? parseInt(ageRequired) : null,
        }),
        ...(ebtEligible !== undefined && { ebtEligible: Boolean(ebtEligible) }),
        ...(taxClass !== undefined && { taxClass }),
        ...(bottleDeposit !== undefined && { bottleDeposit: Boolean(bottleDeposit) }),
        ...(sortOrder !== undefined && { sortOrder: parseInt(sortOrder) }),
        ...(color !== undefined && { color }),
        ...(showInPOS !== undefined && { showInPOS: Boolean(showInPOS) }),
        ...(active !== undefined && { active: Boolean(active) }),
        ...(category !== undefined && { category: categoryUpdate }),
      },
    });

    // ── Cascade to products in this department (opt-in) ──────────────────
    // Only runs when the admin explicitly checks "apply to all products" in
    // the dept-edit modal. The frontend already shows them which fields
    // changed and the product count before they confirm. We strictly
    // filter to the allowlist (CASCADABLE_DEPT_FIELDS) so unrelated payload
    // keys can't sneak through and overwrite product fields.
    let productsUpdated = 0;
    if (cascadeToProducts && Array.isArray(cascadedFields) && cascadedFields.length > 0) {
      type CascadeKey = keyof typeof CASCADABLE_DEPT_FIELDS;
      const allowedKeys = Object.keys(CASCADABLE_DEPT_FIELDS) as CascadeKey[];
      const cascadeData: Record<string, unknown> = {};
      for (const key of cascadedFields as string[]) {
        if (!allowedKeys.includes(key as CascadeKey)) continue;
        const productKey = CASCADABLE_DEPT_FIELDS[key as CascadeKey];
        // Use the dept's POST-update value, not the request body — keeps the
        // cascade in sync with what got persisted (validated, normalized).
        cascadeData[productKey] = (dept as Record<string, unknown>)[key];
      }
      if (Object.keys(cascadeData).length > 0) {
        const result = await prisma.masterProduct.updateMany({
          where: { orgId, departmentId: id, deleted: false },
          data: cascadeData,
        });
        productsUpdated = result.count;
      }
    }

    emitDepartmentSync(orgId as string, dept.id, 'update', dept);
    res.json({ success: true, data: dept, productsUpdated });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Department not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

export const deleteDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const force = req.query.force === 'true';

    // Check for active product assignments before deactivating. This prevents
    // the silent-data-loss bug where a user deactivates a dept, then later
    // edits a product whose dept is no longer in the dropdown, saves, and
    // loses the assignment entirely.
    const usageCount = await prisma.masterProduct.count({
      where: { orgId, departmentId: id, deleted: false },
    });
    if (usageCount > 0 && !force) {
      res.status(409).json({
        success: false,
        code: 'IN_USE',
        error:
          `Cannot delete: ${usageCount} product(s) are assigned to this department. ` +
          `Reassign them first, or retry with ?force=true to detach them.`,
        usageCount,
      });
      return;
    }
    if (force && usageCount > 0) {
      // User opted into cascade — clear FK on every product referencing this
      // department so nothing breaks on future edits.
      await prisma.masterProduct.updateMany({
        where: { orgId, departmentId: id },
        data: { departmentId: null },
      });
    }

    // Soft delete — set active: false
    await prisma.department.update({ where: { id, orgId }, data: { active: false } });
    emitDepartmentSync(orgId as string, id, 'delete');
    res.json({
      success: true,
      message:
        force && usageCount > 0
          ? `Department deactivated; ${usageCount} product(s) detached`
          : 'Department deactivated',
      detachedCount: force ? usageCount : 0,
    });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Department not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ── S72 (C7) — Force-push department defaults to all member products ────────
// Mirrors the ProductGroup applyTemplate pattern. Pushes Department.ageRequired,
// .ebtEligible, and .taxClass onto every active product in the dept. Only
// non-null department fields cascade (so a dept that hasn't set ageRequired
// won't blank out products that have a value).
//
// Body: { fields?: ('ageRequired' | 'ebtEligible' | 'taxClass')[] }
//   Defaults to all three. Caller can opt to push just one or two.
//
// Response: { success: true, updated: number, fieldsApplied: string[] }
export const applyDepartmentTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const dept = await prisma.department.findFirst({ where: { id, orgId } });
    if (!dept) {
      res.status(404).json({ success: false, error: 'Department not found' });
      return;
    }

    const ALL_FIELDS = ['ageRequired', 'ebtEligible', 'taxClass'] as const;
    type CascadeField = typeof ALL_FIELDS[number];

    const requested: CascadeField[] = Array.isArray(req.body?.fields) && req.body.fields.length > 0
      ? (req.body.fields as string[]).filter((f): f is CascadeField =>
          (ALL_FIELDS as readonly string[]).includes(f))
      : [...ALL_FIELDS];

    if (requested.length === 0) {
      res.status(400).json({
        success: false,
        error: `fields must contain one or more of: ${ALL_FIELDS.join(', ')}`,
      });
      return;
    }

    // Build update payload — skip any field whose dept value is null. ebtEligible
    // is a non-null boolean, so it always cascades when requested.
    const update: Record<string, unknown> = {};
    const fieldsApplied: string[] = [];
    for (const f of requested) {
      const v = (dept as unknown as Record<string, unknown>)[f];
      if (v !== null && v !== undefined) {
        update[f] = v;
        fieldsApplied.push(f);
      }
    }

    if (fieldsApplied.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Department has no values set for the requested fields. Edit the department first, then re-run.',
        requested,
      });
      return;
    }

    const result = await prisma.masterProduct.updateMany({
      where: { orgId, departmentId: id, deleted: false, active: true },
      data: update as Prisma.MasterProductUpdateManyMutationInput,
    });

    res.json({
      success: true,
      updated: result.count,
      fieldsApplied,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// ═══════════════════════════════════════════════════════
// DEPARTMENT ATTRIBUTES (Session 4)
// ═══════════════════════════════════════════════════════

const VALID_ATTR_TYPES = ['text', 'decimal', 'integer', 'boolean', 'date', 'dropdown'];

// GET /api/catalog/department-attributes?departmentId=X
export const getDepartmentAttributes = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const departmentId = req.query.departmentId
      ? parseInt(req.query.departmentId as string)
      : null;

    const where =
      departmentId != null
        ? { orgId, active: true, OR: [{ departmentId }, { departmentId: null }] }
        : { orgId, active: true };

    const attrs = await prisma.departmentAttribute.findMany({
      where,
      orderBy: [{ departmentId: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
    });
    res.json({ success: true, data: attrs });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// POST /api/catalog/department-attributes
export const createDepartmentAttribute = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req) as string;
    const {
      departmentId,
      key,
      label,
      dataType,
      required,
      options,
      unit,
      placeholder,
      sortOrder,
    } = req.body;

    if (!key || !label) {
      res.status(400).json({ success: false, error: 'key and label are required' });
      return;
    }
    const normalizedKey = String(key).toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_');
    const type = VALID_ATTR_TYPES.includes(dataType) ? dataType : 'text';

    const attr = await prisma.departmentAttribute.create({
      data: {
        orgId,
        departmentId: departmentId ? parseInt(departmentId) : null,
        key: normalizedKey,
        label,
        dataType: type,
        required: Boolean(required),
        options: Array.isArray(options) ? options : [],
        unit: unit || null,
        placeholder: placeholder || null,
        sortOrder: Number.isFinite(+sortOrder) ? +sortOrder : 0,
      },
    });
    res.status(201).json({ success: true, data: attr });
  } catch (err) {
    if (errCode(err) === 'P2002') {
      res
        .status(409)
        .json({ success: false, error: 'An attribute with this key already exists for that department' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// PUT /api/catalog/department-attributes/:id
export const updateDepartmentAttribute = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const body = req.body;
    const updates: Record<string, unknown> = {};

    if (body.label !== undefined) updates.label = body.label;
    if (body.dataType !== undefined)
      updates.dataType = VALID_ATTR_TYPES.includes(body.dataType) ? body.dataType : 'text';
    if (body.required !== undefined) updates.required = Boolean(body.required);
    if (body.options !== undefined)
      updates.options = Array.isArray(body.options) ? body.options : [];
    if (body.unit !== undefined) updates.unit = body.unit || null;
    if (body.placeholder !== undefined) updates.placeholder = body.placeholder || null;
    if (body.sortOrder !== undefined)
      updates.sortOrder = Number.isFinite(+body.sortOrder) ? +body.sortOrder : 0;
    if (body.active !== undefined) updates.active = Boolean(body.active);

    const attr = await prisma.departmentAttribute.update({
      where: { id, orgId },
      data: updates,
    });
    res.json({ success: true, data: attr });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Attribute not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// POST /api/catalog/departments/:id/apply-standard-attributes
export const applyStandardAttributes = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const dept = await prisma.department.findFirst({ where: { id, orgId } });
    if (!dept) {
      res.status(404).json({ success: false, error: 'Department not found' });
      return;
    }
    const cat = dept.category;
    if (!cat || cat === 'general') {
      res.status(400).json({
        success: false,
        error: `Set category before applying standard attributes (got "${cat || 'none'}").`,
      });
      return;
    }

    interface AttrPreset {
      key: string;
      label: string;
      dataType: string;
      placeholder?: string;
      sortOrder: number;
      options?: string[];
      unit?: string;
    }

    const PRESETS: Record<string, AttrPreset[]> = {
      wine: [
        { key: 'vintage', label: 'Vintage Year', dataType: 'integer', placeholder: 'e.g. 2019', sortOrder: 1 },
        { key: 'country', label: 'Country', dataType: 'text', placeholder: 'e.g. France', sortOrder: 2 },
        { key: 'region', label: 'Region', dataType: 'text', placeholder: 'e.g. Napa Valley', sortOrder: 3 },
        { key: 'varietal', label: 'Varietal', dataType: 'text', placeholder: 'e.g. Cabernet Sauvignon', sortOrder: 4 },
        { key: 'colour', label: 'Colour', dataType: 'dropdown', options: ['Red', 'White', 'Rosé', 'Sparkling', 'Dessert'], sortOrder: 5 },
        { key: 'abv', label: 'ABV', dataType: 'decimal', unit: '%', placeholder: 'e.g. 13.5', sortOrder: 6 },
        { key: 'bottle_size', label: 'Bottle Size', dataType: 'text', placeholder: 'e.g. 750ml', sortOrder: 7 },
      ],
      liquor: [
        { key: 'type', label: 'Type', dataType: 'dropdown', options: ['Whiskey', 'Vodka', 'Gin', 'Rum', 'Tequila', 'Brandy', 'Liqueur', 'Other'], sortOrder: 1 },
        { key: 'country', label: 'Country', dataType: 'text', placeholder: 'e.g. Scotland', sortOrder: 2 },
        { key: 'proof', label: 'Proof', dataType: 'decimal', unit: '°', placeholder: 'e.g. 80', sortOrder: 3 },
        { key: 'abv', label: 'ABV', dataType: 'decimal', unit: '%', placeholder: 'e.g. 40.0', sortOrder: 4 },
        { key: 'bottle_size', label: 'Bottle Size', dataType: 'text', placeholder: 'e.g. 750ml', sortOrder: 5 },
      ],
      beer: [
        { key: 'style', label: 'Style', dataType: 'dropdown', options: ['Lager', 'IPA', 'Stout', 'Wheat', 'Pilsner', 'Sour', 'Ale', 'Cider', 'Other'], sortOrder: 1 },
        { key: 'container', label: 'Container', dataType: 'dropdown', options: ['Can', 'Bottle', 'Keg'], sortOrder: 2 },
        { key: 'abv', label: 'ABV', dataType: 'decimal', unit: '%', placeholder: 'e.g. 5.0', sortOrder: 3 },
        { key: 'country', label: 'Country', dataType: 'text', placeholder: 'e.g. Mexico', sortOrder: 4 },
        { key: 'pack_count', label: 'Pack Count', dataType: 'integer', placeholder: 'e.g. 6', sortOrder: 5 },
      ],
      tobacco: [
        { key: 'type', label: 'Type', dataType: 'dropdown', options: ['Cigarette', 'Cigar', 'Pipe', 'Smokeless', 'Vape', 'E-Liquid', 'Rolling Paper', 'Other'], sortOrder: 1 },
        { key: 'nicotine_strength', label: 'Nicotine Strength', dataType: 'text', placeholder: 'e.g. 6mg', sortOrder: 2 },
        { key: 'flavour', label: 'Flavour', dataType: 'text', placeholder: 'e.g. Menthol', sortOrder: 3 },
        { key: 'country', label: 'Country', dataType: 'text', placeholder: 'e.g. USA', sortOrder: 4 },
      ],
    };

    const preset = PRESETS[cat] || [];
    let applied = 0;
    for (const a of preset) {
      try {
        await prisma.departmentAttribute.upsert({
          where: { orgId_departmentId_key: { orgId, departmentId: id, key: a.key } },
          create: {
            orgId,
            departmentId: id,
            key: a.key,
            label: a.label,
            dataType: a.dataType,
            options: a.options || [],
            unit: a.unit || null,
            placeholder: a.placeholder || null,
            sortOrder: a.sortOrder || 0,
          },
          update: {}, // never overwrite operator customizations
        });
        applied++;
      } catch {
        /* skip collisions silently */
      }
    }
    res.json({ success: true, applied, total: preset.length, category: cat });
  } catch (err) {
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

// DELETE /api/catalog/department-attributes/:id
export const deleteDepartmentAttribute = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    await prisma.departmentAttribute.delete({ where: { id, orgId } });
    res.json({ success: true });
  } catch (err) {
    if (errCode(err) === 'P2025') {
      res.status(404).json({ success: false, error: 'Attribute not found' });
      return;
    }
    res.status(500).json({ success: false, error: errMsg(err) });
  }
};

