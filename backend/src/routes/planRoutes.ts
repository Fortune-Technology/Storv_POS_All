/**
 * S78 — Plan & Module routes
 *
 * Vendor-facing entitlement: /api/plans/me/modules (any authenticated user).
 * Admin contracts/modules CRUD lives under /api/admin/plans + /api/admin/modules.
 */
import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  getMyModules,
  getPublicPlans,
  adminListPlans, adminGetPlan, adminCreatePlan, adminUpdatePlan, adminDeletePlan,
  adminListModules, adminCreateModule, adminUpdateModule, adminDeleteModule,
} from '../controllers/planController.js';

// ── User entitlement (auth required, gate-tolerant for `pending` users) ──
const userPlanRoutes = express.Router();
userPlanRoutes.get('/me/modules', protect, getMyModules);
// ── Public catalog for the marketing /pricing page (no auth) ──
userPlanRoutes.get('/public',     getPublicPlans);

// ── Admin Plan CRUD ──
const adminPlanRoutes = express.Router();
adminPlanRoutes.get   ('/',     protect, adminListPlans);
adminPlanRoutes.get   ('/:id',  protect, adminGetPlan);
adminPlanRoutes.post  ('/',     protect, adminCreatePlan);
adminPlanRoutes.patch ('/:id',  protect, adminUpdatePlan);
adminPlanRoutes.delete('/:id',  protect, adminDeletePlan);

// ── Admin Module CRUD ──
const adminModuleRoutes = express.Router();
adminModuleRoutes.get   ('/',     protect, adminListModules);
adminModuleRoutes.post  ('/',     protect, adminCreateModule);
adminModuleRoutes.patch ('/:id',  protect, adminUpdateModule);
adminModuleRoutes.delete('/:id',  protect, adminDeleteModule);

export { userPlanRoutes, adminPlanRoutes, adminModuleRoutes };
