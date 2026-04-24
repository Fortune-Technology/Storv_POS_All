/**
 * Catalog Controller
 *
 * Handles the native POS product catalog stored in PostgreSQL.
 * All data is scoped to the requesting organization (req.tenantId / req.storeId).
 *
 * Endpoints cover:
 *   - Departments      GET/POST/PUT/DELETE
 *   - Tax Rules        GET/POST/PUT/DELETE
 *   - Deposit Rules    GET/POST/PUT/DELETE
 *   - Vendors          GET/POST/PUT/DELETE
 *   - Rebate Programs  GET/POST/PUT/DELETE
 *   - Master Products  GET/POST/PUT/DELETE + search + bulk
 *   - Store Products   GET/POST/PUT + stock adjustment
 */

import prisma from '../config/postgres.js';
import { parsePrice } from '../utils/validators.js';
import * as XLSX from 'xlsx';
import { logAudit } from '../services/auditService.js';

// ── Safe price coercer ─────────────────────────────────────────────────────
// Wrap parsePrice so controllers can one-line the transform.
// Returns parsed value or null. Throws a 400-formatted Error on invalid input
// (caught by the controller try/catch — do not swallow silently).
function toPrice(value, field) {
  const r = parsePrice(value, { min: 0, max: 9999999, allowNull: true });
  if (!r.ok) {
    const e = new Error(`${field}: ${r.error}`);
    e.status = 400;
    throw e;
  }
  return r.value;
}
import { normalizeUPC, upcVariants, stripUpc } from '../utils/upc.js';
import { batchResolveProductImages } from '../services/globalImageService.js';
import { queueLabelForPriceChange, queueLabelForNewProduct, queueLabelForSale } from '../services/labelQueueService.js';
import { tryParseDate } from '../utils/safeDate.js';

// E-commerce sync — optional. If Redis / @storv/queue is not installed, all emit
// functions are silent no-ops. POS operations are never blocked.
let emitProductSync = async () => {};
let emitDepartmentSync = async () => {};
let emitInventorySync = async () => {};
try {
  const producers = await import('@storv/queue/producers');
  emitProductSync = producers.emitProductSync;
  emitDepartmentSync = producers.emitDepartmentSync;
  emitInventorySync = producers.emitInventorySync;
} catch {
  console.log('⚠ @storv/queue not available — e-commerce sync disabled (this is fine if not using e-commerce)');
}

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

const getOrgId = (req) => req.tenantId || req.user?.tenantId || req.user?.orgId;
const getStoreId = (req) => req.storeId;

// ─────────────────────────────────────────────────
// Deposit flattener — normalises every product payload so downstream
// consumers (cashier cart, portal table, reports) can read a single
// `depositAmount` field regardless of whether the deposit was set via
// the new `MasterProduct.depositPerUnit` scalar or the legacy nested
// DepositRule. Must stay in lockstep with the formula in
// posTerminalController.js → getCatalogSnapshot.
//
// Session 39 Round 5 — previously only the snapshot endpoint flattened
// this; the online-scan fallback (searchMasterProducts, getMasterProduct)
// returned raw Prisma rows so the cashier cart read `undefined` and
// silently dropped the deposit on any cache-miss scan.
// ─────────────────────────────────────────────────
const flattenDeposit = (p) => {
  if (!p) return p;
  const depositAmount =
    p.depositPerUnit != null ? Number(p.depositPerUnit) :
    p.depositRule              ? Number(p.depositRule.depositAmount) * (p.sellUnitSize || 1) :
    null;
  return { ...p, depositAmount };
};

const paginationParams = (query) => {
  const page  = Math.max(1, parseInt(query.page)  || 1);
  const limit = Math.min(500, Math.max(1, parseInt(query.limit) || 50));
  return { skip: (page - 1) * limit, take: limit, page, limit };
};

// ═══════════════════════════════════════════════════════
// DEPARTMENTS
// ═══════════════════════════════════════════════════════

