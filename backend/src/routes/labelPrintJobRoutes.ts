/**
 * Label Print Job Routes — /api/label-print-jobs
 *
 * Portal-side endpoints (JWT-authenticated, tenant-scoped):
 *   POST   /               — submit ZPL for routed printing
 *   GET    /               — list recent jobs
 *   GET    /:id            — get one job's status
 *   POST   /:id/retry      — retry a failed job
 *   DELETE /cleanup?days=7 — prune old completed/failed
 *
 * Station-side endpoints (JWT or station token, tenant-scoped):
 *   POST   /claim          — atomically claim up to N pending jobs
 *   POST   /:id/complete   — report success/failure
 */

import express from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  submitPrintJob,
  claimPrintJobs,
  completePrintJob,
  listRecentPrintJobs,
  getPrintJobStatus,
  retryPrintJob,
  cleanupPrintJobs,
} from '../controllers/labelPrintJobController.js';

const router = express.Router();

router.use(protect);
router.use(scopeToTenant);

// ── Portal-side (tenant users) ──────────────────────────────────────────
// Reusing pos_config.* perms — label printing is part of POS device config
router.get('/',          requirePermission('pos_config.view'), listRecentPrintJobs);
router.post('/',         requirePermission('pos_config.view'), submitPrintJob);
router.get('/:id',       requirePermission('pos_config.view'), getPrintJobStatus);
router.post('/:id/retry',requirePermission('pos_config.view'), retryPrintJob);
router.delete('/cleanup',requirePermission('pos_config.edit'), cleanupPrintJobs);

// ── Station-side (any authenticated user at the register) ───────────────
// Stations poll + complete; they're authenticated via the JWT we issue on
// PIN login, scoped to orgId + storeId via the tenant middleware. The
// `stationId` must be passed in the request body (read from the cashier-app's
// persisted station config).
router.post('/claim',          claimPrintJobs);
router.post('/:id/complete',   completePrintJob);

export default router;
