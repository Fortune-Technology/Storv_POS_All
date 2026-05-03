// Daily Sale reconciliation routes.
// Permissions re-use the existing reports keys — anyone with reports.view
// can see the snapshot; editing requires reports.manage.

import express from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  getDailySale,
  saveDailySale,
  closeDailySaleReport,
} from '../controllers/dailySaleController.js';

const router = express.Router();

router.use(protect);
router.use(scopeToTenant);

// Allow no date (defaults to today) AND explicit date in path
router.get('/',           requirePermission('reports.view'),   getDailySale);
router.get('/:date',      requirePermission('reports.view'),   getDailySale);
router.put('/:date',      requirePermission('reports.manage'), saveDailySale);
router.post('/:date/close', requirePermission('reports.manage'), closeDailySaleReport);

export default router;
