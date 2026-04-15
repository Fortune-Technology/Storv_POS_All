/**
 * Vendor Return Routes — /api/vendor-returns
 *
 * Role tiers:
 *   Read   — manager and above (vendor return data is operational/sensitive)
 *   Write  — manager and above
 *   Delete — owner and above
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  listVendorReturns,
  getVendorReturn,
  createVendorReturn,
  submitVendorReturn,
  recordVendorCredit,
  closeVendorReturn,
  deleteVendorReturn,
} from '../controllers/vendorReturnController.js';

const router = Router();

router.use(protect);
router.use(scopeToTenant);

const readRoles  = authorize('superadmin', 'admin', 'owner', 'manager');
const writeRoles = authorize('superadmin', 'admin', 'owner', 'manager');
const ownerRoles = authorize('superadmin', 'admin', 'owner');

router.get('/',            readRoles,  listVendorReturns);
router.get('/:id',         readRoles,  getVendorReturn);
router.post('/',           writeRoles, createVendorReturn);
router.post('/:id/submit', writeRoles, submitVendorReturn);
router.post('/:id/credit', ownerRoles, recordVendorCredit);
router.post('/:id/close',  writeRoles, closeVendorReturn);
router.delete('/:id',      ownerRoles, deleteVendorReturn);

export default router;
