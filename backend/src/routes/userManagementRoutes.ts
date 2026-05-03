/**
 * User management routes  —  /api/users
 * Requires: protect (auth) + admin or above role
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { requireTenant } from '../middleware/scopeToTenant.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  getTenantUsers,
  inviteUser,
  updateUserRole,
  removeUser,
  getMe,
  updateMe,
  changeMyPassword,
} from '../controllers/userManagementController.js';
import {
  setCashierPin,
  removeCashierPin,
  listMyPins,
  setMyPin,
  removeMyPin,
} from '../controllers/stationController.js';

const router = Router();

router.use(protect);

// ── Self-service profile (any authenticated user, NO permission gate) ──
// Registered FIRST so `/me` doesn't get swallowed by the `/:id` routes.
// Email and role changes are NOT exposed — those flow through admin paths.
router.get('/me',          getMe);
router.put('/me',          updateMe);
router.put('/me/password', changeMyPassword);

// Self-service per-store PIN (also no permission gate — handler auth-checks)
router.get   ('/me/pins',               listMyPins);
router.put   ('/me/pin',                setMyPin);
router.delete('/me/pin/:storeId',       removeMyPin);

// List — users.view
router.get('/', requirePermission('users.view'), getTenantUsers);

// Invite / manage
router.post('/invite',   requirePermission('users.create'), inviteUser);
router.put('/:id/role',  requirePermission('users.edit'),   updateUserRole);
router.delete('/:id',    requirePermission('users.delete'), removeUser);

// Admin PIN management on other users — users.edit (manager+)
router.route('/:id/pin')
  .put(requirePermission('users.edit'), requireTenant, setCashierPin)
  .delete(requirePermission('users.edit'), requireTenant, removeCashierPin);

export default router;
