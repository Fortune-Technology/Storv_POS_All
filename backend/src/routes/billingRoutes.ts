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
} from '../controllers/billingController.js';

const router = Router();

// Public — no auth required
router.get('/plans', getPublicPlans);

// Protected — org users only
router.use(protect);
router.get('/subscription',    requirePermission('billing.view'), getMySubscription);
router.get('/invoices',        requirePermission('billing.view'), getMyInvoices);
router.post('/payment-method', requirePermission('billing.edit'), savePaymentMethod);

export default router;
