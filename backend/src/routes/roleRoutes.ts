import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  listPermissions, listRoles, getRole, createRole, updateRole, deleteRole,
  getUserRoles, setUserRoles, getMyPermissions,
} from '../controllers/roleController.js';

const router = express.Router();

// Everything requires auth
router.use(protect);

// Current user's own effective permissions (for frontend refresh)
router.get('/me/permissions', getMyPermissions);

// Permission catalog — any authenticated user can list (so portals can render UIs)
router.get('/permissions', listPermissions);

// Role CRUD — org scope by default. Use ?scope=admin on the admin-app.
// Read: managers+ (so UI can render filter checkboxes, see existing roles)
// Write: owners/admins only (superadmin for admin-scope)
const readGuard  = authorize('superadmin', 'admin', 'owner', 'manager');
const writeGuard = authorize('superadmin', 'admin', 'owner');

router.get(   '/',       readGuard,  listRoles);
router.get(   '/:id',    readGuard,  getRole);
router.post(  '/',       writeGuard, createRole);
router.put(   '/:id',    writeGuard, updateRole);
router.delete('/:id',    writeGuard, deleteRole);

// User role assignment
router.get(   '/users/:userId/roles', readGuard,  getUserRoles);
router.put(   '/users/:userId/roles', writeGuard, setUserRoles);

export default router;
