/**
 * Integration Routes — /api/integrations
 *
 * Protected routes for managing platform integrations, inventory sync,
 * platform orders, and analytics.
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  listPlatforms,
  connectPlatform,
  disconnectPlatform,
  getSettings,
  updateSettings,
  syncInventory,
  listOrders,
  getOrder,
  confirmOrder,
  markReady,
  cancelOrder,
  getAnalytics,
} from '../controllers/integrationController.js';

const router = Router();

router.use(protect);
router.use(scopeToTenant);

// Platform management
router.get('/platforms',            listPlatforms);
router.post('/connect',             connectPlatform);
router.delete('/disconnect',        disconnectPlatform);
router.get('/settings/:platform',   getSettings);
router.put('/settings/:platform',   updateSettings);

// Inventory
router.post('/sync-inventory',      syncInventory);

// Orders
router.get('/orders',               listOrders);
router.get('/orders/:id',           getOrder);
router.put('/orders/:id/confirm',   confirmOrder);
router.put('/orders/:id/ready',     markReady);
router.put('/orders/:id/cancel',    cancelOrder);

// Analytics
router.get('/analytics',            getAnalytics);

export default router;
