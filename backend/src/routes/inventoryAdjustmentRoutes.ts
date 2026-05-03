/**
 * Inventory Adjustment Routes — /api/inventory/adjustments
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  createAdjustment,
  listAdjustments,
  getAdjustmentSummary,
} from '../controllers/inventoryAdjustmentController.js';

const router = Router();

router.use(protect);
router.use(scopeToTenant);

router.get('/summary', requirePermission('inventory.view'), getAdjustmentSummary);
router.get('/',        requirePermission('inventory.view'), listAdjustments);
router.post('/',       requirePermission('inventory.edit'), createAdjustment);

export default router;
