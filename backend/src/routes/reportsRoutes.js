/**
 * Reports Routes — /api/reports
 * Back-office reporting endpoints (require manager/admin).
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { requireTenant } from '../middleware/scopeToTenant.js';
import { getEmployeeReport } from '../controllers/employeeReportsController.js';

const router = Router();

const guard = [protect, requireTenant, authorize('manager', 'owner', 'admin', 'superadmin')];

router.get('/employees', ...guard, getEmployeeReport);

export default router;
