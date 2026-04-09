/**
 * Public storefront API routes — no auth required.
 * All scoped by store slug.
 */

import { Router } from 'express';
import { resolveStoreBySlug } from '../middleware/storeResolver.js';
import {
  getStoreInfo,
  listProducts,
  getProduct,
  listDepartments,
  listPages,
  getPage,
} from '../controllers/storefrontController.js';
import {
  getCart,
  createOrUpdateCart,
  checkout,
} from '../controllers/orderController.js';

const router = Router();

// Resolve store by custom domain (used by Next.js SSR)
router.get('/store-by-domain', async (req, res) => {
  const { domain } = req.query;
  if (!domain) return res.status(400).json({ error: 'domain query param required' });
  const { default: prisma } = await import('../config/postgres.js');
  const store = await prisma.ecomStore.findUnique({
    where: { customDomain: domain },
    select: { slug: true, storeId: true, storeName: true, enabled: true },
  });
  if (!store || !store.enabled) return res.status(404).json({ error: 'Store not found' });
  res.json({ success: true, data: store });
});

// Store directory — list all enabled stores (for discovery page)
router.get('/stores', async (req, res) => {
  const { default: prisma } = await import('../config/postgres.js');
  const { search } = req.query;
  const where = { enabled: true };
  if (search) where.storeName = { contains: search, mode: 'insensitive' };
  const stores = await prisma.ecomStore.findMany({
    where,
    select: { storeName: true, slug: true, branding: true, seoDefaults: true, fulfillmentConfig: true },
    orderBy: { storeName: 'asc' },
  });
  res.json({ success: true, data: stores });
});

// Store info
router.get('/store/:slug', resolveStoreBySlug, getStoreInfo);

// Products
router.get('/store/:slug/products', resolveStoreBySlug, listProducts);
router.get('/store/:slug/products/:productSlug', resolveStoreBySlug, getProduct);

// Departments
router.get('/store/:slug/departments', resolveStoreBySlug, listDepartments);

// CMS Pages
router.get('/store/:slug/pages', resolveStoreBySlug, listPages);
router.get('/store/:slug/pages/:pageSlug', resolveStoreBySlug, getPage);

// Cart
router.get('/store/:slug/cart/:sessionId', resolveStoreBySlug, getCart);
router.put('/store/:slug/cart', resolveStoreBySlug, createOrUpdateCart);

// Checkout
router.post('/store/:slug/checkout', resolveStoreBySlug, checkout);

// Public order lookup (by ID + email verification for order confirmation page)
router.get('/store/:slug/order/:orderId', resolveStoreBySlug, async (req, res) => {
  const { default: prisma } = await import('../config/postgres.js');
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email query param required' });
  const order = await prisma.ecomOrder.findUnique({ where: { id: req.params.orderId } });
  if (!order || order.storeId !== req.storeId || order.customerEmail.toLowerCase() !== email.toLowerCase()) {
    return res.status(404).json({ error: 'Order not found' });
  }
  res.json({ success: true, data: order });
});

// Contact form submission + email notification
router.post('/store/:slug/contact', resolveStoreBySlug, async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required' });
    }

    console.log(`[contact-form] Store ${req.ecomStore.slug}: ${name} <${email}>`);

    // Send email notifications (non-blocking)
    import('../services/emailService.js').then(({ sendContactFormEmail }) => {
      sendContactFormEmail(req.ecomStore.storeName, null, { name, email, phone, message });
    }).catch(() => {});

    res.json({ success: true, message: 'Message received' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
