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

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

const getOrgId = (req) => req.tenantId || req.user?.tenantId || req.user?.orgId;
const getStoreId = (req) => req.storeId;

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

export const createDepartment = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { name, code, description, ageRequired, ebtEligible, taxClass,
            bottleDeposit, sortOrder, color } = req.body;

    if (!name) return res.status(400).json({ success: false, error: 'name is required' });

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
      },
    });

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
            bottleDeposit, sortOrder, color, active } = req.body;

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
        ...(active        !== undefined && { active: Boolean(active) }),
      },
    });

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

    // Soft delete — set active: false
    await prisma.department.update({ where: { id, orgId }, data: { active: false } });
    res.json({ success: true, message: 'Department deactivated' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Department not found' });
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

export const createTaxRule = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { name, description, rate, appliesTo, ebtExempt, state, county, storeId } = req.body;

    if (!name || rate == null || !appliesTo) {
      return res.status(400).json({ success: false, error: 'name, rate, and appliesTo are required' });
    }

    const rule = await prisma.taxRule.create({
      data: {
        orgId,
        storeId: storeId || null,
        name,
        description: description || null,
        rate,
        appliesTo,
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

    const rule = await prisma.taxRule.update({
      where: { id, orgId },
      data: req.body,
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
    await prisma.taxRule.update({ where: { id, orgId }, data: { active: false } });
    res.json({ success: true, message: 'Tax rule deactivated' });
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
    const { name, code, contactName, email, phone, address, website, terms, accountNo, aliases } = req.body;

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

    const vendor = await prisma.vendor.update({
      where: { id, orgId },
      data: req.body,
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
    await prisma.vendor.update({ where: { id, orgId }, data: { active: false } });
    res.json({ success: true, message: 'Vendor deactivated' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Vendor not found' });
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
        startDate:      startDate ? new Date(startDate) : null,
        endDate:        endDate   ? new Date(endDate)   : null,
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

export const getMasterProducts = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { skip, take, page, limit } = paginationParams(req.query);
    const includeDeleted = req.query.includeDeleted === 'true';

    const where = {
      orgId,
      deleted: includeDeleted ? undefined : false,
      ...(req.query.departmentId && { departmentId: parseInt(req.query.departmentId) }),
      ...(req.query.vendorId     && { vendorId:     parseInt(req.query.vendorId)     }),
      ...(req.query.active !== undefined && { active: req.query.active === 'true' }),
    };

    const [products, total] = await Promise.all([
      prisma.masterProduct.findMany({
        where,
        include: {
          department: { select: { id: true, name: true, code: true, taxClass: true } },
          vendor:     { select: { id: true, name: true, code: true } },
          depositRule:{ select: { id: true, name: true, depositAmount: true } },
        },
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      prisma.masterProduct.count({ where }),
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

export const searchMasterProducts = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const query = req.query.q?.trim() || '';
    const { skip, take, page, limit } = paginationParams(req.query);

    if (!query) {
      return res.status(400).json({ success: false, error: 'Search query (q) is required' });
    }

    // Exact UPC match first (fastest, for barcode scanner)
    if (/^\d{7,14}$/.test(query)) {
      const exact = await prisma.masterProduct.findFirst({
        where: { orgId, upc: query, deleted: false },
        include: {
          department: { select: { id: true, name: true, code: true, taxClass: true, ageRequired: true } },
          vendor:     { select: { id: true, name: true } },
          depositRule:{ select: { id: true, depositAmount: true } },
        },
      });
      if (exact) return res.json({ success: true, data: [exact], pagination: { page: 1, limit: 1, total: 1, pages: 1 } });
    }

    // Full-text / fuzzy search — PostgreSQL ILIKE
    const where = {
      orgId,
      deleted: false,
      OR: [
        { name:     { contains: query, mode: 'insensitive' } },
        { upc:      { contains: query } },
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
        },
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      prisma.masterProduct.count({ where }),
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
        storeProducts:{ select: { id: true, storeId: true, retailPrice: true, quantityOnHand: true, active: true } },
      },
    });

    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
    res.json({ success: true, data: product });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createMasterProduct = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      upc, plu, sku, itemCode, name, description, brand, imageUrl,
      size, sizeUnit, pack, casePacks, sellUnitSize, sellUnit, innerPack, unitsPerPack, weight,
      departmentId, vendorId, depositRuleId, containerType, containerVolumeOz,
      taxClass, defaultCostPrice, defaultRetailPrice, defaultCasePrice,
      byWeight, byUnit,
      ebtEligible, ageRequired, taxable, discountEligible, foodstamp,
      trackInventory, reorderPoint, reorderQty,
      hideFromEcom, ecomDescription, ecomTags,
      active,
    } = req.body;

    if (!name) return res.status(400).json({ success: false, error: 'name is required' });

    const product = await prisma.masterProduct.create({
      data: {
        orgId,
        upc:                upc || null,
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
        casePacks:          casePacks    ? parseInt(casePacks)    : null,
        sellUnitSize:       sellUnitSize ? parseInt(sellUnitSize) : null,
        sellUnit:           sellUnit     || null,
        innerPack:          innerPack    ? parseInt(innerPack)    : null,
        unitsPerPack:       unitsPerPack ? parseInt(unitsPerPack) : null,
        weight:             weight ? parseFloat(weight) : null,
        departmentId:       departmentId ? parseInt(departmentId) : null,
        vendorId:           vendorId     ? parseInt(vendorId)     : null,
        depositRuleId:      depositRuleId? parseInt(depositRuleId): null,
        containerType:      containerType || null,
        containerVolumeOz:  containerVolumeOz ? parseFloat(containerVolumeOz) : null,
        taxClass:           taxClass || null,
        defaultCostPrice:   defaultCostPrice   != null ? parseFloat(defaultCostPrice)   : null,
        defaultRetailPrice: defaultRetailPrice != null ? parseFloat(defaultRetailPrice) : null,
        defaultCasePrice:   defaultCasePrice   != null ? parseFloat(defaultCasePrice)   : null,
        byWeight:           Boolean(byWeight),
        byUnit:             byUnit !== false,
        ebtEligible:        Boolean(ebtEligible),
        ageRequired:        ageRequired ? parseInt(ageRequired) : null,
        taxable:            taxable !== false,
        discountEligible:   discountEligible !== false,
        foodstamp:          Boolean(foodstamp),
        trackInventory:     trackInventory !== false,
        reorderPoint:       reorderPoint ? parseInt(reorderPoint) : null,
        reorderQty:         reorderQty   ? parseInt(reorderQty)   : null,
        hideFromEcom:       Boolean(hideFromEcom),
        ecomDescription:    ecomDescription || null,
        ecomTags:           Array.isArray(ecomTags) ? ecomTags : [],
        active:             active !== false,
      },
      include: {
        department: { select: { id: true, name: true, code: true } },
        vendor:     { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ success: true, data: product });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, error: 'A product with this UPC already exists' });
    }
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
    if (body.upc           !== undefined) updates.upc           = body.upc || null;
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
    if (body.taxClass      !== undefined) updates.taxClass      = body.taxClass || null;
    if (body.defaultCostPrice   !== undefined) updates.defaultCostPrice   = body.defaultCostPrice   != null ? parseFloat(body.defaultCostPrice)   : null;
    if (body.defaultRetailPrice !== undefined) updates.defaultRetailPrice = body.defaultRetailPrice != null ? parseFloat(body.defaultRetailPrice) : null;
    if (body.defaultCasePrice   !== undefined) updates.defaultCasePrice   = body.defaultCasePrice   != null ? parseFloat(body.defaultCasePrice)   : null;
    if (body.ebtEligible   !== undefined) updates.ebtEligible   = Boolean(body.ebtEligible);
    if (body.ageRequired   !== undefined) updates.ageRequired   = body.ageRequired ? parseInt(body.ageRequired) : null;
    if (body.taxable       !== undefined) updates.taxable       = Boolean(body.taxable);
    if (body.discountEligible !== undefined) updates.discountEligible = Boolean(body.discountEligible);
    if (body.byWeight      !== undefined) updates.byWeight      = Boolean(body.byWeight);
    if (body.byUnit        !== undefined) updates.byUnit        = Boolean(body.byUnit);
    if (body.trackInventory !== undefined) updates.trackInventory = Boolean(body.trackInventory);
    if (body.reorderPoint  !== undefined) updates.reorderPoint  = body.reorderPoint ? parseInt(body.reorderPoint) : null;
    if (body.reorderQty    !== undefined) updates.reorderQty    = body.reorderQty   ? parseInt(body.reorderQty)   : null;
    if (body.active        !== undefined) updates.active        = Boolean(body.active);
    if (body.hideFromEcom  !== undefined) updates.hideFromEcom  = Boolean(body.hideFromEcom);
    if (body.ecomTags      !== undefined) updates.ecomTags      = Array.isArray(body.ecomTags) ? body.ecomTags : [];

    const product = await prisma.masterProduct.update({
      where: { id, orgId },
      data: updates,
      include: {
        department: { select: { id: true, name: true, code: true } },
        vendor:     { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, data: product });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Product not found' });
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'UPC already in use by another product' });
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteMasterProduct = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    await prisma.masterProduct.update({
      where: { id, orgId },
      data: { deleted: true, active: false },
    });

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

    res.json({ success: true, updated: results.length });
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
    const storeId = getStoreId(req) || req.params.storeId;
    const { skip, take, page, limit } = paginationParams(req.query);

    if (!storeId) return res.status(400).json({ success: false, error: 'storeId is required' });

    const where = {
      storeId,
      orgId,
      ...(req.query.active !== undefined && { active: req.query.active === 'true' }),
      ...(req.query.inStock !== undefined && { inStock: req.query.inStock === 'true' }),
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

    const data = {
      orgId,
      ...(retailPrice       != null && { retailPrice:       parseFloat(retailPrice) }),
      ...(costPrice         != null && { costPrice:         parseFloat(costPrice) }),
      ...(casePrice         != null && { casePrice:         parseFloat(casePrice) }),
      ...(salePrice         != null && { salePrice:         parseFloat(salePrice) }),
      ...(saleStart         != null && { saleStart:         new Date(saleStart) }),
      ...(saleEnd           != null && { saleEnd:           new Date(saleEnd) }),
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

    const updated = await prisma.storeProduct.upsert({
      where: { storeId_masterProductId: { storeId, masterProductId: parseInt(masterProductId) } },
      update: {
        quantityOnHand: newQty,
        lastStockUpdate: new Date(),
        inStock: newQty > 0,
      },
      create: {
        storeId,
        orgId,
        masterProductId: parseInt(masterProductId),
        quantityOnHand: newQty,
        lastStockUpdate: new Date(),
        inStock: newQty > 0,
      },
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
        startDate:     startDate     ? new Date(startDate) : null,
        endDate:       endDate       ? new Date(endDate)   : null,
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
        ...(startDate     != null && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate       != null && { endDate:   endDate   ? new Date(endDate)   : null }),
        ...(active        != null && { active }),
      },
    });

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