export const getDepartments = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const showInactive = req.query.includeInactive === 'true';

    const departments = await prisma.department.findMany({
      where: { orgId, ...(showInactive ? {} : { active: true }) },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ success: true, data: departments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

const VALID_DEPT_CATEGORIES = ['wine','liquor','beer','tobacco','general'];

// Auto-guess a dept's category from name/code — used as a default when the
// retailer doesn't pick one explicitly. See also `categorize()` in seedDeptAttributes.
function guessDeptCategory(name, code) {
  const n = String(name || '').toLowerCase();
  const c = String(code || '').toLowerCase();
  if (c === 'wine' || n.includes('wine') || n.includes('champagne') || n.includes('vino')) return 'wine';
  if (c === 'beer' || n.includes('beer') || n.includes('cerveza') || n.includes('cider') || n.includes('malt')) return 'beer';
  if (['liquor','spirits','spirit','liq','spir'].includes(c) || n.includes('liquor') || n.includes('spirit') || n.includes('whiskey') || n.includes('licor')) return 'liquor';
  if (['tobac','tobacco','vape','smoke'].some(t => c.includes(t)) || n.includes('tobacco') || n.includes('vape') || n.includes('cigar') || n.includes('smoke')) return 'tobacco';
  return null;
}

export const createDepartment = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { name, code, description, ageRequired, ebtEligible, taxClass,
            bottleDeposit, sortOrder, color, showInPOS, category } = req.body;

    if (!name) return res.status(400).json({ success: false, error: 'name is required' });

    // Explicit category wins; otherwise auto-guess from name/code.
    let finalCategory = null;
    if (category && VALID_DEPT_CATEGORIES.includes(category)) finalCategory = category;
    else if (category === null || category === '') finalCategory = null;
    else finalCategory = guessDeptCategory(name, code);

    const dept = await prisma.department.create({
      data: {
        orgId,
        name,
        code:          code?.toUpperCase() || null,
        description:   description || null,
        ageRequired:   ageRequired ? parseInt(ageRequired) : null,
        ebtEligible:   Boolean(ebtEligible),
        taxClass:      taxClass || null,
        bottleDeposit: Boolean(bottleDeposit),
        sortOrder:     parseInt(sortOrder) || 0,
        color:         color || null,
        showInPOS:     showInPOS !== undefined ? Boolean(showInPOS) : true,
        category:      finalCategory,
      },
    });

    emitDepartmentSync(orgId, dept.id, 'create', dept);
    res.status(201).json({ success: true, data: dept });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, error: 'Department code already exists' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateDepartment = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const { name, code, description, ageRequired, ebtEligible, taxClass,
            bottleDeposit, sortOrder, color, showInPOS, active, category } = req.body;

    // Validate + normalize category. Empty string clears the category.
    let categoryUpdate;
    if (category !== undefined) {
      if (category === null || category === '') categoryUpdate = null;
      else if (VALID_DEPT_CATEGORIES.includes(category)) categoryUpdate = category;
      else return res.status(400).json({ success: false, error: `Invalid category. Must be one of: ${VALID_DEPT_CATEGORIES.join(', ')}` });
    }

    const dept = await prisma.department.update({
      where: { id, orgId },
      data: {
        ...(name          !== undefined && { name }),
        ...(code          !== undefined && { code: code?.toUpperCase() }),
        ...(description   !== undefined && { description }),
        ...(ageRequired   !== undefined && { ageRequired: ageRequired ? parseInt(ageRequired) : null }),
        ...(ebtEligible   !== undefined && { ebtEligible: Boolean(ebtEligible) }),
        ...(taxClass      !== undefined && { taxClass }),
        ...(bottleDeposit !== undefined && { bottleDeposit: Boolean(bottleDeposit) }),
        ...(sortOrder     !== undefined && { sortOrder: parseInt(sortOrder) }),
        ...(color         !== undefined && { color }),
        ...(showInPOS     !== undefined && { showInPOS: Boolean(showInPOS) }),
        ...(active        !== undefined && { active: Boolean(active) }),
        ...(category      !== undefined && { category: categoryUpdate }),
      },
    });

    emitDepartmentSync(orgId, dept.id, 'update', dept);
    res.json({ success: true, data: dept });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Department not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteDepartment = async (req, res) => {
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
      return res.status(409).json({
        success: false,
        code: 'IN_USE',
        error: `Cannot delete: ${usageCount} product(s) are assigned to this department. ` +
               `Reassign them first, or retry with ?force=true to detach them.`,
        usageCount,
      });
    }
    if (force && usageCount > 0) {
      // User opted into cascade — clear FK on every product referencing this
      // department so nothing breaks on future edits.
      await prisma.masterProduct.updateMany({
        where: { orgId, departmentId: id },
        data:  { departmentId: null },
      });
    }

    // Soft delete — set active: false
    await prisma.department.update({ where: { id, orgId }, data: { active: false } });
    emitDepartmentSync(orgId, id, 'delete');
    res.json({
      success: true,
      message: force && usageCount > 0
        ? `Department deactivated; ${usageCount} product(s) detached`
        : 'Department deactivated',
      detachedCount: force ? usageCount : 0,
    });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Department not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════
// DEPARTMENT ATTRIBUTES (Session 4)
// Typed metadata fields per department — Wine has Vintage / Country,
// Liquor has Proof / ABV, etc. Product Form loads these dynamically.
// ═══════════════════════════════════════════════════════

const VALID_ATTR_TYPES = ['text','decimal','integer','boolean','date','dropdown'];

// GET /api/catalog/department-attributes?departmentId=X
// Returns attributes for a specific department + org-wide (departmentId=null) ones
export const getDepartmentAttributes = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const departmentId = req.query.departmentId ? parseInt(req.query.departmentId) : null;

    const where = departmentId != null
      ? { orgId, active: true, OR: [{ departmentId }, { departmentId: null }] }
      : { orgId, active: true };

    const attrs = await prisma.departmentAttribute.findMany({
      where,
      orderBy: [{ departmentId: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
    });
    res.json({ success: true, data: attrs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/catalog/department-attributes
export const createDepartmentAttribute = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { departmentId, key, label, dataType, required, options, unit, placeholder, sortOrder } = req.body;

    if (!key || !label) return res.status(400).json({ success: false, error: 'key and label are required' });
    const normalizedKey = String(key).toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_');
    const type = VALID_ATTR_TYPES.includes(dataType) ? dataType : 'text';

    const attr = await prisma.departmentAttribute.create({
      data: {
        orgId,
        departmentId: departmentId ? parseInt(departmentId) : null,
        key:          normalizedKey,
        label,
        dataType:     type,
        required:     Boolean(required),
        options:      Array.isArray(options) ? options : [],
        unit:         unit || null,
        placeholder:  placeholder || null,
        sortOrder:    Number.isFinite(+sortOrder) ? +sortOrder : 0,
      },
    });
    res.status(201).json({ success: true, data: attr });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'An attribute with this key already exists for that department' });
    res.status(500).json({ success: false, error: err.message });
  }
};

// PUT /api/catalog/department-attributes/:id
export const updateDepartmentAttribute = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const body = req.body;
    const updates = {};

    if (body.label        !== undefined) updates.label        = body.label;
    if (body.dataType     !== undefined) updates.dataType     = VALID_ATTR_TYPES.includes(body.dataType) ? body.dataType : 'text';
    if (body.required     !== undefined) updates.required     = Boolean(body.required);
    if (body.options      !== undefined) updates.options      = Array.isArray(body.options) ? body.options : [];
    if (body.unit         !== undefined) updates.unit         = body.unit || null;
    if (body.placeholder  !== undefined) updates.placeholder  = body.placeholder || null;
    if (body.sortOrder    !== undefined) updates.sortOrder    = Number.isFinite(+body.sortOrder) ? +body.sortOrder : 0;
    if (body.active       !== undefined) updates.active       = Boolean(body.active);

    const attr = await prisma.departmentAttribute.update({
      where: { id, orgId },
      data: updates,
    });
    res.json({ success: true, data: attr });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Attribute not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/catalog/departments/:id/apply-standard-attributes
// Seeds the alcohol/tobacco attribute preset for a department's `category`.
// Idempotent — upserts on (orgId, departmentId, key). Never overwrites existing.
export const applyStandardAttributes = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const dept = await prisma.department.findFirst({ where: { id, orgId } });
    if (!dept) return res.status(404).json({ success: false, error: 'Department not found' });
    const cat = dept.category;
    if (!cat || cat === 'general') {
      return res.status(400).json({ success: false, error: `Set category before applying standard attributes (got "${cat || 'none'}").` });
    }

    // Same presets as seedDeptAttributes.js — single source of truth at runtime.
    const PRESETS = {
      wine: [
        { key: 'vintage',  label: 'Vintage Year',  dataType: 'integer', placeholder: 'e.g. 2019', sortOrder: 1 },
        { key: 'country',  label: 'Country',       dataType: 'text',    placeholder: 'e.g. France', sortOrder: 2 },
        { key: 'region',   label: 'Region',        dataType: 'text',    placeholder: 'e.g. Napa Valley', sortOrder: 3 },
        { key: 'varietal', label: 'Varietal',      dataType: 'text',    placeholder: 'e.g. Cabernet Sauvignon', sortOrder: 4 },
        { key: 'colour',   label: 'Colour',        dataType: 'dropdown', options: ['Red','White','Rosé','Sparkling','Dessert'], sortOrder: 5 },
        { key: 'abv',      label: 'ABV',           dataType: 'decimal', unit: '%', placeholder: 'e.g. 13.5', sortOrder: 6 },
        { key: 'bottle_size', label: 'Bottle Size', dataType: 'text',  placeholder: 'e.g. 750ml', sortOrder: 7 },
      ],
      liquor: [
        { key: 'type',     label: 'Type',      dataType: 'dropdown', options: ['Whiskey','Vodka','Gin','Rum','Tequila','Brandy','Liqueur','Other'], sortOrder: 1 },
        { key: 'country',  label: 'Country',   dataType: 'text',    placeholder: 'e.g. Scotland', sortOrder: 2 },
        { key: 'proof',    label: 'Proof',     dataType: 'decimal', unit: '°',  placeholder: 'e.g. 80', sortOrder: 3 },
        { key: 'abv',      label: 'ABV',       dataType: 'decimal', unit: '%',  placeholder: 'e.g. 40.0', sortOrder: 4 },
        { key: 'bottle_size', label: 'Bottle Size', dataType: 'text', placeholder: 'e.g. 750ml', sortOrder: 5 },
      ],
      beer: [
        { key: 'style',       label: 'Style',      dataType: 'dropdown', options: ['Lager','IPA','Stout','Wheat','Pilsner','Sour','Ale','Cider','Other'], sortOrder: 1 },
        { key: 'container',   label: 'Container',  dataType: 'dropdown', options: ['Can','Bottle','Keg'], sortOrder: 2 },
        { key: 'abv',         label: 'ABV',        dataType: 'decimal', unit: '%', placeholder: 'e.g. 5.0', sortOrder: 3 },
        { key: 'country',     label: 'Country',    dataType: 'text',    placeholder: 'e.g. Mexico', sortOrder: 4 },
        { key: 'pack_count',  label: 'Pack Count', dataType: 'integer', placeholder: 'e.g. 6', sortOrder: 5 },
      ],
      tobacco: [
        { key: 'type',             label: 'Type',              dataType: 'dropdown', options: ['Cigarette','Cigar','Pipe','Smokeless','Vape','E-Liquid','Rolling Paper','Other'], sortOrder: 1 },
        { key: 'nicotine_strength',label: 'Nicotine Strength', dataType: 'text',    placeholder: 'e.g. 6mg', sortOrder: 2 },
        { key: 'flavour',          label: 'Flavour',           dataType: 'text',    placeholder: 'e.g. Menthol', sortOrder: 3 },
        { key: 'country',          label: 'Country',           dataType: 'text',    placeholder: 'e.g. USA', sortOrder: 4 },
      ],
    };

    const preset = PRESETS[cat] || [];
    let applied = 0;
    for (const a of preset) {
      try {
        await prisma.departmentAttribute.upsert({
          where:  { orgId_departmentId_key: { orgId, departmentId: id, key: a.key } },
          create: { orgId, departmentId: id, key: a.key, label: a.label, dataType: a.dataType, options: a.options || [], unit: a.unit || null, placeholder: a.placeholder || null, sortOrder: a.sortOrder || 0 },
          update: {}, // never overwrite operator customizations
        });
        applied++;
      } catch { /* skip collisions silently */ }
    }
    res.json({ success: true, applied, total: preset.length, category: cat });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// DELETE /api/catalog/department-attributes/:id
export const deleteDepartmentAttribute = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    await prisma.departmentAttribute.delete({ where: { id, orgId } });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Attribute not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════
// TAX RULES
// ═══════════════════════════════════════════════════════

export const getTaxRules = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const storeId = req.query.storeId || null;

    const rules = await prisma.taxRule.findMany({
      where: {
        orgId,
        active: true,
        ...(storeId ? { OR: [{ storeId }, { storeId: null }] } : { storeId: null }),
      },
      orderBy: { appliesTo: 'asc' },
    });

    res.json({ success: true, data: rules });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Normalize departmentIds input — accept number[], string[] (IDs as strings),
// or a single value. Returns a clean number[] with invalid entries dropped.
function normalizeDeptIds(raw) {
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map(v => (typeof v === 'number' ? v : parseInt(String(v), 10)))
    .filter(n => Number.isFinite(n) && n > 0);
}

export const createTaxRule = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { name, description, rate, appliesTo, ebtExempt, state, county, storeId, departmentIds } = req.body;

    // With the dept-linked matcher (Option B) a rule can target either a set
    // of departments OR a class string (appliesTo). At least one must be set.
    const deptIds = normalizeDeptIds(departmentIds);
    const hasClass = appliesTo && String(appliesTo).trim() !== '';
    if (!name || rate == null || (!hasClass && deptIds.length === 0)) {
      return res.status(400).json({ success: false, error: 'name, rate, and either departments or appliesTo are required' });
    }

    const rule = await prisma.taxRule.create({
      data: {
        orgId,
        storeId: storeId || null,
        name,
        description: description || null,
        rate,
        appliesTo: hasClass ? appliesTo : 'all', // keep the column populated for legacy callers
        departmentIds: deptIds,
        ebtExempt: ebtExempt !== false,
        state: state || null,
        county: county || null,
      },
    });

    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateTaxRule = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    // Sanitize the body — only allow known fields + normalize departmentIds.
    const body = req.body || {};
    const data = {};
    if (body.name        !== undefined) data.name        = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.rate        !== undefined) data.rate        = body.rate;
    if (body.appliesTo   !== undefined) data.appliesTo   = body.appliesTo || 'all';
    if (body.ebtExempt   !== undefined) data.ebtExempt   = Boolean(body.ebtExempt);
    if (body.state       !== undefined) data.state       = body.state || null;
    if (body.county      !== undefined) data.county      = body.county || null;
    if (body.storeId     !== undefined) data.storeId     = body.storeId || null;
    if (body.active      !== undefined) data.active      = Boolean(body.active);
    if (body.departmentIds !== undefined) data.departmentIds = normalizeDeptIds(body.departmentIds);

    const rule = await prisma.taxRule.update({
      where: { id, orgId },
      data,
    });

    res.json({ success: true, data: rule });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Tax rule not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteTaxRule = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const force = req.query.force === 'true';

    // Session 40 Phase 1 — same FK-usage safeguard as deleteDepartment /
    // deleteVendor. Blocks deactivation when products have a hard FK to this
    // rule; `?force=true` cascades by clearing taxRuleId on all referencing
    // products (falls back to the legacy taxClass match afterwards).
    const usageCount = await prisma.masterProduct.count({
      where: { orgId, taxRuleId: id, deleted: false },
    });
    if (usageCount > 0 && !force) {
      return res.status(409).json({
        success: false,
        code: 'IN_USE',
        error: `Cannot delete: ${usageCount} product(s) have this as their explicit tax rule. ` +
               `Reassign them first, or retry with ?force=true to detach them (they'll fall back to the legacy taxClass matcher).`,
        usageCount,
      });
    }
    if (force && usageCount > 0) {
      await prisma.masterProduct.updateMany({
        where: { orgId, taxRuleId: id },
        data:  { taxRuleId: null },
      });
    }

    await prisma.taxRule.update({ where: { id, orgId }, data: { active: false } });
    res.json({
      success: true,
      message: force && usageCount > 0
        ? `Tax rule deactivated; ${usageCount} product(s) detached`
        : 'Tax rule deactivated',
      detachedCount: force ? usageCount : 0,
    });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Tax rule not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════
// DEPOSIT RULES
// ═══════════════════════════════════════════════════════

export const getDepositRules = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const rules = await prisma.depositRule.findMany({
      where: { orgId, active: true },
      orderBy: { minVolumeOz: 'asc' },
    });
    res.json({ success: true, data: rules });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createDepositRule = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { name, description, minVolumeOz, maxVolumeOz, containerTypes, depositAmount, state } = req.body;

    if (!name || depositAmount == null) {
      return res.status(400).json({ success: false, error: 'name and depositAmount are required' });
    }

    const rule = await prisma.depositRule.create({
      data: {
        orgId,
        name,
        description: description || null,
        minVolumeOz: minVolumeOz != null ? parseFloat(minVolumeOz) : null,
        maxVolumeOz: maxVolumeOz != null ? parseFloat(maxVolumeOz) : null,
        containerTypes: containerTypes || 'bottle,can',
        depositAmount,
        state: state || null,
      },
    });

    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateDepositRule = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const rule = await prisma.depositRule.update({ where: { id, orgId }, data: req.body });
    res.json({ success: true, data: rule });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Deposit rule not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════
// VENDORS
// ═══════════════════════════════════════════════════════

export const getVendors = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const showInactive = req.query.includeInactive === 'true';

    const vendors = await prisma.vendor.findMany({
      where: { orgId, ...(showInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: vendors });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createVendor = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { name, code, contactName, email, phone, address, website, terms, accountNo, aliases, autoSyncCostFromInvoice } = req.body;

    if (!name) return res.status(400).json({ success: false, error: 'name is required' });

    const vendor = await prisma.vendor.create({
      data: {
        orgId,
        name,
        code:        code || null,
        contactName: contactName || null,
        email:       email || null,
        phone:       phone || null,
        address:     address || null,
        website:     website || null,
        terms:       terms || null,
        accountNo:   accountNo || null,
        aliases:     Array.isArray(aliases) ? aliases : [],
        // Defaults to true — existing behavior (auto-sync cost) preserved for new vendors
        autoSyncCostFromInvoice: autoSyncCostFromInvoice === false ? false : true,
      },
    });

    res.status(201).json({ success: true, data: vendor });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'Vendor with this name already exists' });
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateVendor = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    // Explicit whitelist — don't pass req.body straight into data. Previously
    // any client could include orgId/id/aliases and have them overwritten
    // silently (tenant-hopping risk). Now every field is individually validated
    // and coerced; unknown keys are ignored.
    const body = req.body || {};
    const updates = {};
    if (body.name        !== undefined) updates.name        = body.name;
    if (body.code        !== undefined) updates.code        = body.code || null;
    if (body.contactName !== undefined) updates.contactName = body.contactName || null;
    if (body.email       !== undefined) updates.email       = body.email || null;
    if (body.phone       !== undefined) updates.phone       = body.phone || null;
    if (body.address     !== undefined) updates.address     = body.address || null;
    if (body.website     !== undefined) updates.website     = body.website || null;
    if (body.terms       !== undefined) updates.terms       = body.terms || null;
    if (body.accountNo   !== undefined) updates.accountNo   = body.accountNo || null;
    if (body.aliases     !== undefined) updates.aliases     = Array.isArray(body.aliases) ? body.aliases : [];
    if (body.active      !== undefined) updates.active      = Boolean(body.active);
    // Invoice cost sync (per-vendor override when store mode = 'per-vendor')
    if (body.autoSyncCostFromInvoice !== undefined) updates.autoSyncCostFromInvoice = Boolean(body.autoSyncCostFromInvoice);

    const vendor = await prisma.vendor.update({
      where: { id, orgId },
      data: updates,
    });

    res.json({ success: true, data: vendor });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Vendor not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteVendor = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const force = req.query.force === 'true';

    // Same FK-usage safeguard as deleteDepartment. Prevents silent loss of
    // vendor assignments when a product with a now-deactivated vendor is
    // later edited and saved.
    const usageCount = await prisma.masterProduct.count({
      where: { orgId, vendorId: id, deleted: false },
    });
    if (usageCount > 0 && !force) {
      return res.status(409).json({
        success: false,
        code: 'IN_USE',
        error: `Cannot delete: ${usageCount} product(s) are assigned to this vendor. ` +
               `Reassign them first, or retry with ?force=true to detach them.`,
        usageCount,
      });
    }
    if (force && usageCount > 0) {
      await prisma.masterProduct.updateMany({
        where: { orgId, vendorId: id },
        data:  { vendorId: null },
      });
    }

    await prisma.vendor.update({ where: { id, orgId }, data: { active: false } });
    res.json({
      success: true,
      message: force && usageCount > 0
        ? `Vendor deactivated; ${usageCount} product(s) detached`
        : 'Vendor deactivated',
      detachedCount: force ? usageCount : 0,
    });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Vendor not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── Vendor Detail Endpoints ─────────────────────────────────────────────────

export const getVendor = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const vendor = await prisma.vendor.findFirst({
      where: { id, orgId },
      include: {
        products: {
          select: { id: true, name: true, sku: true, upc: true, defaultRetailPrice: true, active: true, departmentId: true },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found' });
    res.json({ success: true, data: vendor });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCT-VENDOR MAPPINGS — per-vendor item code + cost + primary flag
// ═══════════════════════════════════════════════════════════════════════════
// One MasterProduct × many vendors. Each (product, vendor) pair gets its own
// item code / cost / optional case-pack override. Exactly one mapping per
// product is flagged `isPrimary: true`; that mapping's vendorItemCode is
// mirrored back into `MasterProduct.itemCode` for legacy readers.

/**
 * Internal helper: ensure primary invariant.
 * After any mutation that changes the primary set for a product, this runs
 * within the same transaction:
 *   - If the target mapping is being set primary, clear isPrimary on all
 *     other mappings for that product.
 *   - Mirror the (new) primary's vendorItemCode back into MasterProduct.itemCode.
 *   - If no primary exists after the mutation (e.g. deleted the only primary),
 *     pick the mapping with the most recent lastReceivedAt (falling back to
 *     newest createdAt) and promote it. This preserves the invariant that
 *     every product with ≥1 mapping has exactly one primary.
 */
async function _reconcilePrimary(tx, orgId, masterProductId) {
  const mappings = await tx.productVendor.findMany({
    where: { orgId, masterProductId },
    orderBy: [
      { isPrimary: 'desc' },
      { lastReceivedAt: 'desc' },
      { createdAt: 'desc' },
    ],
  });
  if (mappings.length === 0) {
    // No mappings left — clear itemCode to match.
    await tx.masterProduct.update({
      where: { id: masterProductId, orgId },
      data:  { itemCode: null },
    }).catch(() => {});
    return;
  }
  const primaries = mappings.filter(m => m.isPrimary);
  let primary;
  if (primaries.length === 1) {
    primary = primaries[0];
  } else if (primaries.length === 0) {
    // No primary — promote the top of the ordered list (latest invoice).
    primary = mappings[0];
    await tx.productVendor.update({
      where: { id: primary.id },
      data:  { isPrimary: true },
    });
  } else {
    // More than one primary — keep the first (ordered by lastReceivedAt
    // desc) and clear the rest.
    primary = primaries[0];
    await tx.productVendor.updateMany({
      where: { orgId, masterProductId, isPrimary: true, NOT: { id: primary.id } },
      data:  { isPrimary: false },
    });
  }
  // Mirror back to MasterProduct.itemCode
  await tx.masterProduct.update({
    where: { id: masterProductId, orgId },
    data:  { itemCode: primary.vendorItemCode || null },
  }).catch(() => {});
}

/**
 * Upsert-on-receive — called from invoice import post-processing and bulk CSV.
 * Ensures there's a ProductVendor row for (product, vendor) and updates
 * lastReceivedAt. When the product has no primary yet, this upsert's row
 * becomes primary (first-invoice-wins rule per user spec).
 *
 * Exported so invoiceController + importService can call it directly.
 *
 * @param {string} orgId
 * @param {number} masterProductId
 * @param {number} vendorId
 * @param {object} data  - { vendorItemCode?, description?, priceCost?, caseCost?, packInCase?, lastReceivedAt? }
 * @param {object} [opts] - { tx? } to reuse an existing transaction
 */
export async function upsertProductVendor(orgId, masterProductId, vendorId, data = {}, opts = {}) {
  const db = opts.tx || prisma;
  const {
    vendorItemCode, description, priceCost, caseCost, packInCase,
    lastReceivedAt,
  } = data;

  // Find existing
  const existing = await db.productVendor.findUnique({
    where: { orgId_masterProductId_vendorId: { orgId, masterProductId, vendorId } },
  });

  // Decide primary: if no mapping exists for this product yet, this one
  // becomes primary. Otherwise, preserve whatever the current primary is.
  let shouldBecomePrimary = false;
  if (!existing) {
    const anyMapping = await db.productVendor.findFirst({
      where: { orgId, masterProductId },
      select: { id: true },
    });
    if (!anyMapping) shouldBecomePrimary = true;
  }

  const upsertData = {
    ...(vendorItemCode !== undefined && { vendorItemCode: vendorItemCode || null }),
    ...(description    !== undefined && { description:    description || null }),
    ...(priceCost      !== undefined && { priceCost:      priceCost != null && priceCost !== '' ? parseFloat(priceCost) : null }),
    ...(caseCost       !== undefined && { caseCost:       caseCost  != null && caseCost  !== '' ? parseFloat(caseCost)  : null }),
    ...(packInCase     !== undefined && { packInCase:     packInCase != null && packInCase !== '' ? parseInt(packInCase) : null }),
    ...(lastReceivedAt !== undefined && { lastReceivedAt: lastReceivedAt ? new Date(lastReceivedAt) : null }),
  };

  const row = await db.productVendor.upsert({
    where: { orgId_masterProductId_vendorId: { orgId, masterProductId, vendorId } },
    create: {
      orgId, masterProductId, vendorId,
      ...upsertData,
      isPrimary: shouldBecomePrimary,
    },
    update: upsertData,  // don't touch isPrimary on re-upsert — user controls it
  });

  // If this upsert created the first mapping, backfill MasterProduct.itemCode
  // to the new vendorItemCode so auto-order + catalog list still show something.
  if (shouldBecomePrimary && row.vendorItemCode) {
    await db.masterProduct.update({
      where: { id: masterProductId, orgId },
      data:  { itemCode: row.vendorItemCode },
    }).catch(() => {});
  }

  return row;
}

/** GET /api/catalog/products/:id/vendor-mappings */
export const listProductVendors = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const mappings = await prisma.productVendor.findMany({
      where: { orgId, masterProductId },
      include: { vendor: { select: { id: true, name: true, code: true } } },
      orderBy: [
        { isPrimary: 'desc' },
        { lastReceivedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });
    res.json({ success: true, data: mappings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/** POST /api/catalog/products/:id/vendor-mappings */
export const createProductVendor = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const { vendorId, vendorItemCode, description, priceCost, caseCost, packInCase, notes, isPrimary } = req.body;

    if (!vendorId) return res.status(400).json({ success: false, error: 'vendorId is required' });

    // Make sure the product exists and belongs to this org — prevents creating
    // orphan mappings via direct API.
    const product = await prisma.masterProduct.findFirst({
      where: { id: masterProductId, orgId },
      select: { id: true },
    });
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

    // Same for vendor.
    const vendor = await prisma.vendor.findFirst({
      where: { id: parseInt(vendorId), orgId },
      select: { id: true },
    });
    if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found' });

    const row = await prisma.$transaction(async (tx) => {
      // Does any mapping exist for this product yet? Relevant for auto-primary.
      const anyExisting = await tx.productVendor.findFirst({
        where: { orgId, masterProductId },
        select: { id: true },
      });

      const created = await tx.productVendor.create({
        data: {
          orgId,
          masterProductId,
          vendorId: parseInt(vendorId),
          vendorItemCode: vendorItemCode || null,
          description:    description    || null,
          priceCost:      priceCost != null && priceCost !== '' ? parseFloat(priceCost) : null,
          caseCost:       caseCost  != null && caseCost  !== '' ? parseFloat(caseCost)  : null,
          packInCase:     packInCase != null && packInCase !== '' ? parseInt(packInCase) : null,
          notes:          notes || null,
          // First mapping auto-primary; otherwise respect explicit isPrimary flag.
          isPrimary: anyExisting ? Boolean(isPrimary) : true,
        },
        include: { vendor: { select: { id: true, name: true, code: true } } },
      });

      await _reconcilePrimary(tx, orgId, masterProductId);
      return created;
    });

    res.status(201).json({ success: true, data: row });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, error: 'This vendor already has a mapping for this product' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

/** PUT /api/catalog/products/:id/vendor-mappings/:mappingId */
export const updateProductVendor = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const mappingId = parseInt(req.params.mappingId);
    const body = req.body || {};

    const updates = {};
    if (body.vendorItemCode !== undefined) updates.vendorItemCode = body.vendorItemCode || null;
    if (body.description    !== undefined) updates.description    = body.description || null;
    if (body.priceCost      !== undefined) updates.priceCost      = body.priceCost != null && body.priceCost !== '' ? parseFloat(body.priceCost) : null;
    if (body.caseCost       !== undefined) updates.caseCost       = body.caseCost  != null && body.caseCost  !== '' ? parseFloat(body.caseCost)  : null;
    if (body.packInCase     !== undefined) updates.packInCase     = body.packInCase != null && body.packInCase !== '' ? parseInt(body.packInCase) : null;
    if (body.notes          !== undefined) updates.notes          = body.notes || null;
    // isPrimary is handled via a dedicated endpoint — ignore it here.

    const row = await prisma.$transaction(async (tx) => {
      // Ownership check
      const found = await tx.productVendor.findFirst({
        where: { id: mappingId, orgId, masterProductId },
        select: { id: true, isPrimary: true },
      });
      if (!found) throw Object.assign(new Error('Mapping not found'), { status: 404 });

      const updated = await tx.productVendor.update({
        where: { id: mappingId },
        data:  updates,
        include: { vendor: { select: { id: true, name: true, code: true } } },
      });

      // If primary's vendorItemCode changed, mirror to MasterProduct.itemCode.
      if (found.isPrimary && updates.vendorItemCode !== undefined) {
        await tx.masterProduct.update({
          where: { id: masterProductId, orgId },
          data:  { itemCode: updated.vendorItemCode || null },
        });
      }

      return updated;
    });

    res.json({ success: true, data: row });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};

/** DELETE /api/catalog/products/:id/vendor-mappings/:mappingId */
export const deleteProductVendor = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const mappingId = parseInt(req.params.mappingId);

    await prisma.$transaction(async (tx) => {
      const found = await tx.productVendor.findFirst({
        where: { id: mappingId, orgId, masterProductId },
        select: { id: true },
      });
      if (!found) throw Object.assign(new Error('Mapping not found'), { status: 404 });

      await tx.productVendor.delete({ where: { id: mappingId } });
      // _reconcilePrimary auto-promotes the next-best mapping if we just
      // deleted the primary, and mirrors itemCode back to MasterProduct.
      await _reconcilePrimary(tx, orgId, masterProductId);
    });

    res.json({ success: true });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};

/** POST /api/catalog/products/:id/vendor-mappings/:mappingId/make-primary */
export const makeProductVendorPrimary = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const mappingId = parseInt(req.params.mappingId);

    const row = await prisma.$transaction(async (tx) => {
      const target = await tx.productVendor.findFirst({
        where: { id: mappingId, orgId, masterProductId },
        select: { id: true },
      });
      if (!target) throw Object.assign(new Error('Mapping not found'), { status: 404 });

      // Clear any other primaries for this product; set target primary.
      await tx.productVendor.updateMany({
        where: { orgId, masterProductId, NOT: { id: mappingId } },
        data:  { isPrimary: false },
      });
      await tx.productVendor.update({
        where: { id: mappingId },
        data:  { isPrimary: true },
      });
      await _reconcilePrimary(tx, orgId, masterProductId);
      return tx.productVendor.findUnique({
        where: { id: mappingId },
        include: { vendor: { select: { id: true, name: true, code: true } } },
      });
    });

    res.json({ success: true, data: row });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getVendorProducts = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const { skip, take } = paginationParams(req.query);
    const [products, total] = await Promise.all([
      prisma.masterProduct.findMany({
        where: { orgId, vendorId: id },
        orderBy: { name: 'asc' },
        skip, take,
        include: { department: { select: { name: true, color: true } } },
      }),
      prisma.masterProduct.count({ where: { orgId, vendorId: id } }),
    ]);
    res.json({ success: true, data: products, total });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getVendorPayouts = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const { skip, take } = paginationParams(req.query);
    const [payouts, total] = await Promise.all([
      prisma.cashPayout.findMany({
        where: { orgId, vendorId: id },
        orderBy: { createdAt: 'desc' },
        skip, take,
        include: {
          shift: { select: { id: true, openedAt: true, closedAt: true, status: true } },
        },
      }),
      prisma.cashPayout.count({ where: { orgId, vendorId: id } }),
    ]);
    // Sum total paid out
    const agg = await prisma.cashPayout.aggregate({
      where: { orgId, vendorId: id },
      _sum: { amount: true },
      _count: { id: true },
    });
    res.json({ success: true, data: payouts, total, totalPaid: agg._sum.amount ?? 0, payoutCount: agg._count.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getVendorStats = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const [productCount, payoutAgg, recentPayouts] = await Promise.all([
      prisma.masterProduct.count({ where: { orgId, vendorId: id } }),
      prisma.cashPayout.aggregate({
        where: { orgId, vendorId: id },
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.cashPayout.findMany({
        where: { orgId, vendorId: id },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { amount: true, createdAt: true, payoutType: true },
      }),
    ]);

    // Monthly spending for last 12 months
    const monthlyMap = {};
    recentPayouts.forEach(p => {
      const key = new Date(p.createdAt).toISOString().slice(0, 7); // YYYY-MM
      monthlyMap[key] = (monthlyMap[key] || 0) + parseFloat(p.amount || 0);
    });

    res.json({
      success: true,
      data: {
        productCount,
        totalPaid:    parseFloat(payoutAgg._sum.amount ?? 0),
        payoutCount:  payoutAgg._count.id,
        monthlySpend: monthlyMap,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════
// REBATE PROGRAMS
// ═══════════════════════════════════════════════════════

export const getRebatePrograms = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const programs = await prisma.rebateProgram.findMany({
      where: { orgId, active: true },
      orderBy: { manufacturer: 'asc' },
    });
    res.json({ success: true, data: programs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createRebateProgram = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { name, manufacturer, description, qualifyingUpcs, rebateType,
            rebateAmount, minQtyPerMonth, maxQtyPerMonth, startDate, endDate } = req.body;

    if (!name || !manufacturer || !rebateType || rebateAmount == null) {
      return res.status(400).json({ success: false, error: 'name, manufacturer, rebateType, rebateAmount are required' });
    }

    const sd = tryParseDate(res, startDate, 'startDate'); if (!sd.ok) return;
    const ed = tryParseDate(res, endDate,   'endDate');   if (!ed.ok) return;

    const program = await prisma.rebateProgram.create({
      data: {
        orgId,
        name,
        manufacturer,
        description:    description || null,
        qualifyingUpcs: Array.isArray(qualifyingUpcs) ? qualifyingUpcs : [],
        rebateType,
        rebateAmount,
        minQtyPerMonth: minQtyPerMonth ? parseInt(minQtyPerMonth) : null,
        maxQtyPerMonth: maxQtyPerMonth ? parseInt(maxQtyPerMonth) : null,
        startDate:      sd.value,
        endDate:        ed.value,
      },
    });

    res.status(201).json({ success: true, data: program });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateRebateProgram = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const program = await prisma.rebateProgram.update({ where: { id, orgId }, data: req.body });
    res.json({ success: true, data: program });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Rebate program not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════
// MASTER PRODUCTS
// ═══════════════════════════════════════════════════════

/**
 * GET /api/catalog/products/tax-unmapped
 *
 * Admin-facing report for Phase 2 of the taxClass → taxRuleId strict-FK
 * migration. Returns every non-deleted product that falls into one of three
 * attention-needed buckets:
 *
 *   status='STALE_FK' → taxRuleId is set but the referenced rule is inactive
 *                       or deleted. Product page shows an amber warning for
 *                       this case; this endpoint surfaces them as a list so
 *                       admins can bulk-resolve.
 *   status='UNMAPPED' → legacy taxClass string with no matching active rule.
 *                       The cashier falls through to 0% — admins need to
 *                       either create a matching rule or pick an existing one.
 *   status='AMBIGUOUS' → legacy taxClass matches multiple active rules (e.g.
 *                        two rules both appliesTo='alcohol' with different
 *                        rates). Auto-match skipped; admin disambiguates.
 *
 * Paginated; rolls up a small `summary` block at the top. The CLI
 * `migrateTaxRules.js` script emits the same data as a CSV for bulk review.
 */
export const getTaxUnmappedProducts = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { skip, take } = paginationParams(req.query);

    // Active rules for this org, indexed for fast matching.
    const rules = await prisma.taxRule.findMany({
      where: { orgId, active: true },
      select: { id: true, name: true, appliesTo: true, rate: true },
    });
    const ruleIds        = new Set(rules.map(r => r.id));
    const byName         = new Map();
    const byAppliesTo    = new Map();
    const byRate         = new Map();
    for (const r of rules) {
      const nk = String(r.name).toLowerCase().trim();
      const ak = String(r.appliesTo).toLowerCase().trim();
      if (nk && !byName.has(nk)) byName.set(nk, r);
      if (ak) {
        if (!byAppliesTo.has(ak)) byAppliesTo.set(ak, []);
        byAppliesTo.get(ak).push(r);
      }
      const rk = Number(r.rate).toFixed(4);
      if (!byRate.has(rk)) byRate.set(rk, []);
      byRate.get(rk).push(r);
    }

    // Walk all products — cheaper to classify in JS than to SQL-express this.
    const products = await prisma.masterProduct.findMany({
      where: { orgId, deleted: false },
      select: { id: true, name: true, upc: true, taxClass: true, taxRuleId: true, departmentId: true },
    });

    const unmapped = [];
    let countsByStatus = { STALE_FK: 0, UNMAPPED: 0, AMBIGUOUS: 0, OK: 0 };

    for (const p of products) {
      // Stale FK: product points at a rule no longer active.
      if (p.taxRuleId && !ruleIds.has(p.taxRuleId)) {
        unmapped.push({
          id: p.id, name: p.name, upc: p.upc, departmentId: p.departmentId,
          taxClass: p.taxClass, taxRuleId: p.taxRuleId,
          status: 'STALE_FK',
          suggestions: [],
          reason: 'taxRuleId points at a rule that is inactive or no longer exists',
        });
        countsByStatus.STALE_FK++;
        continue;
      }
      // FK already valid → nothing to do.
      if (p.taxRuleId) { countsByStatus.OK++; continue; }

      // No taxClass and no FK → treated as "use default" (not a problem).
      if (!p.taxClass) { countsByStatus.OK++; continue; }

      const tc = String(p.taxClass).toLowerCase().trim();

      // Name match (winner) — single rule → OK.
      if (byName.has(tc)) { countsByStatus.OK++; continue; }

      // appliesTo match — single rule → OK; multiple → AMBIGUOUS.
      const apHits = byAppliesTo.get(tc);
      if (apHits) {
        if (apHits.length === 1) { countsByStatus.OK++; continue; }
        unmapped.push({
          id: p.id, name: p.name, upc: p.upc, departmentId: p.departmentId,
          taxClass: p.taxClass, taxRuleId: null,
          status: 'AMBIGUOUS',
          suggestions: apHits.map(r => ({ id: r.id, name: r.name, rate: Number(r.rate) })),
          reason: `${apHits.length} active rules match appliesTo="${tc}"`,
        });
        countsByStatus.AMBIGUOUS++;
        continue;
      }

      // Percentage parse → rate match.
      const cleaned = p.taxClass.replace(/[%$,\s]/g, '').trim();
      const n = parseFloat(cleaned);
      if (!isNaN(n) && n >= 0) {
        const dec = n <= 1 ? n : n / 100;
        const rk = dec.toFixed(4);
        const rateHits = byRate.get(rk);
        if (rateHits?.length === 1) { countsByStatus.OK++; continue; }
        if (rateHits?.length > 1) {
          unmapped.push({
            id: p.id, name: p.name, upc: p.upc, departmentId: p.departmentId,
            taxClass: p.taxClass, taxRuleId: null,
            status: 'AMBIGUOUS',
            suggestions: rateHits.map(r => ({ id: r.id, name: r.name, rate: Number(r.rate) })),
            reason: `${rateHits.length} active rules match rate ${(dec * 100).toFixed(2)}%`,
          });
          countsByStatus.AMBIGUOUS++;
          continue;
        }
      }

      // No match at any tier.
      unmapped.push({
        id: p.id, name: p.name, upc: p.upc, departmentId: p.departmentId,
        taxClass: p.taxClass, taxRuleId: null,
        status: 'UNMAPPED',
        suggestions: [],
        reason: `No active rule matches taxClass="${p.taxClass}"`,
      });
      countsByStatus.UNMAPPED++;
    }

    const total = unmapped.length;
    const paged = unmapped.slice(skip, skip + take);

    res.json({
      success: true,
      summary: {
        totalProducts: products.length,
        okCount:       countsByStatus.OK,
        unmappedCount: countsByStatus.UNMAPPED,
        ambiguousCount: countsByStatus.AMBIGUOUS,
        staleFkCount:  countsByStatus.STALE_FK,
        activeRuleCount: rules.length,
      },
      total,
      skip, take,
      data: paged,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getMasterProducts = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { skip, take, page, limit } = paginationParams(req.query);
    const includeDeleted = req.query.includeDeleted === 'true';
    // When a storeId is supplied (X-Store-Id header or ?storeId param), include
    // that store's StoreProduct row so the catalog list can show On-Hand etc.
    const storeId = req.query.storeId || req.headers['x-store-id'] || req.storeId || null;

    const where = {
      orgId,
      deleted: includeDeleted ? undefined : false,
      ...(req.query.departmentId && { departmentId: parseInt(req.query.departmentId) }),
      ...(req.query.vendorId     && { vendorId:     parseInt(req.query.vendorId)     }),
      ...(req.query.active !== undefined && { active: req.query.active === 'true' }),
    };

    // Session 39 Round 4 — server-side sort across the full catalog. UI
    // column clicks pass ?sortBy=<key>&sortDir=asc|desc. Unknown keys fall
    // back to name-asc so the response shape stays stable.
    const sortDir = req.query.sortDir === 'desc' ? 'desc' : 'asc';
    const PRODUCT_SORT_MAP = {
      name:       { name: sortDir },
      brand:      { brand: sortDir },
      upc:        { upc: sortDir },
      sku:        { sku: sortDir },
      pack:       { casePacks: sortDir },
      cost:       { defaultCostPrice: sortDir },
      retail:     { defaultRetailPrice: sortDir },
      department: { department: { name: sortDir } },
      vendor:     { vendor:     { name: sortDir } },
      active:     { active: sortDir },
      createdAt:  { createdAt: sortDir },
      updatedAt:  { updatedAt: sortDir },
    };
    const orderBy = PRODUCT_SORT_MAP[req.query.sortBy] || { name: 'asc' };

    const [products, total] = await Promise.all([
      prisma.masterProduct.findMany({
        where,
        include: {
          department: { select: { id: true, name: true, code: true, taxClass: true } },
          vendor:     { select: { id: true, name: true, code: true } },
          depositRule:{ select: { id: true, name: true, depositAmount: true } },
          ...(storeId && {
            storeProducts: {
              where: { storeId },
              select: { quantityOnHand: true, retailPrice: true, costPrice: true, inStock: true },
              take: 1,
            },
          }),
        },
        orderBy,
        skip,
        take,
      }),
      prisma.masterProduct.count({ where }),
    ]);

    // Resolve images from global cache for products missing imageUrl
    const imageMap = await batchResolveProductImages(products);

    // Flatten per-store fields + resolve images + deposit (Session 39 Round 5)
    const enriched = products.map(p => {
      const sp = storeId ? p.storeProducts?.[0] : null;
      return flattenDeposit({
        ...p,
        imageUrl: p.imageUrl || imageMap.get(p.id) || null,
        ...(sp ? {
          quantityOnHand: sp.quantityOnHand != null ? Number(sp.quantityOnHand) : null,
          storeRetailPrice: sp.retailPrice != null ? Number(sp.retailPrice) : null,
          storeCostPrice: sp.costPrice != null ? Number(sp.costPrice) : null,
          inStock: sp.inStock ?? null,
        } : {}),
      });
    });

    res.json({
      success: true,
      data: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── GET /api/catalog/products/export ────────────────────────────────────────
// Session 2 dedup export. One CSV with every product for the active store,
// including multi-UPC (pipe-separated), multi-pack options (compressed), and
// per-store overrides (QOH + price). Columns intentionally mirror the bulk
// import shape so a round-trip edit is possible, but the export is NOT strict
// round-trip — read-only fields (id, timestamps, resolved names) come along for
// reference. See Session 2 of CLAUDE.md.
export const exportMasterProducts = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const storeId = req.query.storeId || req.headers['x-store-id'] || req.storeId || null;
    const includeDeleted = req.query.includeDeleted === 'true';
    const activeOnly     = req.query.activeOnly     === 'true';

    const where = {
      orgId,
      ...(includeDeleted ? {} : { deleted: false }),
      ...(activeOnly && { active: true }),
    };

    const [products, alternateUpcs, packSizes, store] = await Promise.all([
      prisma.masterProduct.findMany({
        where,
        include: {
          department:   { select: { id: true, name: true, code: true } },
          vendor:       { select: { id: true, name: true, code: true } },
          productGroup: { select: { id: true, name: true } },
          ...(storeId && {
            storeProducts: {
              where: { storeId },
              select: { quantityOnHand: true, retailPrice: true, costPrice: true, inStock: true },
              take: 1,
            },
          }),
        },
        orderBy: [{ name: 'asc' }],
      }),
      prisma.productUpc.findMany({
        where: { orgId, isDefault: false },
        select: { masterProductId: true, upc: true, label: true },
        orderBy: [{ masterProductId: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.productPackSize.findMany({
        where: { orgId },
        select: { masterProductId: true, label: true, unitCount: true, retailPrice: true, isDefault: true, sortOrder: true },
        orderBy: [{ masterProductId: 'asc' }, { sortOrder: 'asc' }],
      }),
      storeId ? prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }) : null,
    ]);

    const altByProduct = new Map();
    for (const a of alternateUpcs) {
      const list = altByProduct.get(a.masterProductId) || [];
      list.push(a.upc);
      altByProduct.set(a.masterProductId, list);
    }
    const packsByProduct = new Map();
    for (const p of packSizes) {
      const list = packsByProduct.get(p.masterProductId) || [];
      list.push(p);
      packsByProduct.set(p.masterProductId, list);
    }

    const rows = products.map(p => {
      const sp    = storeId ? p.storeProducts?.[0] : null;
      const alts  = altByProduct.get(p.id) || [];
      const packs = packsByProduct.get(p.id) || [];
      const packOptions = packs.map(pk => {
        const price = pk.retailPrice != null ? Number(pk.retailPrice) : '';
        return `${pk.label || ''}@${pk.unitCount || 1}@${price}${pk.isDefault ? '*' : ''}`;
      }).join(';');

      return {
        id:                 p.id,
        upc:                p.upc || '',
        additional_upcs:    alts.join('|'),
        sku:                p.sku || '',
        item_code:          p.itemCode || '',
        name:               p.name,
        brand:              p.brand || '',
        size:               p.size || '',
        size_unit:          p.sizeUnit || '',
        description:        p.description || '',
        image_url:          p.imageUrl || '',

        department_id:      p.departmentId ?? '',
        department_name:    p.department?.name || '',
        vendor_id:          p.vendorId ?? '',
        vendor_name:        p.vendor?.name || '',
        product_group:      p.productGroup?.name || '',
        tax_class:          p.taxClass || '',

        unit_pack:          p.unitPack   != null ? p.unitPack   : '',
        packs_per_case:     p.packInCase != null ? p.packInCase : '',
        pack_options:       packOptions,

        default_cost_price:   p.defaultCostPrice   != null ? Number(p.defaultCostPrice)   : '',
        default_retail_price: p.defaultRetailPrice != null ? Number(p.defaultRetailPrice) : '',
        default_case_price:   p.defaultCasePrice   != null ? Number(p.defaultCasePrice)   : '',

        store_cost_price:     sp?.costPrice   != null ? Number(sp.costPrice)   : '',
        store_retail_price:   sp?.retailPrice != null ? Number(sp.retailPrice) : '',

        deposit_per_unit:   p.depositPerUnit != null ? Number(p.depositPerUnit) : '',
        case_deposit:       p.caseDeposit    != null ? Number(p.caseDeposit)    : '',

        ebt_eligible:       p.ebtEligible      ? 'true' : 'false',
        age_required:       p.ageRequired ?? '',
        taxable:            p.taxable          ? 'true' : 'false',
        discount_eligible:  p.discountEligible ? 'true' : 'false',

        quantity_on_hand:   sp?.quantityOnHand != null ? Number(sp.quantityOnHand) : '',
        reorder_point:      p.reorderPoint ?? '',
        reorder_qty:        p.reorderQty ?? '',
        track_inventory:    p.trackInventory ? 'true' : 'false',

        hide_from_ecom:     p.hideFromEcom ? 'true' : 'false',
        ecom_description:   p.ecomDescription || '',

        active:             p.active ? 'true' : 'false',
        created_at:         p.createdAt ? new Date(p.createdAt).toISOString() : '',
        updated_at:         p.updatedAt ? new Date(p.updatedAt).toISOString() : '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows, {
      header: rows[0] ? Object.keys(rows[0]) : [
        'id','upc','additional_upcs','sku','item_code','name','brand','size','size_unit',
        'description','image_url','department_id','department_name','vendor_id','vendor_name',
        'product_group','tax_class','unit_pack','packs_per_case','pack_options',
        'default_cost_price','default_retail_price','default_case_price',
        'store_cost_price','store_retail_price','deposit_per_unit','case_deposit',
        'ebt_eligible','age_required','taxable','discount_eligible',
        'quantity_on_hand','reorder_point','reorder_qty','track_inventory',
        'hide_from_ecom','ecom_description','active','created_at','updated_at',
      ],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'csv' });

    const storeSlug = store?.name
      ? store.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)
      : 'all-stores';
    const date = new Date().toISOString().slice(0, 10);
    const filename = `products-${storeSlug}-${date}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('X-Row-Count', String(rows.length));
    return res.send(buffer);
  } catch (err) {
    console.error('[exportMasterProducts] failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const searchMasterProducts = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const rawQuery = req.query.q?.trim() || '';
    const storeId = req.query.storeId || null;
    const { skip, take, page, limit } = paginationParams(req.query);

    if (!rawQuery) {
      return res.status(400).json({ success: false, error: 'Search query (q) is required' });
    }

    // Strip spaces/dashes/dots that scanners or humans may include in a UPC
    // e.g. "0 80686 00637 4" → "0806860063 74" → digits only → "080686006374"
    const digitsOnlyQuery = rawQuery.replace(/[\s\-\.]/g, '').replace(/\D/g, '');
    const isUpcLike = digitsOnlyQuery.length >= 6 && digitsOnlyQuery.length <= 14;

    const storeProductsInclude = storeId
      ? { where: { storeId, active: true }, select: { quantityOnHand: true, retailPrice: true, inStock: true }, take: 1 }
      : false;

    // Exact UPC match first (fastest, for barcode scanner)
    // Build all plausible variants so storage format differences never cause a miss.
    if (isUpcLike) {
      const variants = upcVariants(digitsOnlyQuery);

      // First check ProductUpc table (multiple-UPC support)
      const upcRow = await prisma.productUpc.findFirst({
        where: { orgId, upc: { in: variants } },
        select: { masterProductId: true },
      });

      const exactWhere = upcRow
        ? { id: upcRow.masterProductId, orgId, deleted: false }
        : { orgId, deleted: false, upc: { in: variants } };

      const exact = await prisma.masterProduct.findFirst({
        where: exactWhere,
        include: {
          department: { select: { id: true, name: true, code: true, taxClass: true, ageRequired: true } },
          vendor:     { select: { id: true, name: true } },
          depositRule:{ select: { id: true, depositAmount: true } },
          upcs:       { select: { id: true, upc: true, label: true, isDefault: true } },
          packSizes:  { orderBy: { sortOrder: 'asc' } },
          ...(storeProductsInclude ? { storeProducts: storeProductsInclude } : {}),
        },
      });
      if (exact) {
        if (storeId && exact.storeProducts?.[0]?.quantityOnHand != null) {
          exact.quantityOnHand = Number(exact.storeProducts[0].quantityOnHand);
        }
        // Resolve image from global cache if missing
        if (!exact.imageUrl && exact.upc) {
          const imgMap = await batchResolveProductImages([exact]);
          if (imgMap.has(exact.id)) exact.imageUrl = imgMap.get(exact.id);
        }
        // Session 39 Round 5 — flatten deposit so cashier cart reads the
        // same `depositAmount` field the catalog snapshot provides.
        return res.json({ success: true, data: [flattenDeposit(exact)], pagination: { page: 1, limit: 1, total: 1, pages: 1 } });
      }
    }

    // Use the original raw query for text search (name, brand, SKU)
    const query = rawQuery;
    const digitVariants = isUpcLike ? upcVariants(digitsOnlyQuery) : null;

    // Full-text / fuzzy search — PostgreSQL ILIKE
    const where = {
      orgId,
      deleted: false,
      OR: [
        { name:     { contains: query, mode: 'insensitive' } },
        ...(isUpcLike && digitVariants
          ? [{ upc: { in: digitVariants } }]
          : [{ upc: { contains: query } }]
        ),
        { sku:      { contains: query, mode: 'insensitive' } },
        { itemCode: { contains: query, mode: 'insensitive' } },
        { brand:    { contains: query, mode: 'insensitive' } },
      ],
    };

    const [products, total] = await Promise.all([
      prisma.masterProduct.findMany({
        where,
        include: {
          department: { select: { id: true, name: true, code: true, taxClass: true, ageRequired: true } },
          vendor:     { select: { id: true, name: true } },
          depositRule:{ select: { id: true, depositAmount: true } },
          upcs:       { select: { id: true, upc: true, label: true, isDefault: true } },
          packSizes:  { orderBy: { sortOrder: 'asc' } },
        },
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      prisma.masterProduct.count({ where }),
    ]);

    // Resolve images from global cache for products missing imageUrl
    const imageMap = await batchResolveProductImages(products);
    const enriched = products.map(p => flattenDeposit({
      ...p,
      imageUrl: p.imageUrl || imageMap.get(p.id) || null,
    }));

    res.json({
      success: true,
      data: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getMasterProduct = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const product = await prisma.masterProduct.findFirst({
      where: { id, orgId },
      include: {
        department:   true,
        vendor:       true,
        depositRule:  true,
        // Session 40 Phase 1 — strict-FK tax linkage. ProductForm uses the
        // populated `taxRule` relation to show "⚠ rule no longer exists"
        // when taxRuleId points to a soft-deleted/inactive rule.
        taxRule:      { select: { id: true, name: true, rate: true, appliesTo: true, active: true } },
        storeProducts:{ select: { id: true, storeId: true, retailPrice: true, quantityOnHand: true, active: true } },
        upcs:         { select: { id: true, upc: true, label: true, isDefault: true }, orderBy: { isDefault: 'desc' } },
        packSizes:    { orderBy: { sortOrder: 'asc' } },
        // Session 40 — per-vendor item-code / cost mappings. Primary first,
        // then most-recently-received. UI renders a table in Classification.
        vendorMappings: {
          include: { vendor: { select: { id: true, name: true, code: true } } },
          orderBy: [
            { isPrimary: 'desc' },
            { lastReceivedAt: 'desc' },
            { createdAt: 'desc' },
          ],
        },
      },
    });

    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

    // Resolve image from global cache if missing
    if (!product.imageUrl && product.upc) {
      const imgMap = await batchResolveProductImages([product]);
      if (imgMap.has(product.id)) product.imageUrl = imgMap.get(product.id);
    }

    // Session 39 Round 5 — flatten deposit for cashier cart consumers
    res.json({ success: true, data: flattenDeposit(product) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Keep ProductUpc table in sync with MasterProduct.upc (the primary barcode).
// When the primary UPC is set, the ProductUpc row with isDefault=true mirrors it.
// This lets the cashier-app scan either the primary or any alternate UPC from the
// same `product_upcs` table — a single source of truth. See Session 36 of CLAUDE.md
// for the cascade `ProductUpc → MasterProduct.upc` lookup in searchMasterProducts.
async function syncPrimaryUpc(orgId, productId, newUpc) {
  const normalized = newUpc ? normalizeUPC(newUpc) : null;
  if (!normalized) {
    await prisma.productUpc.updateMany({
      where: { orgId, masterProductId: productId, isDefault: true },
      data:  { isDefault: false },
    });
    return;
  }
  const existing = await prisma.productUpc.findUnique({
    where: { orgId_upc: { orgId, upc: normalized } },
  });
  if (existing && existing.masterProductId !== productId) {
    const err = new Error(`UPC ${normalized} is already used by another product (id ${existing.masterProductId})`);
    err.code = 'P2002';
    throw err;
  }
  // Unset any other default for this product that isn't the new primary
  await prisma.productUpc.updateMany({
    where: {
      orgId, masterProductId: productId, isDefault: true,
      NOT: { upc: normalized },
    },
    data: { isDefault: false },
  });
  await prisma.productUpc.upsert({
    where:  { orgId_upc: { orgId, upc: normalized } },
    update: { masterProductId: productId, isDefault: true },
    create: { orgId, masterProductId: productId, upc: normalized, isDefault: true, label: 'Primary' },
  });
}

export const createMasterProduct = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      upc, plu, sku, itemCode, name, description, brand, imageUrl,
      size, sizeUnit, pack, casePacks, sellUnitSize, sellUnit, innerPack, unitsPerPack, weight,
      // Shipping dimensions (imperial: inches). Used by ecom storefront + carrier rate quotes.
      shipLengthIn, shipWidthIn, shipHeightIn,
      unitPack, packInCase, depositPerUnit,
      departmentId, vendorId, depositRuleId, containerType, containerVolumeOz,
      // Session 40 Phase 1: strict-FK tax linkage. `taxRuleId` is authoritative
      // when set; `taxClass` is the legacy string fallback for backward compat.
      taxRuleId, taxClass,
      defaultCostPrice, defaultRetailPrice, defaultCasePrice,
      // Invoice cost sync lock — when true, invoice imports skip writing
      // defaultCasePrice so manual cost adjustments stay intact.
      lockManualCaseCost,
      byWeight, byUnit,
      ebtEligible, ageRequired, taxable, discountEligible, foodstamp,
      trackInventory, reorderPoint, reorderQty,
      hideFromEcom, ecomDescription, ecomTags,
      // Previously destructured-and-ignored — now fully wired so ProductForm ecom fields persist.
      ecomExternalId, ecomPackWeight, ecomPrice, ecomSalePrice, ecomOnSale, ecomSummary,
      attributes,
      active,
    } = req.body;

    if (!name) return res.status(400).json({ success: false, error: 'name is required' });

    // ── taxRuleId validation + auto-mirror taxClass (Session 40 Phase 1) ──
    // If a taxRuleId is supplied, verify it belongs to this org and (when
    // taxClass wasn't explicitly set) mirror the rule's `appliesTo` into
    // `taxClass` for backward compat with older cashier-app builds.
    let resolvedTaxRuleId = null;
    if (taxRuleId != null && taxRuleId !== '') {
      const rule = await prisma.taxRule.findFirst({
        where: { id: parseInt(taxRuleId), orgId },
        select: { id: true, appliesTo: true },
      });
      if (!rule) {
        return res.status(400).json({ success: false, error: `taxRuleId ${taxRuleId} not found for this org` });
      }
      resolvedTaxRuleId = rule.id;
      // Mirror appliesTo → taxClass unless the caller explicitly passed one
      if (taxClass == null) {
        taxClass = rule.appliesTo;
      }
    }

    // ── Department-level default cascading ────────────────────────────────
    // If a department is selected and classification/compliance fields are
    // not provided, inherit defaults from the department model.
    let deptDefaults = {};
    if (departmentId) {
      const dept = await prisma.department.findFirst({
        where: { id: parseInt(departmentId), orgId },
        select: {
          taxClass: true, ageRequired: true, ebtEligible: true, bottleDeposit: true,
        },
      });
      if (dept) {
        deptDefaults = {
          taxClass:    taxClass    == null ? dept.taxClass    : taxClass,
          ageRequired: ageRequired == null ? dept.ageRequired : ageRequired,
          ebtEligible: ebtEligible == null ? dept.ebtEligible : ebtEligible,
        };
      }
    }

    const product = await prisma.masterProduct.create({
      data: {
        orgId,
        upc:                normalizeUPC(upc) || null,
        plu:                plu || null,
        sku:                sku || null,
        itemCode:           itemCode || null,
        name,
        description:        description || null,
        brand:              brand || null,
        imageUrl:           imageUrl || null,
        size:               size || null,
        sizeUnit:           sizeUnit || null,
        pack:               pack         ? parseInt(pack)         : null,
        // FIXED: use `!= null` instead of truthiness check so value 0 is preserved.
        // Previously `packInCase ? parseInt(packInCase) : null` turned 0 into null.
        casePacks:          casePacks    != null ? parseInt(casePacks)    : null,
        sellUnitSize:       sellUnitSize != null ? parseInt(sellUnitSize) : null,
        sellUnit:           sellUnit     || null,
        innerPack:          innerPack    ? parseInt(innerPack)    : null,
        unitsPerPack:       unitsPerPack ? parseInt(unitsPerPack) : null,
        unitPack:           unitPack     ? parseInt(unitPack)     : null,
        packInCase:         packInCase   ? parseInt(packInCase)   : null,
        depositPerUnit:     toPrice(depositPerUnit, 'depositPerUnit'),
        caseDeposit:        toPrice(req.body.caseDeposit, 'caseDeposit'),
        weight:             weight ? parseFloat(weight) : null,
        departmentId:       departmentId ? parseInt(departmentId) : null,
        vendorId:           vendorId     ? parseInt(vendorId)     : null,
        depositRuleId:      depositRuleId? parseInt(depositRuleId): null,
        containerType:      containerType || null,
        containerVolumeOz:  containerVolumeOz ? parseFloat(containerVolumeOz) : null,
        taxRuleId:          resolvedTaxRuleId,
        taxClass:           (taxClass ?? deptDefaults.taxClass) || null,
        defaultCostPrice:   toPrice(defaultCostPrice,   'defaultCostPrice'),
        defaultRetailPrice: toPrice(defaultRetailPrice, 'defaultRetailPrice'),
        defaultCasePrice:   toPrice(defaultCasePrice,   'defaultCasePrice'),
        byWeight:           Boolean(byWeight),
        byUnit:             byUnit !== false,
        ebtEligible:        ebtEligible != null ? Boolean(ebtEligible) : Boolean(deptDefaults.ebtEligible),
        ageRequired:        (ageRequired ?? deptDefaults.ageRequired) ? parseInt(ageRequired ?? deptDefaults.ageRequired) : null,
        taxable:            taxable !== false,
        discountEligible:   discountEligible !== false,
        foodstamp:          Boolean(foodstamp),
        trackInventory:     trackInventory !== false,
        lockManualCaseCost: Boolean(lockManualCaseCost),
        reorderPoint:       reorderPoint ? parseInt(reorderPoint) : null,
        reorderQty:         reorderQty   ? parseInt(reorderQty)   : null,
        hideFromEcom:       Boolean(hideFromEcom),
        ecomDescription:    ecomDescription || null,
        ecomTags:           Array.isArray(ecomTags) ? ecomTags : [],
        // E-Commerce extended fields — ship weight already above (`ecomPackWeight`
        // not used here; `weight` column stores ship weight in lbs).
        ecomExternalId:     ecomExternalId || null,
        ecomPackWeight:     ecomPackWeight ? parseFloat(ecomPackWeight) : null,
        ecomPrice:          toPrice(ecomPrice, 'ecomPrice'),
        ecomSalePrice:      toPrice(ecomSalePrice, 'ecomSalePrice'),
        ecomOnSale:         Boolean(ecomOnSale),
        ecomSummary:        ecomSummary || null,
        // Shipping dimensions (inches)
        shipLengthIn:       shipLengthIn != null && shipLengthIn !== '' ? parseFloat(shipLengthIn) : null,
        shipWidthIn:        shipWidthIn  != null && shipWidthIn  !== '' ? parseFloat(shipWidthIn)  : null,
        shipHeightIn:       shipHeightIn != null && shipHeightIn !== '' ? parseFloat(shipHeightIn) : null,
        attributes:         (attributes && typeof attributes === 'object' && !Array.isArray(attributes)) ? attributes : {},
        active:             active !== false,
      },
      include: {
        department: { select: { id: true, name: true, code: true } },
        vendor:     { select: { id: true, name: true } },
      },
    });

    // Keep ProductUpc table in sync with primary UPC
    if (product.upc) {
      try { await syncPrimaryUpc(orgId, product.id, product.upc); }
      catch (e) {
        if (e.code === 'P2002') {
          // Primary UPC would conflict with another product's barcode — roll back
          await prisma.masterProduct.delete({ where: { id: product.id } }).catch(() => {});
          return res.status(409).json({ success: false, error: e.message });
        }
        throw e;
      }
    }

    emitProductSync(orgId, product.id, 'create', {
      name: product.name, description: product.description, brand: product.brand,
      imageUrl: product.imageUrl, defaultRetailPrice: product.defaultRetailPrice,
      defaultCostPrice: product.defaultCostPrice, taxable: product.taxable,
      taxClass: product.taxClass, ebtEligible: product.ebtEligible,
      ageRequired: product.ageRequired, trackInventory: product.trackInventory,
      hideFromEcom: product.hideFromEcom, ecomDescription: product.ecomDescription,
      ecomTags: product.ecomTags, size: product.size, weight: product.weight,
      departmentName: product.department?.name,
    });

    // Queue label for new product
    try { await queueLabelForNewProduct(orgId, product.id, product.defaultRetailPrice); } catch {}

    logAudit(req, 'create', 'product', product.id, {
      name: product.name,
      upc: product.upc,
      retailPrice: product.defaultRetailPrice,
      departmentId: product.departmentId,
    });

    // Populate global image cache if product has both UPC + image
    if (product.upc && product.imageUrl) {
      const { upsertGlobalImage } = await import('../services/globalImageService.js');
      upsertGlobalImage({ upc: product.upc, imageUrl: product.imageUrl, source: 'manual', productName: product.name, brand: product.brand }).catch(() => {});
    }

    res.status(201).json({ success: true, data: product });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, error: 'A product with this UPC already exists' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── Duplicate Product ────────────────────────────────────────────────────────
// Returns the source product data with UPC stripped — frontend uses this
// to pre-fill a new product form. The actual save happens via createMasterProduct.
export const duplicateMasterProduct = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const source = await prisma.masterProduct.findFirst({
      where: { id, orgId },
      include: {
        department:  { select: { id: true, name: true, code: true } },
        vendor:      { select: { id: true, name: true } },
        depositRule: { select: { id: true, name: true } },
      },
    });

    if (!source) return res.status(404).json({ success: false, error: 'Product not found' });

    // Strip fields that should not be copied
    const {
      id: _id, createdAt: _c, updatedAt: _u, upc: _upc, sku: _sku, plu: _plu,
      deleted: _d, orgId: _o, ...template
    } = source;

    // Suggest a new name with " (Copy)" appended
    template.name = `${source.name} (Copy)`;

    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateMasterProduct = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    // Strip undefined values; coerce numerics
    const updates = {};
    const body = req.body;

    if (body.name          !== undefined) updates.name          = body.name;
    if (body.upc           !== undefined) updates.upc           = normalizeUPC(body.upc) || null;
    if (body.plu           !== undefined) updates.plu           = body.plu || null;
    if (body.sku           !== undefined) updates.sku           = body.sku || null;
    if (body.itemCode      !== undefined) updates.itemCode      = body.itemCode || null;
    if (body.description   !== undefined) updates.description   = body.description || null;
    if (body.brand         !== undefined) updates.brand         = body.brand || null;
    if (body.size          !== undefined) updates.size          = body.size || null;
    if (body.sizeUnit      !== undefined) updates.sizeUnit      = body.sizeUnit || null;
    if (body.pack          !== undefined) updates.pack          = body.pack         ? parseInt(body.pack)         : null;
    if (body.casePacks     !== undefined) updates.casePacks     = body.casePacks    ? parseInt(body.casePacks)    : null;
    if (body.sellUnitSize  !== undefined) updates.sellUnitSize  = body.sellUnitSize ? parseInt(body.sellUnitSize) : null;
    if (body.sellUnit      !== undefined) updates.sellUnit      = body.sellUnit     || null;
    if (body.innerPack     !== undefined) updates.innerPack     = body.innerPack    ? parseInt(body.innerPack)    : null;
    if (body.unitsPerPack  !== undefined) updates.unitsPerPack  = body.unitsPerPack ? parseInt(body.unitsPerPack) : null;
    if (body.departmentId  !== undefined) updates.departmentId  = body.departmentId ? parseInt(body.departmentId) : null;
    if (body.vendorId      !== undefined) updates.vendorId      = body.vendorId ? parseInt(body.vendorId) : null;
    if (body.depositRuleId !== undefined) updates.depositRuleId = body.depositRuleId ? parseInt(body.depositRuleId) : null;
    if (body.containerType !== undefined) updates.containerType = body.containerType || null;
    if (body.containerVolumeOz !== undefined) updates.containerVolumeOz = body.containerVolumeOz ? parseFloat(body.containerVolumeOz) : null;
    // Session 40 Phase 1 — strict-FK tax linkage with legacy taxClass mirror.
    if (body.taxRuleId     !== undefined) {
      if (body.taxRuleId === null || body.taxRuleId === '') {
        updates.taxRuleId = null;
      } else {
        const rule = await prisma.taxRule.findFirst({
          where: { id: parseInt(body.taxRuleId), orgId },
          select: { id: true, appliesTo: true },
        });
        if (!rule) return res.status(400).json({ success: false, error: `taxRuleId ${body.taxRuleId} not found for this org` });
        updates.taxRuleId = rule.id;
        // Auto-mirror appliesTo → taxClass when caller didn't pass one.
        // Keeps older cashier-app builds (that only read taxClass) in sync.
        if (body.taxClass === undefined) updates.taxClass = rule.appliesTo;
      }
    }
    if (body.taxClass      !== undefined) updates.taxClass      = body.taxClass || null;
    if (body.defaultCostPrice   !== undefined) updates.defaultCostPrice   = toPrice(body.defaultCostPrice,   'defaultCostPrice');
    if (body.defaultRetailPrice !== undefined) updates.defaultRetailPrice = toPrice(body.defaultRetailPrice, 'defaultRetailPrice');
    if (body.defaultCasePrice   !== undefined) updates.defaultCasePrice   = toPrice(body.defaultCasePrice,   'defaultCasePrice');
    if (body.ebtEligible   !== undefined) updates.ebtEligible   = Boolean(body.ebtEligible);
    if (body.ageRequired   !== undefined) updates.ageRequired   = body.ageRequired ? parseInt(body.ageRequired) : null;
    if (body.taxable       !== undefined) updates.taxable       = Boolean(body.taxable);
    if (body.discountEligible !== undefined) updates.discountEligible = Boolean(body.discountEligible);
    if (body.byWeight      !== undefined) updates.byWeight      = Boolean(body.byWeight);
    if (body.byUnit        !== undefined) updates.byUnit        = Boolean(body.byUnit);
    if (body.trackInventory !== undefined) updates.trackInventory = Boolean(body.trackInventory);
    // Invoice cost sync lock — see schema comment for usage
    if (body.lockManualCaseCost !== undefined) updates.lockManualCaseCost = Boolean(body.lockManualCaseCost);
    if (body.reorderPoint  !== undefined) updates.reorderPoint  = body.reorderPoint ? parseInt(body.reorderPoint) : null;
    if (body.reorderQty    !== undefined) updates.reorderQty    = body.reorderQty   ? parseInt(body.reorderQty)   : null;
    if (body.active        !== undefined) updates.active        = Boolean(body.active);
    if (body.hideFromEcom  !== undefined) updates.hideFromEcom  = Boolean(body.hideFromEcom);
    if (body.ecomDescription !== undefined) updates.ecomDescription = body.ecomDescription || null;
    if (body.ecomTags      !== undefined) updates.ecomTags      = Array.isArray(body.ecomTags) ? body.ecomTags : [];
    // E-Commerce extended fields — previously only wired on create. Now fully
    // persisted on update too so ProductForm edits actually save.
    if (body.ecomExternalId !== undefined) updates.ecomExternalId = body.ecomExternalId || null;
    if (body.ecomPackWeight !== undefined) updates.ecomPackWeight = body.ecomPackWeight ? parseFloat(body.ecomPackWeight) : null;
    if (body.ecomPrice      !== undefined) updates.ecomPrice      = toPrice(body.ecomPrice,      'ecomPrice');
    if (body.ecomSalePrice  !== undefined) updates.ecomSalePrice  = toPrice(body.ecomSalePrice,  'ecomSalePrice');
    if (body.ecomOnSale     !== undefined) updates.ecomOnSale     = Boolean(body.ecomOnSale);
    if (body.ecomSummary    !== undefined) updates.ecomSummary    = body.ecomSummary || null;
    // Shipping dimensions (inches — imperial only for now)
    if (body.shipLengthIn   !== undefined) updates.shipLengthIn   = body.shipLengthIn != null && body.shipLengthIn !== '' ? parseFloat(body.shipLengthIn) : null;
    if (body.shipWidthIn    !== undefined) updates.shipWidthIn    = body.shipWidthIn  != null && body.shipWidthIn  !== '' ? parseFloat(body.shipWidthIn)  : null;
    if (body.shipHeightIn   !== undefined) updates.shipHeightIn   = body.shipHeightIn != null && body.shipHeightIn !== '' ? parseFloat(body.shipHeightIn) : null;
    // Image URL + physical weight were also missing from the update whitelist.
    if (body.imageUrl       !== undefined) updates.imageUrl       = body.imageUrl || null;
    if (body.weight         !== undefined) updates.weight         = body.weight ? parseFloat(body.weight) : null;
    if (body.attributes    !== undefined) updates.attributes    = (body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes)) ? body.attributes : {};
    if (body.unitPack      !== undefined) updates.unitPack      = body.unitPack   ? parseInt(body.unitPack)         : null;
    if (body.packInCase    !== undefined) updates.packInCase    = body.packInCase ? parseInt(body.packInCase)       : null;
    if (body.depositPerUnit!== undefined) updates.depositPerUnit= toPrice(body.depositPerUnit, 'depositPerUnit');
    if (body.caseDeposit   !== undefined) updates.caseDeposit   = toPrice(body.caseDeposit,    'caseDeposit');
    if (body.itemCode      !== undefined) updates.itemCode       = body.itemCode || null;

    // Fetch old snapshot before update (for audit before/after + label queue)
    const existing = await prisma.masterProduct.findUnique({
      where: { id: parseInt(id) },
      select: {
        name: true, upc: true, defaultRetailPrice: true, defaultCostPrice: true,
        taxClass: true, active: true, departmentId: true, vendorId: true,
      },
    });

    const product = await prisma.masterProduct.update({
      where: { id, orgId },
      data: updates,
      include: {
        department: { select: { id: true, name: true, code: true } },
        vendor:     { select: { id: true, name: true } },
      },
    });

    // Compute before/after diff for audit log — only the fields that changed.
    try {
      const diff = {};
      for (const k of Object.keys(updates)) {
        const before = existing?.[k];
        const after  = updates[k];
        // Skip no-ops (numeric 0 vs '0' etc. handled leniently)
        const same = (before == null && after == null) || String(before ?? '') === String(after ?? '');
        if (!same) diff[k] = { before, after };
      }
      if (Object.keys(diff).length > 0) {
        logAudit(req, 'update', 'product', product.id, { name: product.name, changes: diff });
      }
    } catch {}

    // Keep ProductUpc in sync whenever the primary UPC changes (incl. clearing it)
    if (body.upc !== undefined) {
      try { await syncPrimaryUpc(orgId, product.id, product.upc); }
      catch (e) {
        if (e.code === 'P2002') {
          return res.status(409).json({ success: false, error: e.message });
        }
        throw e;
      }
    }

    // Queue label if retail price changed
    try {
      if (body.defaultRetailPrice !== undefined && existing?.defaultRetailPrice != null) {
        await queueLabelForPriceChange(orgId, null, parseInt(id), existing.defaultRetailPrice, body.defaultRetailPrice);
      }
    } catch {}

    emitProductSync(orgId, product.id, 'update', {
      name: product.name, description: product.description, brand: product.brand,
      imageUrl: product.imageUrl, defaultRetailPrice: product.defaultRetailPrice,
      defaultCostPrice: product.defaultCostPrice, taxable: product.taxable,
      taxClass: product.taxClass, ebtEligible: product.ebtEligible,
      ageRequired: product.ageRequired, trackInventory: product.trackInventory,
      hideFromEcom: product.hideFromEcom, ecomDescription: product.ecomDescription,
      ecomTags: product.ecomTags, size: product.size, weight: product.weight,
      departmentName: product.department?.name,
    });

    // Populate global image cache on update
    if (product.upc && product.imageUrl) {
      const { upsertGlobalImage } = await import('../services/globalImageService.js');
      upsertGlobalImage({ upc: product.upc, imageUrl: product.imageUrl, source: 'manual', productName: product.name, brand: product.brand }).catch(() => {});
    }

    res.json({ success: true, data: product });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ success: false, error: err.message });
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Product not found' });
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'UPC already in use by another product' });
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteMasterProduct = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    // Snapshot for audit trail before soft-delete
    const snapshot = await prisma.masterProduct.findUnique({
      where: { id }, select: { name: true, upc: true, defaultRetailPrice: true },
    });

    await prisma.masterProduct.update({
      where: { id, orgId },
      data: { deleted: true, active: false },
    });

    emitProductSync(orgId, id, 'delete');
    logAudit(req, 'delete', 'product', id, snapshot || { id });
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Product not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * Bulk update retail prices for multiple master products.
 * Body: { updates: [{ id, defaultRetailPrice, defaultCostPrice? }] }
 */
export const bulkUpdateMasterProducts = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ success: false, error: 'updates array is required' });
    }

    // Fetch old prices before bulk update (for label queue)
    const oldProducts = await prisma.masterProduct.findMany({
      where: { id: { in: updates.map(u => u.id) }, orgId },
      select: { id: true, defaultRetailPrice: true },
    });
    const oldPriceMap = {};
    for (const p of oldProducts) oldPriceMap[p.id] = p.defaultRetailPrice;

    const results = await prisma.$transaction(
      updates.map(({ id, ...data }) =>
        prisma.masterProduct.update({
          where: { id: parseInt(id), orgId },
          data: {
            ...(data.defaultRetailPrice != null && { defaultRetailPrice: parseFloat(data.defaultRetailPrice) }),
            ...(data.defaultCostPrice   != null && { defaultCostPrice:   parseFloat(data.defaultCostPrice)   }),
            ...(data.defaultCasePrice   != null && { defaultCasePrice:   parseFloat(data.defaultCasePrice)   }),
            ...(data.active             != null && { active: Boolean(data.active) }),
          },
        })
      )
    );

    // Queue labels for any price changes
    try {
      for (const u of updates) {
        if (u.defaultRetailPrice !== undefined && oldPriceMap[u.id] != null) {
          await queueLabelForPriceChange(orgId, null, u.id, oldPriceMap[u.id], u.defaultRetailPrice);
        }
      }
    } catch {}

    res.json({ success: true, updated: results.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── Bulk delete (soft — sets active=false and deleted=true) ───────────────────
export const bulkDeleteMasterProducts = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { ids, permanent = false } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids array is required' });
    }

    if (permanent) {
      // Hard delete — removes from database completely
      // First delete related records
      await prisma.storeProduct.deleteMany({ where: { masterProductId: { in: ids.map(id => parseInt(id)) } } });
      await prisma.productUpc.deleteMany({ where: { masterProductId: { in: ids.map(id => parseInt(id)) } } });
      await prisma.productPackSize.deleteMany({ where: { masterProductId: { in: ids.map(id => parseInt(id)) } } });
      const result = await prisma.masterProduct.deleteMany({
        where: { id: { in: ids.map(id => parseInt(id)) }, orgId },
      });
      res.json({ success: true, deleted: result.count, type: 'permanent' });
    } else {
      // Soft delete — mark as deleted + inactive
      const result = await prisma.masterProduct.updateMany({
        where: { id: { in: ids.map(id => parseInt(id)) }, orgId },
        data: { deleted: true, active: false },
      });
      res.json({ success: true, deleted: result.count, type: 'soft' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── Delete ALL products in org (nuke option) ──────────────────────────────────
// Requires confirmation string "DELETE ALL" to prevent accidents.
// Supports soft (default) or permanent delete.
export const deleteAllProducts = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { confirmation, permanent = false } = req.body;

    if (confirmation !== 'DELETE ALL') {
      return res.status(400).json({
        success: false,
        error: 'Confirmation required — send { confirmation: "DELETE ALL" }',
      });
    }

    // Count first
    const beforeCount = await prisma.masterProduct.count({
      where: { orgId, ...(permanent ? {} : { deleted: false }) },
    });

    if (beforeCount === 0) {
      return res.json({ success: true, deleted: 0, type: permanent ? 'permanent' : 'soft', message: 'No products to delete' });
    }

    if (permanent) {
      // Hard delete — remove all related records first to avoid FK constraint violations
      const ids = await prisma.masterProduct.findMany({
        where: { orgId },
        select: { id: true },
      });
      const idList = ids.map(p => p.id);

      await prisma.storeProduct.deleteMany({ where: { masterProductId: { in: idList } } });
      await prisma.productUpc.deleteMany({ where: { masterProductId: { in: idList } } });
      await prisma.productPackSize.deleteMany({ where: { masterProductId: { in: idList } } }).catch(() => {});
      await prisma.inventoryAdjustment.deleteMany({ where: { masterProductId: { in: idList } } }).catch(() => {});
      await prisma.labelQueue.deleteMany({ where: { masterProductId: { in: idList } } }).catch(() => {});

      // Clean up purchase order references (items first, then empty POs)
      await prisma.purchaseOrderItem.deleteMany({ where: { masterProductId: { in: idList } } }).catch(() => {});
      // Remove any POs that now have zero items
      const emptyPOs = await prisma.purchaseOrder.findMany({
        where: { orgId, items: { none: {} } },
        select: { id: true },
      }).catch(() => []);
      if (emptyPOs.length > 0) {
        await prisma.purchaseOrder.deleteMany({
          where: { id: { in: emptyPOs.map(p => p.id) } },
        }).catch(() => {});
      }

      // Vendor product maps
      await prisma.vendorProductMap.deleteMany({ where: { orgId } }).catch(() => {});

      const result = await prisma.masterProduct.deleteMany({ where: { orgId } });
      res.json({ success: true, deleted: result.count, type: 'permanent' });
    } else {
      // Soft delete — mark all as deleted + inactive
      const result = await prisma.masterProduct.updateMany({
        where: { orgId, deleted: false },
        data: { deleted: true, active: false },
      });
      res.json({ success: true, deleted: result.count, type: 'soft' });
    }
  } catch (err) {
    console.error('[deleteAllProducts]', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── Bulk set department ───────────────────────────────────────────────────────
export const bulkSetDepartment = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { ids, departmentId } = req.body;
    if (!Array.isArray(ids) || !departmentId) {
      return res.status(400).json({ success: false, error: 'ids and departmentId required' });
    }
    const result = await prisma.masterProduct.updateMany({
      where: { id: { in: ids.map(id => parseInt(id)) }, orgId },
      data: { departmentId: parseInt(departmentId) },
    });
    res.json({ success: true, updated: result.count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── Bulk toggle active ───────────────────────────────────────────────────────
export const bulkToggleActive = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { ids, active } = req.body;
    if (!Array.isArray(ids) || active == null) {
      return res.status(400).json({ success: false, error: 'ids and active required' });
    }
    const result = await prisma.masterProduct.updateMany({
      where: { id: { in: ids.map(id => parseInt(id)) }, orgId },
      data: { active: Boolean(active) },
    });
    res.json({ success: true, updated: result.count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════
// STORE PRODUCTS
// ═══════════════════════════════════════════════════════

export const getStoreProducts = async (req, res) => {
  try {
    const orgId  = getOrgId(req);
    // Allow storeId from header (via middleware), URL params, or query params
    const storeId = getStoreId(req) || req.params.storeId || req.query.storeId || null;
    const { skip, take, page, limit } = paginationParams(req.query);

    if (!storeId) return res.status(400).json({ success: false, error: 'storeId is required' });

    const where = {
      storeId,
      orgId,
      ...(req.query.active !== undefined && { active: req.query.active === 'true' }),
      ...(req.query.inStock !== undefined && { inStock: req.query.inStock === 'true' }),
      ...(req.query.masterProductId && { masterProductId: parseInt(req.query.masterProductId) }),
    };

    const [products, total] = await Promise.all([
      prisma.storeProduct.findMany({
        where,
        include: {
          masterProduct: {
            include: {
              department: { select: { id: true, name: true, code: true, taxClass: true, ageRequired: true } },
              vendor:     { select: { id: true, name: true } },
              depositRule:{ select: { id: true, depositAmount: true } },
            },
          },
        },
        orderBy: { masterProduct: { name: 'asc' } },
        skip,
        take,
      }),
      prisma.storeProduct.count({ where }),
    ]);

    res.json({
      success: true,
      data: products,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const upsertStoreProduct = async (req, res) => {
  try {
    const orgId  = getOrgId(req);
    const storeId = getStoreId(req) || req.body.storeId;
    const { masterProductId, retailPrice, costPrice, casePrice,
            salePrice, saleStart, saleEnd,
            quantityOnHand, quantityOnOrder,
            active, inStock, aisle, shelfLocation, bin } = req.body;

    if (!storeId)        return res.status(400).json({ success: false, error: 'storeId is required' });
    if (!masterProductId) return res.status(400).json({ success: false, error: 'masterProductId is required' });

    // Fetch existing store product for label queue comparison
    const existingSP = await prisma.storeProduct.findFirst({
      where: { masterProductId: parseInt(masterProductId), storeId },
      select: { retailPrice: true, salePrice: true },
    });

    // Safe-parse dates (400 on out-of-range years instead of 500)
    let saleStartParsed, saleEndParsed;
    if (saleStart != null) {
      const r = tryParseDate(res, saleStart, 'saleStart'); if (!r.ok) return;
      saleStartParsed = r.value;
    }
    if (saleEnd != null) {
      const r = tryParseDate(res, saleEnd, 'saleEnd'); if (!r.ok) return;
      saleEndParsed = r.value;
    }

    const data = {
      orgId,
      ...(retailPrice       != null && { retailPrice:       parseFloat(retailPrice) }),
      ...(costPrice         != null && { costPrice:         parseFloat(costPrice) }),
      ...(casePrice         != null && { casePrice:         parseFloat(casePrice) }),
      ...(salePrice         != null && { salePrice:         parseFloat(salePrice) }),
      ...(saleStart         != null && { saleStart:         saleStartParsed }),
      ...(saleEnd           != null && { saleEnd:           saleEndParsed }),
      ...(quantityOnHand    != null && { quantityOnHand:    parseFloat(quantityOnHand), lastStockUpdate: new Date() }),
      ...(quantityOnOrder   != null && { quantityOnOrder:   parseFloat(quantityOnOrder) }),
      ...(active            != null && { active:            Boolean(active) }),
      ...(inStock           != null && { inStock:           Boolean(inStock) }),
      ...(aisle             != null && { aisle }),
      ...(shelfLocation     != null && { shelfLocation }),
      ...(bin               != null && { bin }),
    };

    const storeProduct = await prisma.storeProduct.upsert({
      where: { storeId_masterProductId: { storeId, masterProductId: parseInt(masterProductId) } },
      update: data,
      create: {
        storeId,
        orgId,
        masterProductId: parseInt(masterProductId),
        ...data,
      },
      include: {
        masterProduct: { select: { id: true, name: true, upc: true } },
      },
    });

    emitInventorySync(orgId, storeId, parseInt(masterProductId), 'update', {
      quantityOnHand: storeProduct.quantityOnHand, inStock: storeProduct.inStock,
      retailPrice: storeProduct.retailPrice, salePrice: storeProduct.salePrice,
    });

    // Queue labels for store-level price/sale changes
    try {
      const pid = parseInt(masterProductId);
      const body = req.body;
      if (body.retailPrice !== undefined && existingSP?.retailPrice != null && parseFloat(body.retailPrice) !== parseFloat(existingSP.retailPrice)) {
        await queueLabelForPriceChange(orgId, storeId, pid, existingSP.retailPrice, body.retailPrice);
      }
      if (body.salePrice && (!existingSP?.salePrice || parseFloat(existingSP.salePrice) === 0)) {
        await queueLabelForSale(orgId, storeId, pid, body.retailPrice || existingSP?.retailPrice, body.salePrice, false);
      }
      if (!body.salePrice && existingSP?.salePrice && parseFloat(existingSP.salePrice) > 0) {
        await queueLabelForSale(orgId, storeId, pid, body.retailPrice || existingSP?.retailPrice, existingSP.salePrice, true);
      }
    } catch {}

    res.json({ success: true, data: storeProduct });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * Adjust stock quantity (increment/decrement) for a store product.
 * Body: { masterProductId, adjustment: +5 or -3, reason: "received" | "sale" | "shrink" | "manual" }
 */
export const adjustStoreStock = async (req, res) => {
  try {
    const orgId  = getOrgId(req);
    const storeId = getStoreId(req);
    const { masterProductId, adjustment, reason } = req.body;

    if (!storeId)        return res.status(400).json({ success: false, error: 'storeId is required' });
    if (!masterProductId) return res.status(400).json({ success: false, error: 'masterProductId is required' });
    if (adjustment == null) return res.status(400).json({ success: false, error: 'adjustment is required' });

    const existing = await prisma.storeProduct.findUnique({
      where: { storeId_masterProductId: { storeId, masterProductId: parseInt(masterProductId) } },
    });

    const currentQty = parseFloat(existing?.quantityOnHand ?? 0);
    const newQty = currentQty + parseFloat(adjustment);

    // Allow negative inventory (stores that don't actively track stock).
    // inStock stays true if it was already set and we're receiving goods (positive adjustment).
    // Only flip inStock to false if there's truly nothing and adjustment was negative.
    const positivReceive = parseFloat(adjustment) > 0;
    const updated = await prisma.storeProduct.upsert({
      where: { storeId_masterProductId: { storeId, masterProductId: parseInt(masterProductId) } },
      update: {
        quantityOnHand:  newQty,
        lastStockUpdate: new Date(),
        lastReceivedAt:  positivReceive ? new Date() : undefined,
        posSyncSource:   reason?.includes('Invoice') ? 'invoice' : 'manual',
        inStock:         newQty > 0 ? true : (existing?.inStock ?? false),
      },
      create: {
        storeId,
        orgId,
        masterProductId:  parseInt(masterProductId),
        quantityOnHand:   newQty,
        lastStockUpdate:  new Date(),
        lastReceivedAt:   positivReceive ? new Date() : undefined,
        posSyncSource:    reason?.includes('Invoice') ? 'invoice' : 'manual',
        inStock:          newQty > 0,
      },
    });

    emitInventorySync(orgId, storeId, parseInt(masterProductId), 'update', {
      quantityOnHand: newQty, inStock: updated.inStock,
    });
    res.json({
      success: true,
      data: updated,
      previousQty: currentQty,
      newQty,
      adjustment: parseFloat(adjustment),
      reason: reason || 'manual',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────
// E-COMMERCE STOCK CHECK
// ─────────────────────────────────────────────────

/**
 * Synchronous stock check for the ecom-backend.
 * Called during online checkout to verify product availability.
 * Body: { storeId, items: [{ posProductId, requestedQty }] }
 */
export const ecomStockCheck = async (req, res) => {
  try {
    // ── Service-to-service authentication ────────────────────────────────
    // This endpoint is unauthenticated for the ecom-backend → POS-backend
    // internal stock check. Require a shared secret to prevent public abuse
    // (inventory enumeration, competitor reconnaissance).
    const provided = req.get('x-internal-api-key') || req.get('X-Internal-Api-Key');
    const expected = process.env.INTERNAL_API_KEY;
    if (!expected || provided !== expected) {
      return res.status(401).json({ available: false, error: 'Unauthorized' });
    }

    const { storeId, items } = req.body;

    if (!storeId || !Array.isArray(items)) {
      return res.status(400).json({ available: false, error: 'storeId and items[] required' });
    }

    const productIds = items.map(i => parseInt(i.posProductId)).filter(id => !isNaN(id) && id > 0);

    // If no valid product IDs, treat as available (ecom products may use cuid IDs)
    if (productIds.length === 0) {
      return res.json({ available: true, items: items.map(i => ({ posProductId: i.posProductId, requestedQty: i.requestedQty, quantityOnHand: null, available: true })) });
    }

    // Fetch current store-level inventory
    const storeProducts = await prisma.storeProduct.findMany({
      where: {
        storeId,
        masterProductId: { in: productIds },
      },
      select: {
        masterProductId: true,
        quantityOnHand: true,
        inStock: true,
        retailPrice: true,
      },
    });

    const spMap = {};
    for (const sp of storeProducts) {
      spMap[sp.masterProductId] = sp;
    }

    let allAvailable = true;
    const result = items.map(item => {
      const sp = spMap[parseInt(item.posProductId)];
      const qty = sp ? parseFloat(sp.quantityOnHand ?? 0) : 0;
      const requested = parseFloat(item.requestedQty);
      // If store doesn't track inventory (no StoreProduct), treat as available
      const available = !sp || qty >= requested || !sp.inStock === false;

      if (!available) allAvailable = false;

      return {
        posProductId: parseInt(item.posProductId),
        requestedQty: requested,
        quantityOnHand: qty,
        available,
      };
    });

    res.json({ available: allAvailable, items: result });
  } catch (err) {
    res.status(500).json({ available: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────
// PROMOTIONS
// ─────────────────────────────────────────────────

export const getPromotions = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { active, promoType } = req.query;
    const where = {
      orgId,
      ...(active === 'true'  && { active: true }),
      ...(active === 'false' && { active: false }),
      ...(promoType          && { promoType }),
    };
    const promos = await prisma.promotion.findMany({
      where,
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ success: true, data: promos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createPromotion = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      name, promoType, description,
      productIds, departmentIds,
      dealConfig,
      badgeLabel, badgeColor,
      startDate, endDate, active,
    } = req.body;

    if (!name || !promoType) {
      return res.status(400).json({ error: 'name and promoType are required.' });
    }

    const sd = tryParseDate(res, startDate, 'startDate'); if (!sd.ok) return;
    const ed = tryParseDate(res, endDate,   'endDate');   if (!ed.ok) return;

    const promo = await prisma.promotion.create({
      data: {
        orgId,
        name,
        promoType,
        description:   description   ?? null,
        productIds:    Array.isArray(productIds)    ? productIds.map(Number)    : [],
        departmentIds: Array.isArray(departmentIds) ? departmentIds.map(Number) : [],
        dealConfig:    dealConfig    ?? {},
        badgeLabel:    badgeLabel    ?? null,
        badgeColor:    badgeColor    ?? null,
        startDate:     sd.value,
        endDate:       ed.value,
        active:        active        ?? true,
      },
    });

    res.status(201).json({ success: true, data: promo });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updatePromotion = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const existing = await prisma.promotion.findFirst({ where: { id, orgId } });
    if (!existing) return res.status(404).json({ error: 'Promotion not found.' });

    const {
      name, promoType, description,
      productIds, departmentIds,
      dealConfig,
      badgeLabel, badgeColor,
      startDate, endDate, active,
    } = req.body;

    const updated = await prisma.promotion.update({
      where: { id },
      data: {
        ...(name          != null && { name }),
        ...(promoType     != null && { promoType }),
        ...(description   != null && { description }),
        ...(productIds    != null && { productIds: productIds.map(Number) }),
        ...(departmentIds != null && { departmentIds: departmentIds.map(Number) }),
        ...(dealConfig    != null && { dealConfig }),
        ...(badgeLabel    != null && { badgeLabel }),
        ...(badgeColor    != null && { badgeColor }),
        ...(active        != null && { active }),
      },
    });

    // Date updates are applied separately after safe-parsing
    if (startDate !== undefined) {
      const r = tryParseDate(res, startDate, 'startDate'); if (!r.ok) return;
      await prisma.promotion.update({ where: { id }, data: { startDate: r.value } });
    }
    if (endDate !== undefined) {
      const r = tryParseDate(res, endDate, 'endDate'); if (!r.ok) return;
      await prisma.promotion.update({ where: { id }, data: { endDate: r.value } });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deletePromotion = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const existing = await prisma.promotion.findFirst({ where: { id, orgId } });
    if (!existing) return res.status(404).json({ error: 'Promotion not found.' });

    await prisma.promotion.delete({ where: { id } });
    res.json({ success: true, message: 'Promotion deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const evaluatePromotions = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { items } = req.body; // [{ lineId, productId, departmentId, qty, unitPrice, discountEligible }]

    if (!Array.isArray(items) || !items.length) {
      return res.json({ success: true, data: { lineAdjustments: {}, totalSaving: 0, appliedPromos: [] } });
    }

    const now = new Date();
    const promos = await prisma.promotion.findMany({
      where: {
        orgId,
        active: true,
        OR: [
          { startDate: null },
          { startDate: { lte: now } },
        ],
        AND: [
          {
            OR: [
              { endDate: null },
              { endDate: { gte: now } },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    // Simple server-side evaluation (mirrors promoEngine.js logic)
    const lineAdjustments = {};
    const appliedPromos   = [];

    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

    const getQualifying = (promo) => items.filter(item => {
      if (item.discountEligible === false) return false;
      const hasProd = promo.productIds?.length > 0;
      const hasDept = promo.departmentIds?.length > 0;
      if (!hasProd && !hasDept) return true;
      if (hasProd && promo.productIds.includes(item.productId)) return true;
      if (hasDept && promo.departmentIds.includes(item.departmentId)) return true;
      return false;
    });

    const makeAdj = (promo, dt, dv) => ({
      discountType:  dt,
      discountValue: round2(dv),
      promoId:       promo.id,
      promoName:     promo.name,
      badgeLabel:    promo.badgeLabel || promo.name,
      badgeColor:    promo.badgeColor || '#f59e0b',
    });

    for (const promo of promos) {
      const cfg = promo.dealConfig || {};
      const qualifying = getQualifying(promo);
      if (!qualifying.length) continue;

      const result = {};

      if (promo.promoType === 'sale') {
        for (const item of qualifying) {
          if (item.qty < (cfg.minQty || 1)) continue;
          result[item.lineId] = makeAdj(promo, cfg.discountType || 'percent', parseFloat(cfg.discountValue) || 0);
        }
      } else if (promo.promoType === 'bogo') {
        const buyQty = cfg.buyQty || 1;
        const getQty = cfg.getQty || 1;
        const getDiscount = cfg.getDiscount != null ? cfg.getDiscount : 100;
        const setSize = buyQty + getQty;
        const units = [];
        for (const item of qualifying) {
          for (let i = 0; i < item.qty; i++) units.push({ lineId: item.lineId, price: parseFloat(item.unitPrice) });
        }
        units.sort((a, b) => b.price - a.price);
        let numSets = Math.floor(units.length / setSize);
        if (cfg.maxSets) numSets = Math.min(numSets, cfg.maxSets);
        const lineDisc = {};
        for (let s = 0; s < numSets; s++) {
          const free = units.slice(s * setSize + buyQty, (s + 1) * setSize);
          for (const u of free) lineDisc[u.lineId] = (lineDisc[u.lineId] || 0) + u.price * getDiscount / 100;
        }
        for (const item of qualifying) {
          if (!lineDisc[item.lineId]) continue;
          result[item.lineId] = makeAdj(promo, 'amount', round2(lineDisc[item.lineId] / item.qty));
        }
      } else if (promo.promoType === 'volume') {
        const totalQty = qualifying.reduce((s, i) => s + i.qty, 0);
        const tiers = (cfg.tiers || []).slice().sort((a, b) => b.minQty - a.minQty);
        const tier  = tiers.find(t => totalQty >= t.minQty);
        if (tier) {
          for (const item of qualifying) {
            result[item.lineId] = makeAdj(promo, tier.discountType || 'percent', parseFloat(tier.discountValue) || 0);
          }
        }
      } else if (promo.promoType === 'mix_match') {
        const groupSize   = cfg.groupSize   || 2;
        const bundlePrice = parseFloat(cfg.bundlePrice) || 0;
        const units = [];
        for (const item of qualifying) {
          for (let i = 0; i < item.qty; i++) units.push({ lineId: item.lineId, price: parseFloat(item.unitPrice) });
        }
        units.sort((a, b) => a.price - b.price);
        const numGroups  = Math.floor(units.length / groupSize);
        if (numGroups > 0) {
          const groupUnits = units.slice(0, numGroups * groupSize);
          const regTotal   = groupUnits.reduce((s, u) => s + u.price, 0);
          const totalDisc  = Math.max(0, regTotal - numGroups * bundlePrice);
          if (totalDisc > 0) {
            const lineDiscTotal = {};
            for (const u of groupUnits) lineDiscTotal[u.lineId] = (lineDiscTotal[u.lineId] || 0) + (u.price / regTotal) * totalDisc;
            for (const item of qualifying) {
              if (!lineDiscTotal[item.lineId]) continue;
              result[item.lineId] = makeAdj(promo, 'amount', round2(lineDiscTotal[item.lineId] / item.qty));
            }
          }
        }
      } else if (promo.promoType === 'combo') {
        const requiredGroups = cfg.requiredGroups || [];
        let allSatisfied = true;
        for (const group of requiredGroups) {
          const ids = group.productIds || [];
          const minQty = group.minQty || 1;
          const qty = items.filter(i => ids.includes(i.productId)).reduce((s, i) => s + i.qty, 0);
          if (qty < minQty) { allSatisfied = false; break; }
        }
        if (allSatisfied) {
          const comboIds = requiredGroups.flatMap(g => g.productIds || []);
          for (const item of items) {
            if (!comboIds.includes(item.productId)) continue;
            result[item.lineId] = makeAdj(promo, cfg.discountType || 'percent', parseFloat(cfg.discountValue) || 0);
          }
        }
      }

      if (Object.keys(result).length) {
        // Merge: keep better discount per line
        for (const [lineId, adj] of Object.entries(result)) {
          const existing = lineAdjustments[lineId];
          const item     = items.find(i => i.lineId === lineId);
          if (!item) continue;
          const newSav = adj.discountType === 'percent' ? item.unitPrice * adj.discountValue / 100 : adj.discountValue;
          const exSav  = existing
            ? (existing.discountType === 'percent' ? item.unitPrice * existing.discountValue / 100 : existing.discountValue)
            : -1;
          if (newSav > exSav) lineAdjustments[lineId] = adj;
        }
        appliedPromos.push({ id: promo.id, name: promo.name, promoType: promo.promoType, badgeLabel: promo.badgeLabel, badgeColor: promo.badgeColor });
      }
    }

    let totalSaving = 0;
    for (const [lineId, adj] of Object.entries(lineAdjustments)) {
      const item = items.find(i => i.lineId === lineId);
      if (!item) continue;
      if (adj.discountType === 'percent') totalSaving += item.unitPrice * item.qty * adj.discountValue / 100;
      else if (adj.discountType === 'amount') totalSaving += Math.min(adj.discountValue * item.qty, item.unitPrice * item.qty);
      else if (adj.discountType === 'fixed') totalSaving += Math.max(0, item.unitPrice * item.qty - adj.discountValue * item.qty);
    }

    res.json({ success: true, data: { lineAdjustments, totalSaving: round2(totalSaving), appliedPromos } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════
// PRODUCT UPCs  (multiple barcodes per product)
// ═══════════════════════════════════════════════════════

export const getProductUpcs = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const upcs = await prisma.productUpc.findMany({
      where: { orgId, masterProductId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({ success: true, data: upcs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const addProductUpc = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const { upc, label, isDefault } = req.body;

    if (!upc) return res.status(400).json({ success: false, error: 'upc is required' });

    const normalizedUpc = normalizeUPC(upc) || upc.replace(/[\s\-\.]/g, '');

    // Verify product belongs to org
    const product = await prisma.masterProduct.findFirst({ where: { id: masterProductId, orgId } });
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

    // If setting as default, clear existing default
    if (isDefault) {
      await prisma.productUpc.updateMany({ where: { orgId, masterProductId }, data: { isDefault: false } });
    }

    const row = await prisma.productUpc.create({
      data: { orgId, masterProductId, upc: normalizedUpc, label: label || null, isDefault: Boolean(isDefault) },
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'This UPC is already registered to another product' });
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteProductUpc = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const upcId = req.params.upcId;
    await prisma.productUpc.deleteMany({ where: { id: upcId, orgId, masterProductId } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════
// PRODUCT PACK SIZES  (cashier picker at scan time)
// ═══════════════════════════════════════════════════════

export const getProductPackSizes = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const sizes = await prisma.productPackSize.findMany({
      where: { orgId, masterProductId },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: sizes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const addProductPackSize = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const { label, unitCount, packsPerCase, retailPrice, costPrice, isDefault, sortOrder } = req.body;

    if (!label || retailPrice == null) return res.status(400).json({ success: false, error: 'label and retailPrice are required' });

    const product = await prisma.masterProduct.findFirst({ where: { id: masterProductId, orgId } });
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

    if (isDefault) {
      await prisma.productPackSize.updateMany({ where: { orgId, masterProductId }, data: { isDefault: false } });
    }

    const row = await prisma.productPackSize.create({
      data: {
        orgId, masterProductId, label,
        unitCount:    unitCount    ? parseInt(unitCount)    : 1,
        packsPerCase: packsPerCase ? parseInt(packsPerCase) : null,
        retailPrice:  parseFloat(retailPrice),
        costPrice:    costPrice    ? parseFloat(costPrice)  : null,
        isDefault:    Boolean(isDefault),
        sortOrder:    sortOrder    ? parseInt(sortOrder)    : 0,
      },
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateProductPackSize = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const sizeId = req.params.sizeId;
    const { label, unitCount, packsPerCase, retailPrice, costPrice, isDefault, sortOrder } = req.body;

    if (isDefault) {
      await prisma.productPackSize.updateMany({ where: { orgId, masterProductId }, data: { isDefault: false } });
    }

    const row = await prisma.productPackSize.update({
      where: { id: sizeId },
      data: {
        ...(label        !== undefined && { label }),
        ...(unitCount    !== undefined && { unitCount: parseInt(unitCount) }),
        ...(packsPerCase !== undefined && { packsPerCase: packsPerCase ? parseInt(packsPerCase) : null }),
        ...(retailPrice  !== undefined && { retailPrice: parseFloat(retailPrice) }),
        ...(costPrice    !== undefined && { costPrice: costPrice ? parseFloat(costPrice) : null }),
        ...(isDefault    !== undefined && { isDefault: Boolean(isDefault) }),
        ...(sortOrder    !== undefined && { sortOrder: parseInt(sortOrder) }),
      },
    });
    res.json({ success: true, data: row });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Pack size not found' });
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteProductPackSize = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const sizeId = req.params.sizeId;
    await prisma.productPackSize.deleteMany({ where: { id: sizeId, orgId } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════
// BULK REPLACE PACK SIZES
// Deletes all existing pack sizes for a product and creates new ones.
// Body: { sizes: [{ label, unitCount, packsPerCase, retailPrice, costPrice, isDefault, sortOrder }] }
// ═══════════════════════════════════════════════════════

export const bulkReplacePackSizes = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const masterProductId = parseInt(req.params.id);
    const { sizes = [] } = req.body;

    // Verify product belongs to org
    const product = await prisma.masterProduct.findFirst({ where: { id: masterProductId, orgId } });
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

    // Delete all existing pack sizes and insert new ones atomically
    await prisma.$transaction([
      prisma.productPackSize.deleteMany({ where: { orgId, masterProductId } }),
      ...(sizes.length > 0 ? [
        prisma.productPackSize.createMany({
          data: sizes.map((s, idx) => ({
            orgId,
            masterProductId,
            label:        s.label || `Pack ${idx + 1}`,
            unitCount:    s.unitCount    ? parseInt(s.unitCount)    : 1,
            packsPerCase: s.packsPerCase ? parseInt(s.packsPerCase) : null,
            retailPrice:  parseFloat(s.retailPrice || 0),
            costPrice:    s.costPrice    ? parseFloat(s.costPrice)  : null,
            isDefault:    Boolean(s.isDefault),
            sortOrder:    idx,
          })),
        }),
      ] : []),
    ]);

    // Return the newly created pack sizes
    const created = await prisma.productPackSize.findMany({
      where: { orgId, masterProductId },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
