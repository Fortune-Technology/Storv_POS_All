/**
 * CMS page controller — CRUD for website builder pages.
 */

import prisma from '../config/postgres.js';

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export const listPages = async (req, res) => {
  try {
    const pages = await prisma.ecomPage.findMany({
      where: { storeId: req.storeId },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });

    res.json({ success: true, data: pages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getPage = async (req, res) => {
  try {
    const page = await prisma.ecomPage.findUnique({
      where: { id: req.params.id },
    });

    if (!page || page.storeId !== req.storeId) {
      return res.status(404).json({ error: 'Page not found' });
    }

    res.json({ success: true, data: page });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createPage = async (req, res) => {
  try {
    const { title, pageType, templateId, content, seoTitle, seoDescription, published } = req.body;

    if (!title || !pageType) {
      return res.status(400).json({ error: 'title and pageType are required' });
    }

    const slug = slugify(title);

    const page = await prisma.ecomPage.create({
      data: {
        orgId: req.orgId,
        storeId: req.storeId,
        slug,
        title,
        pageType,
        templateId: templateId || null,
        content: content || {},
        seoTitle: seoTitle || null,
        seoDescription: seoDescription || null,
        published: published ?? false,
      },
    });

    res.status(201).json({ success: true, data: page });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A page with this slug already exists for this store' });
    }
    res.status(500).json({ error: err.message });
  }
};

export const updatePage = async (req, res) => {
  try {
    const { title, content, templateId, seoTitle, seoDescription, published, sortOrder } = req.body;

    const data = {};
    if (title !== undefined) {
      data.title = title;
      data.slug = slugify(title);
    }
    if (content !== undefined) data.content = content;
    if (templateId !== undefined) data.templateId = templateId;
    if (seoTitle !== undefined) data.seoTitle = seoTitle;
    if (seoDescription !== undefined) data.seoDescription = seoDescription;
    if (published !== undefined) data.published = published;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;

    const page = await prisma.ecomPage.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ success: true, data: page });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deletePage = async (req, res) => {
  try {
    await prisma.ecomPage.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
