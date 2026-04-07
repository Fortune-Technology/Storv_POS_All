/**
 * Reports Routes — /api/reports
 * Back-office reporting endpoints (require manager/admin).
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { requireTenant } from '../middleware/scopeToTenant.js';
import {
  getEmployeeReport,
  listClockEvents,
  listStoreEmployees,
  createClockSession,
  updateClockEvent,
  deleteClockEvent,
} from '../controllers/employeeReportsController.js';

const router = Router();

// manager+ can read reports; owner+ can create/edit/delete clock events
const readGuard  = [protect, requireTenant, authorize('manager', 'owner', 'admin', 'superadmin')];
const writeGuard = [protect, requireTenant, authorize('owner',   'admin', 'superadmin')];

// ── Employee summary report ───────────────────────────────────────────────
router.get('/employees',            ...readGuard,  getEmployeeReport);

// ── Employee list (for dropdowns) ────────────────────────────────────────
router.get('/employees/list',       ...readGuard,  listStoreEmployees);

// ── Raw clock event management (back-office manual entry) ─────────────────
router.get('/clock-events',         ...readGuard,  listClockEvents);
router.post('/clock-events',        ...writeGuard, createClockSession);
router.put('/clock-events/:id',     ...writeGuard, updateClockEvent);
router.delete('/clock-events/:id',  ...writeGuard, deleteClockEvent);

export default router;
