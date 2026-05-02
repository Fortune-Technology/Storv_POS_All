/**
 * Reports Hub Routes — /api/reports/hub/*
 *
 * Trimmed in S65 (B10) after the corresponding ReportsHub frontend page was
 * deleted in S64. The 5 dropped routes (summary / tax / events / receive /
 * house-accounts) had zero callers across portal, admin-app, cashier-app,
 * ecom-backend, and storefront — verified via grep.
 */
import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  getInventoryReport,
  getCompareReport,
  getNotesReport,
} from '../controllers/reportsHubController.js';

const router = Router();
router.use(protect);
router.use(scopeToTenant);
router.use(requirePermission('reports.view'));

router.get('/inventory', getInventoryReport);
router.get('/compare',   getCompareReport);
router.get('/notes',     getNotesReport);

export default router;
