/**
 * Billing Routes — /api/billing
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  getPublicPlans,
  getMySubscription,
  getMyInvoices,
  savePaymentMethod,
  listMyStoreSubscriptions,
  updateStoreSubscription,
  listMyStoreInvoices,
} from '../controllers/billingController.js';

const router = Router();

// Public — no auth required
router.get('/plans', getPublicPlans);

// Protected — org users only
router.use(protect);
router.get('/subscription',    requirePermission('billing.view'), getMySubscription);
router.get('/invoices',        requirePermission('billing.view'), getMyInvoices);
router.post('/payment-method', requirePermission('billing.edit'), savePaymentMethod);

// S80 Phase 3 — per-store subscriptions
router.get('/store-subscriptions',          requirePermission('billing.view'), listMyStoreSubscriptions);
router.put('/store-subscriptions/:storeId', requirePermission('billing.edit'), updateStoreSubscription);
router.get('/store-invoices',               requirePermission('billing.view'), listMyStoreInvoices);

export default router;
