/**
 * Product Group Controller
 *
 * Product Groups are templates that share classification + pricing across
 * multiple products (e.g. "750ml Red Wine", "12oz Can Beer").
 *
 * When a group has autoSync=true, changes to group fields cascade to all
 * member products. When autoSync=false, the group is a one-time template.
 */

import prisma from '../config/postgres.js';
import { queueLabelForPriceChange } from '../services/labelQueueService.js';

// Fields on ProductGroup that can be cascaded to MasterProduct
const CASCADE_FIELDS = [
  'departmentId', 'vendorId', 'taxClass', 'ageRequired',
  'ebtEligible', 'discountEligible', 'taxable',
  'depositRuleId', 'containerType', 'containerVolumeOz',
  'size', 'sizeUnit', 'pack', 'casePacks', 'sellUnitSize',
  'defaultCostPrice', 'defaultRetailPrice', 'defaultCasePrice',
];

function getOrgId(req) {
  return req.orgId || req.user?.orgId;
}

// ── GET /api/catalog/groups ──────────────────────────────────────────────────
export const listProductGroups = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { active, departmentId } = req.query;

    const where = { orgId };
    if (active !== undefined) where.active = active === 'true';
    if (departmentId) where.departmentId = parseInt(departmentId);

    const groups = await prisma.productGroup.findMany({
      where,
      include: {
        department: { select: { id: true, name: true, code: true, color: true } },
        vendor:     { select: { id: true, name: true, code: true } },
        _count:     { select: { products: true } },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: groups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── GET /api/catalog/groups/:id ──────────────────────────────────────────────
export const getProductGroup = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const group = await prisma.productGroup.findFirst({
      where: { id, orgId },
      include: {
        department: true,
        vendor: true,
        depositRule: true,
        products: {
          select: {
            id: true, name: true, upc: true, defaultRetailPrice: true,
            defaultCostPrice: true, active: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    res.json({ success: true, data: group });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── POST /api/catalog/groups ─────────────────────────────────────────────────
export const createProductGroup = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      name, description, color,
      departmentId, vendorId, taxClass, ageRequired,
      ebtEligible, discountEligible, taxable,
      depositRuleId, containerType, containerVolumeOz,
      size, sizeUnit, pack, casePacks, sellUnitSize,
      defaultCostPrice, defaultRetailPrice, defaultCasePrice,
      salePrice, saleStart, saleEnd,
      autoSync = true, active = true,
    } = req.body;

    if (!name) return res.status(400).json({ success: false, error: 'name is required' });

    const group = await prisma.productGroup.create({
      data: {
        orgId, name, description, color,
        departmentId: departmentId ? parseInt(departmentId) : null,
        vendorId: vendorId ? parseInt(vendorId) : null,
        taxClass, ageRequired: ageRequired ? parseInt(ageRequired) : null,
        ebtEligible, discountEligible, taxable,
        depositRuleId: depositRuleId ? parseInt(depositRuleId) : null,
        containerType,
        containerVolumeOz: containerVolumeOz != null ? parseFloat(containerVolumeOz) : null,
        size, sizeUnit,
        pack: pack ? parseInt(pack) : null,
        casePacks: casePacks ? parseInt(casePacks) : null,
        sellUnitSize: sellUnitSize ? parseInt(sellUnitSize) : null,
        defaultCostPrice: defaultCostPrice != null ? parseFloat(defaultCostPrice) : null,
        defaultRetailPrice: defaultRetailPrice != null ? parseFloat(defaultRetailPrice) : null,
        defaultCasePrice: defaultCasePrice != null ? parseFloat(defaultCasePrice) : null,
        salePrice: salePrice != null ? parseFloat(salePrice) : null,
        saleStart: saleStart ? new Date(saleStart) : null,
        saleEnd: saleEnd ? new Date(saleEnd) : null,
        autoSync, active,
      },
    });

    res.status(201).json({ success: true, data: group });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ success: false, error: 'A group with this name already exists' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── PUT /api/catalog/groups/:id ──────────────────────────────────────────────
// Updates the group and optionally cascades changes to all members if autoSync
export const updateProductGroup = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const existing = await prisma.productGroup.findFirst({ where: { id, orgId } });
    if (!existing) return res.status(404).json({ success: false, error: 'Group not found' });

    const {
      name, description, color,
      departmentId, vendorId, taxClass, ageRequired,
      ebtEligible, discountEligible, taxable,
      depositRuleId, containerType, containerVolumeOz,
      size, sizeUnit, pack, casePacks, sellUnitSize,
      defaultCostPrice, defaultRetailPrice, defaultCasePrice,
      salePrice, saleStart, saleEnd,
      autoSync, active,
    } = req.body;

    const oldRetailPrice = Number(existing.defaultRetailPrice) || null;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (color !== undefined) updateData.color = color;
    if (departmentId !== undefined) updateData.departmentId = departmentId ? parseInt(departmentId) : null;
    if (vendorId !== undefined) updateData.vendorId = vendorId ? parseInt(vendorId) : null;
    if (taxClass !== undefined) updateData.taxClass = taxClass;
    if (ageRequired !== undefined) updateData.ageRequired = ageRequired ? parseInt(ageRequired) : null;
    if (ebtEligible !== undefined) updateData.ebtEligible = ebtEligible;
    if (discountEligible !== undefined) updateData.discountEligible = discountEligible;
    if (taxable !== undefined) updateData.taxable = taxable;
    if (depositRuleId !== undefined) updateData.depositRuleId = depositRuleId ? parseInt(depositRuleId) : null;
    if (containerType !== undefined) updateData.containerType = containerType;
    if (containerVolumeOz !== undefined) updateData.containerVolumeOz = containerVolumeOz != null ? parseFloat(containerVolumeOz) : null;
    if (size !== undefined) updateData.size = size;
    if (sizeUnit !== undefined) updateData.sizeUnit = sizeUnit;
    if (pack !== undefined) updateData.pack = pack ? parseInt(pack) : null;
    if (casePacks !== undefined) updateData.casePacks = casePacks ? parseInt(casePacks) : null;
    if (sellUnitSize !== undefined) updateData.sellUnitSize = sellUnitSize ? parseInt(sellUnitSize) : null;
    if (defaultCostPrice !== undefined) updateData.defaultCostPrice = defaultCostPrice != null ? parseFloat(defaultCostPrice) : null;
    if (defaultRetailPrice !== undefined) updateData.defaultRetailPrice = defaultRetailPrice != null ? parseFloat(defaultRetailPrice) : null;
    if (defaultCasePrice !== undefined) updateData.defaultCasePrice = defaultCasePrice != null ? parseFloat(defaultCasePrice) : null;
    if (salePrice !== undefined) updateData.salePrice = salePrice != null ? parseFloat(salePrice) : null;
    if (saleStart !== undefined) updateData.saleStart = saleStart ? new Date(saleStart) : null;
    if (saleEnd !== undefined) updateData.saleEnd = saleEnd ? new Date(saleEnd) : null;
    if (autoSync !== undefined) updateData.autoSync = autoSync;
    if (active !== undefined) updateData.active = active;

    const group = await prisma.productGroup.update({ where: { id }, data: updateData });

    // Cascade to members if autoSync is on
    let cascaded = 0;
    if (group.autoSync) {
      cascaded = await cascadeToMembers(orgId, group, oldRetailPrice);
    }

    res.json({ success: true, data: group, cascaded });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── DELETE /api/catalog/groups/:id ───────────────────────────────────────────
export const deleteProductGroup = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const existing = await prisma.productGroup.findFirst({ where: { id, orgId } });
    if (!existing) return res.status(404).json({ success: false, error: 'Group not found' });

    // Unlink all products first (set productGroupId to null)
    await prisma.masterProduct.updateMany({
      where: { productGroupId: id },
      data: { productGroupId: null },
    });

    await prisma.productGroup.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── POST /api/catalog/groups/:id/apply ───────────────────────────────────────
// Manually push template fields to all member products
export const applyGroupTemplate = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);

    const group = await prisma.productGroup.findFirst({ where: { id, orgId } });
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });

    const updated = await cascadeToMembers(orgId, group, null);
    res.json({ success: true, updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── POST /api/catalog/groups/:id/add-products ────────────────────────────────
// Add products to a group and auto-fill template fields
export const addProductsToGroup = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id);
    const { productIds, applyTemplate = true } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ success: false, error: 'productIds array required' });
    }

    const group = await prisma.productGroup.findFirst({ where: { id, orgId } });
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });

    // Build update data — only non-null template fields
    const update = { productGroupId: id };
    if (applyTemplate) {
      for (const field of CASCADE_FIELDS) {
        if (group[field] !== null && group[field] !== undefined) {
          update[field] = group[field];
        }
      }
    }

    const result = await prisma.masterProduct.updateMany({
      where: {
        id: { in: productIds.map(pid => parseInt(pid)) },
        orgId,
      },
      data: update,
    });

    res.json({ success: true, added: result.count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── POST /api/catalog/groups/:id/remove-products ─────────────────────────────
export const removeProductsFromGroup = async (req, res) => {
  try {
    const orgId = getOrgId(req);
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ success: false, error: 'productIds array required' });
    }

    const result = await prisma.masterProduct.updateMany({
      where: {
        id: { in: productIds.map(pid => parseInt(pid)) },
        orgId,
      },
      data: { productGroupId: null },
    });

    res.json({ success: true, removed: result.count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── Internal helper: cascade group template to members ──────────────────────
async function cascadeToMembers(orgId, group, oldRetailPrice) {
  // Fetch member products before update (for price change detection)
  const members = await prisma.masterProduct.findMany({
    where: { orgId, productGroupId: group.id },
    select: { id: true, defaultRetailPrice: true },
  });

  if (members.length === 0) return 0;

  const update = {};
  for (const field of CASCADE_FIELDS) {
    if (group[field] !== null && group[field] !== undefined) {
      update[field] = group[field];
    }
  }

  if (Object.keys(update).length === 0) return 0;

  const result = await prisma.masterProduct.updateMany({
    where: { orgId, productGroupId: group.id },
    data: update,
  });

  // Queue label reprints for price changes
  if (update.defaultRetailPrice !== undefined) {
    try {
      for (const m of members) {
        const oldPrice = Number(m.defaultRetailPrice) || null;
        const newPrice = Number(group.defaultRetailPrice) || null;
        if (oldPrice !== newPrice) {
          await queueLabelForPriceChange(orgId, null, m.id, oldPrice, newPrice);
        }
      }
    } catch (err) {
      console.warn('[ProductGroup] Label queue failed:', err.message);
    }
  }

  return result.count;
}
