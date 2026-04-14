/**
 * Inventory Adjustment Routes — /api/inventory/adjustments
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  createAdjustment,
  listAdjustments,
  getAdjustmentSummary,
} from '../controllers/inventoryAdjustmentController.js';

const router = Router();

router.use(protect);
router.use(scopeToTenant);

router.get('/summary', getAdjustmentSummary);
router.get('/',        listAdjustments);
router.post('/',       createAdjustment);

export default router;
