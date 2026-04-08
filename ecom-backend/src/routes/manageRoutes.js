/**
 * Portal management API routes — authenticated via POS JWT.
 * Used by the portal frontend to manage the online store.
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  getEcomStore,
  enableEcomStore,
  disableEcomStore,
  updateEcomStore,
} from '../controllers/ecomStoreController.js';
import {
  listManagedProducts,
  updateProductVisibility,
  updateProductEcomFields,
  bulkUpdateVisibility,
} from '../controllers/productManageController.js';
import {
  listOrders,
  getOrder,
  updateOrderStatus,
} from '../controllers/orderController.js';
import {
  listPages,
  getPage,
  createPage,
  updatePage,
  deletePage,
} from '../controllers/pageController.js';
import { getSyncStatus } from '../controllers/syncController.js';
import { getDomainStatus, setCustomDomain, verifyDomain, removeCustomDomain } from '../controllers/domainController.js';

const router = Router();
const auth = [protect, authorize('owner', 'admin', 'manager', 'superadmin')];
const writeAuth = [protect, authorize('owner', 'admin', 'superadmin')];

// ── Store Setup ─────────────────────────────────────────────────────────
router.get('/ecom-store', auth, getEcomStore);
router.put('/ecom-store', writeAuth, updateEcomStore);
router.post('/ecom-store/enable', writeAuth, enableEcomStore);
router.post('/ecom-store/disable', writeAuth, disableEcomStore);

// ── Product Management ──────────────────────────────────────────────────
router.get('/products', auth, listManagedProducts);
router.put('/products/:id/visibility', writeAuth, updateProductVisibility);
router.put('/products/:id', writeAuth, updateProductEcomFields);
router.post('/products/bulk-visibility', writeAuth, bulkUpdateVisibility);

// ── Orders ──────────────────────────────────────────────────────────────
router.get('/orders', auth, listOrders);
router.get('/orders/:id', auth, getOrder);
router.put('/orders/:id/status', auth, updateOrderStatus);

// ── Pages / Website Builder ─────────────────────────────────────────────
router.get('/pages', auth, listPages);
router.get('/pages/:id', auth, getPage);
router.post('/pages', writeAuth, createPage);
router.put('/pages/:id', writeAuth, updatePage);
router.delete('/pages/:id', writeAuth, deletePage);

// ── Custom Domain ───────────────────────────────────────────────────────
router.get('/domain/status', auth, getDomainStatus);
router.post('/domain', writeAuth, setCustomDomain);
router.post('/domain/verify', writeAuth, verifyDomain);
router.delete('/domain', writeAuth, removeCustomDomain);

// ── Sync Status ─────────────────────────────────────────────────────────
router.get('/sync/status', auth, getSyncStatus);

export default router;
