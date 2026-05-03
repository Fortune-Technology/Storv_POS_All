/**
 * Customer Routes — /api/customers
 *
 * Permission tiers:
 *   customers.view   — all authenticated roles incl. cashier
 *   customers.create — cashier+ (for POS customer quick-add)
 *   customers.edit   — manager+
 *   customers.delete — manager+ (soft delete)
 */

import express from 'express';
import { protect } from '../middleware/auth.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  checkPoints,
} from '../controllers/customerController.js';

const router = express.Router();
router.use(protect);

// Read
router.get('/',            requirePermission('customers.view'),   getCustomers);
router.get('/:id',         requirePermission('customers.view'),   getCustomerById);

// Write
router.post('/',           requirePermission('customers.create'), createCustomer);
router.put('/:id',         requirePermission('customers.edit'),   updateCustomer);
router.delete('/:id',      requirePermission('customers.delete'), deleteCustomer);

// Loyalty points phone-lookup (same as view — never allow anonymous)
router.post('/check-points', requirePermission('customers.view'), checkPoints);

export default router;
