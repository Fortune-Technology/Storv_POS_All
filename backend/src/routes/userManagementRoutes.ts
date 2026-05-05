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
import {
  getMyPin as getMyImplementationPin,
  rotateMyPin as rotateMyImplementationPin,
} from '../controllers/implementationPinController.js';

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

// S78 — Self-service Implementation Engineer PIN (handler checks
// `canConfigureHardware` flag; no permission gate at the route level so
// users can fetch / rotate their own PIN without an extra grant).
router.get ('/me/implementation-pin',         getMyImplementationPin);
router.post('/me/implementation-pin/rotate',  rotateMyImplementationPin);

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
