/**
 * Customer Routes — /api/customers
 *
 * Role tiers (matching catalogRoutes.js convention):
 *   Read   — all authenticated roles incl. cashier (for POS customer search)
 *   Write  — manager and above
 *   Delete — owner and above
 */

import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  checkPoints,
} from '../controllers/customerController.js';

const router = express.Router();

// All routes require a valid JWT (protect also calls scopeToTenant → req.orgId)
router.use(protect);

// ── Read (cashier-accessible) ─────────────────────────────────────────────────
router.get(
  '/',
  authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'),
  getCustomers,
);

router.get(
  '/:id',
  authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'),
  getCustomerById,
);

// ── Write (manager and above) ─────────────────────────────────────────────────
router.post(
  '/',
  authorize('superadmin', 'admin', 'owner', 'manager', 'cashier'),
  createCustomer,
);

router.put(
  '/:id',
  authorize('superadmin', 'admin', 'owner', 'manager'),
  updateCustomer,
);

// ── Soft-delete (owner and above) ─────────────────────────────────────────────
router.delete(
  '/:id',
  authorize('superadmin', 'admin', 'owner', 'manager'),
  deleteCustomer,
);

// ── Loyalty points phone-lookup (cashier+ only — prevents customer enumeration) ──
router.post(
  '/check-points',
  authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'),
  checkPoints,
);

export default router;
