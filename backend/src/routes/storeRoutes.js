/**
 * Store routes  —  /api/stores
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  createStore,
  getStores,
  getStoreById,
  updateStore,
  deactivateStore,
  getBillingSummary,
  getStoreBranding,
  updateStoreBranding,
} from '../controllers/storeController.js';

const router = Router();

router.use(protect); // sets req.user + req.tenantId via scopeToTenant

router.get('/billing-summary', getBillingSummary);

router.route('/')
  .get(getStores)
  .post(createStore);

router.route('/:id')
  .get(getStoreById)
  .put(updateStore)
  .delete(deactivateStore);

router.route('/:id/branding')
  .get(getStoreBranding)
  .put(updateStoreBranding);

export default router;
