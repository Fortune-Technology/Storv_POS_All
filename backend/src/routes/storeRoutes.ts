/**
 * Store routes  —  /api/stores
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  createStore,
  getStores,
  getStoreById,
  updateStore,
  deactivateStore,
  getBillingSummary,
  getStoreBranding,
  updateStoreBranding,
  getFeatureModules,
  updateFeatureModules,
} from '../controllers/storeController.js';
import { setStoreState, applyStateDefaults } from '../controllers/stateController.js';

const router = Router();

router.use(protect); // sets req.user + req.tenantId via scopeToTenant

router.get('/billing-summary', requirePermission('billing.view', 'stores.view'), getBillingSummary);

router.route('/')
  .get(requirePermission('stores.view'),   getStores)
  .post(requirePermission('stores.create'), createStore);

router.route('/:id')
  .get(requirePermission('stores.view'),   getStoreById)
  .put(requirePermission('stores.edit'),   updateStore)
  .delete(requirePermission('stores.delete'), deactivateStore);

router.route('/:id/branding')
  .get(requirePermission('stores.view'),  getStoreBranding)
  .put(requirePermission('stores.edit'),  updateStoreBranding);

// S80 — per-store module on/off overrides
router.route('/:id/feature-modules')
  .get(requirePermission('stores.view'),  getFeatureModules)
  .put(requirePermission('stores.edit'),  updateFeatureModules);

// State assignment + default-apply (Store Settings UI)
router.put ('/:id/state',                  requirePermission('stores.edit'), setStoreState);
router.post('/:id/apply-state-defaults',   requirePermission('stores.edit'), applyStateDefaults);

export default router;
