/**
 * Vendor Return Routes — /api/vendor-returns
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
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

router.get('/',           listVendorReturns);
router.get('/:id',        getVendorReturn);
router.post('/',          createVendorReturn);
router.post('/:id/submit', submitVendorReturn);
router.post('/:id/credit', recordVendorCredit);
router.post('/:id/close',  closeVendorReturn);
router.delete('/:id',      deleteVendorReturn);

export default router;
