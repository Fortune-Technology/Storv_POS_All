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
            bottleDeposit, sortOrder, color, showInPOS } = req.body;

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
        showInPOS:     showInPOS !== undefined ? Boolean(showInPOS) : true,
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
            bottleDeposit, sortOrder, color, showInPOS, active } = req.body;

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

    // Soft delete — set active: false
    await prisma.department.update({ where: { id, orgId }, data: { active: false } });
    emitDepartmentSync(orgId, id, 'delete');
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
    // Try all common UPC variants so storage format differences don't cause misses.
    // e.g. scanner emits "082928223365" (12-digit) → also try 14-digit padded, etc.
    if (/^\d{6,14}$/.test(query)) {
      const stripped = query.replace(/^0+/, '') || '0';
      const upcVariants = [...new Set([
        query,
        stripped,
        stripped.padStart(12, '0'),
        stripped.padStart(13, '0'),
        stripped.padStart(14, '0'),
        ...(query.length === 14 ? [query.slice(-12), query.slice(-13)] : []),
        ...(query.length === 13 && query[0] === '0' ? [query.slice(1)] : []),
        ...(query.length === 12 ? ['0' + query] : []),
      ])].filter(v => v.length >= 6);

      // First check ProductUpc table (multiple-UPC support)
      const upcRow = await prisma.productUpc.findFirst({
        where: { orgId, upc: { in: upcVariants } },
        select: { masterProductId: true },
      });

      const exactWhere = upcRow
        ? { id: upcRow.masterProductId, orgId, deleted: false }
        : { orgId, deleted: false, upc: { in: upcVariants } };

      const exact = await prisma.masterProduct.findFirst({
        where: exactWhere,
        include: {
          department: { select: { id: true, name: true, code: true, taxClass: true, ageRequired: true } },
          vendor:     { select: { id: true, name: true } },
          depositRule:{ select: { id: true, depositAmount: true } },
          upcs:       { select: { id: true, upc: true, label: true, isDefault: true } },
          packSizes:  { orderBy: { sortOrder: 'asc' } },
        },
      });
      if (exact) return res.json({ success: true, data: [exact], pagination: { page: 1, limit: 1, total: 1, pages: 1 } });
    }

    // Build variant list for fallback text search too (if query is all digits)
    const isDigitQuery = /^\d{6,14}$/.test(query);
    const digitVariants = isDigitQuery ? (() => {
      const stripped = query.replace(/^0+/, '') || '0';
      return [...new Set([query, stripped, stripped.padStart(12, '0'), stripped.padStart(13, '0'), stripped.padStart(14, '0')])].filter(v => v.length >= 6);
    })() : null;

    // Full-text / fuzzy search — PostgreSQL ILIKE
    const where = {
      orgId,
      deleted: false,
      OR: [
        { name:     { contains: query, mode: 'insensitive' } },
        ...(isDigitQuery && digitVariants
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
        upcs:         { select: { id: true, upc: true, label: true, isDefault: true }, orderBy: { isDefault: 'desc' } },
        packSizes:    { orderBy: { sortOrder: 'asc' } },
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
      unitPack, packInCase, depositPerUnit,
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
        unitPack:           unitPack     ? parseInt(unitPack)     : null,
        packInCase:         packInCase   ? parseInt(packInCase)   : null,
        depositPerUnit:     depositPerUnit != null ? parseFloat(depositPerUnit) : null,
        caseDeposit:        req.body.caseDeposit   != null ? parseFloat(req.body.caseDeposit) : null,
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
    if (body.unitPack      !== undefined) updates.unitPack      = body.unitPack   ? parseInt(body.unitPack)         : null;
    if (body.packInCase    !== undefined) updates.packInCase    = body.packInCase ? parseInt(body.packInCase)       : null;
    if (body.depositPerUnit!== undefined) updates.depositPerUnit= body.depositPerUnit != null ? parseFloat(body.depositPerUnit) : null;
    if (body.caseDeposit   !== undefined) updates.caseDeposit   = body.caseDeposit   != null ? parseFloat(body.caseDeposit)   : null;
    if (body.itemCode      !== undefined) updates.itemCode       = body.itemCode || null;

    const product = await prisma.masterProduct.update({
      where: { id, orgId },
      data: updates,
      include: {
        department: { select: { id: true, name: true, code: true } },
        vendor:     { select: { id: true, name: true } },
      },
    });

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

    emitProductSync(orgId, id, 'delete');
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

    emitInventorySync(orgId, storeId, parseInt(masterProductId), 'update', {
      quantityOnHand: storeProduct.quantityOnHand, inStock: storeProduct.inStock,
      retailPrice: storeProduct.retailPrice, salePrice: storeProduct.salePrice,
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
    const { storeId, items } = req.body;

    if (!storeId || !Array.isArray(items)) {
      return res.status(400).json({ available: false, error: 'storeId and items[] required' });
    }

    const productIds = items.map(i => parseInt(i.posProductId));

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

    // Verify product belongs to org
    const product = await prisma.masterProduct.findFirst({ where: { id: masterProductId, orgId } });
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

    // If setting as default, clear existing default
    if (isDefault) {
      await prisma.productUpc.updateMany({ where: { orgId, masterProductId }, data: { isDefault: false } });
    }

    const row = await prisma.productUpc.create({
      data: { orgId, masterProductId, upc, label: label || null, isDefault: Boolean(isDefault) },
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
