/**
 * Billing Routes — /api/billing
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
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
router.get('/subscription',    getMySubscription);
router.get('/invoices',        getMyInvoices);
router.post('/payment-method', savePaymentMethod);

export default router;
