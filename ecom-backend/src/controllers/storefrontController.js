/**
 * Public storefront controller — no auth required.
 * All endpoints scoped by store slug (resolved by storeResolver middleware).
 */

import prisma from '../config/postgres.js';
import { getCachedInventory } from '../config/redis.js';

/* ── Helpers ────────────────────────────────────────────────────────────── */

const paginationParams = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 24));
  return { skip: (page - 1) * limit, take: limit, page, limit };
};

/* ── Store Info ──────────────────────────────────────────────────────────── */

export const getStoreInfo = async (req, res) => {
  try {
    res.json({ success: true, data: req.ecomStore });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Products ───────────────────────────────────────────────────────────── */

export const listProducts = async (req, res) => {
  try {
    const { skip, take, page, limit } = paginationParams(req.query);
    const { department, search, tag, sort } = req.query;

    const where = {
      storeId: req.storeId,
      visible: true,
      inStock: req.query.inStock === 'false' ? undefined : true,
    };

    if (department) where.departmentSlug = department;
    if (tag) where.tags = { has: tag };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { tags: { has: search.toLowerCase() } },
      ];
    }

    // Sort
    let orderBy = [{ sortOrder: 'asc' }, { name: 'asc' }];
    if (sort === 'price_asc') orderBy = [{ retailPrice: 'asc' }];
    else if (sort === 'price_desc') orderBy = [{ retailPrice: 'desc' }];
    else if (sort === 'name') orderBy = [{ name: 'asc' }];
    else if (sort === 'newest') orderBy = [{ createdAt: 'desc' }];

    const [products, total] = await Promise.all([
      prisma.ecomProduct.findMany({
        where,
        orderBy,
        skip,
        take,
        select: {
          id: true,
          slug: true,
          name: true,
          brand: true,
          imageUrl: true,
          retailPrice: true,
          salePrice: true,
          saleStart: true,
          saleEnd: true,
          inStock: true,
          departmentName: true,
          departmentSlug: true,
          tags: true,
          size: true,
          ageRequired: true,
        },
      }),
      prisma.ecomProduct.count({ where }),
    ]);

    res.json({
      success: true,
      data: products,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getProduct = async (req, res) => {
  try {
    const product = await prisma.ecomProduct.findUnique({
      where: {
        storeId_slug: {
          storeId: req.storeId,
          slug: req.params.productSlug,
        },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        shortDescription: true,
        brand: true,
        imageUrl: true,
        images: true,
        retailPrice: true,
        salePrice: true,
        saleStart: true,
        saleEnd: true,
        inStock: true,
        quantityOnHand: true,
        trackInventory: true,
        taxable: true,
        ebtEligible: true,
        ageRequired: true,
        size: true,
        weight: true,
        departmentName: true,
        departmentSlug: true,
        tags: true,
        posProductId: true,
      },
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Overlay real-time inventory from Redis if available
    const cached = await getCachedInventory(req.storeId, product.posProductId);
    if (cached) {
      product.quantityOnHand = cached.qty;
      product.inStock = cached.inStock;
    }

    res.json({ success: true, data: product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Departments ────────────────────────────────────────────────────────── */

export const listDepartments = async (req, res) => {
  try {
    const departments = await prisma.ecomDepartment.findMany({
      where: { storeId: req.storeId, visible: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        imageUrl: true,
      },
    });

    res.json({ success: true, data: departments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── CMS Pages ──────────────────────────────────────────────────────────── */

export const listPages = async (req, res) => {
  try {
    const pages = await prisma.ecomPage.findMany({
      where: { storeId: req.storeId, published: true },
      orderBy: [{ sortOrder: 'asc' }],
      select: {
        slug: true,
        title: true,
        pageType: true,
        seoTitle: true,
        seoDescription: true,
      },
    });

    res.json({ success: true, data: pages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getPage = async (req, res) => {
  try {
    const page = await prisma.ecomPage.findUnique({
      where: {
        storeId_slug: {
          storeId: req.storeId,
          slug: req.params.pageSlug,
        },
      },
    });

    if (!page || !page.published) {
      return res.status(404).json({ error: 'Page not found' });
    }

    res.json({ success: true, data: page });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
