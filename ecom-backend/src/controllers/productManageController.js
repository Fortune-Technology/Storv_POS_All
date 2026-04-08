/**
 * Product management controller — portal-side.
 * Toggle visibility, edit ecom-specific fields (descriptions, images, tags).
 */

import prisma from '../config/postgres.js';

const paginationParams = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit) || 50));
  return { skip: (page - 1) * limit, take: limit, page, limit };
};

export const listManagedProducts = async (req, res) => {
  try {
    const { skip, take, page, limit } = paginationParams(req.query);
    const { search, department, visible } = req.query;

    const where = { storeId: req.storeId };
    if (visible === 'true') where.visible = true;
    if (visible === 'false') where.visible = false;
    if (department) where.departmentSlug = department;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      prisma.ecomProduct.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip,
        take,
        select: {
          id: true,
          posProductId: true,
          slug: true,
          name: true,
          brand: true,
          imageUrl: true,
          retailPrice: true,
          inStock: true,
          visible: true,
          departmentName: true,
          lastSyncedAt: true,
        },
      }),
      prisma.ecomProduct.count({ where }),
    ]);

    res.json({ success: true, data: products, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateProductVisibility = async (req, res) => {
  try {
    const { visible } = req.body;
    if (typeof visible !== 'boolean') {
      return res.status(400).json({ error: 'visible (boolean) is required' });
    }

    const product = await prisma.ecomProduct.update({
      where: { id: req.params.id },
      data: { visible },
    });

    res.json({ success: true, data: product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateProductEcomFields = async (req, res) => {
  try {
    const { description, shortDescription, images, tags, sortOrder } = req.body;

    const data = {};
    if (description !== undefined) data.description = description;
    if (shortDescription !== undefined) data.shortDescription = shortDescription;
    if (images !== undefined) data.images = images;
    if (tags !== undefined) data.tags = tags;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;

    const product = await prisma.ecomProduct.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ success: true, data: product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const bulkUpdateVisibility = async (req, res) => {
  try {
    const { productIds, visible } = req.body;
    if (!Array.isArray(productIds) || typeof visible !== 'boolean') {
      return res.status(400).json({ error: 'productIds (array) and visible (boolean) required' });
    }

    const result = await prisma.ecomProduct.updateMany({
      where: { id: { in: productIds }, storeId: req.storeId },
      data: { visible },
    });

    res.json({ success: true, updated: result.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
