/**
 * Vendor Return Routes — /api/vendor-returns
 *
 * Role tiers:
 *   Read   — manager and above (vendor return data is operational/sensitive)
 *   Write  — manager and above
 *   Delete — owner and above
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requirePermission } from '../rbac/permissionService.js';
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

const readRoles  = requirePermission('vendors.view');
const writeRoles = requirePermission('vendors.edit');
const ownerRoles = requirePermission('vendor_payouts.edit');

router.get('/',            readRoles,  listVendorReturns);
router.get('/:id',         readRoles,  getVendorReturn);
router.post('/',           writeRoles, createVendorReturn);
router.post('/:id/submit', writeRoles, submitVendorReturn);
router.post('/:id/credit', ownerRoles, recordVendorCredit);
router.post('/:id/close',  writeRoles, closeVendorReturn);
router.delete('/:id',      ownerRoles, deleteVendorReturn);

export default router;
