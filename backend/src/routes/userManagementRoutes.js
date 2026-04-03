/**
 * User management routes  —  /api/users
 * Requires: protect (auth) + admin or above role
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { requireTenant } from '../middleware/scopeToTenant.js';
import {
  getTenantUsers,
  inviteUser,
  updateUserRole,
  removeUser,
} from '../controllers/userManagementController.js';
import { setCashierPin, removeCashierPin } from '../controllers/stationController.js';

const router = Router();

router.use(protect);

// List all users in tenant (any authenticated member can view)
router.get('/', getTenantUsers);

// Invite / manage — admin and above only
router.post('/invite', authorize('superadmin', 'admin', 'manager'), inviteUser);
router.put('/:id/role',  authorize('superadmin', 'admin'), updateUserRole);
router.delete('/:id',    authorize('superadmin', 'admin'), removeUser);

// POS PIN management — manager and above only
router.route('/:id/pin')
  .put(protect, authorize('manager', 'owner', 'admin', 'superadmin'), requireTenant, setCashierPin)
  .delete(protect, authorize('manager', 'owner', 'admin', 'superadmin'), requireTenant, removeCashierPin);

export default router;
