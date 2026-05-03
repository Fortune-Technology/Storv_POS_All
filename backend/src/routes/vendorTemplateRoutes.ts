/**
 * vendorTemplateRoutes.js — Session 5
 * Superadmin curates templates; any authenticated user can READ to pick at upload time.
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  listVendorTemplates,
  getVendorTemplate,
  createVendorTemplate,
  updateVendorTemplate,
  deleteVendorTemplate,
  listTransforms,
  previewVendorTemplate,
} from '../controllers/vendorTemplateController.js';

const router = Router();

// Anyone authenticated can read templates + preview
router.get('/transforms',     protect, listTransforms);
router.get('/',               protect, listVendorTemplates);
router.get('/:id',            protect, getVendorTemplate);
router.post('/:id/preview',   protect, previewVendorTemplate);

// Only superadmin writes
router.post('/',              protect, authorize('superadmin'), createVendorTemplate);
router.put('/:id',            protect, authorize('superadmin'), updateVendorTemplate);
router.delete('/:id',         protect, authorize('superadmin'), deleteVendorTemplate);

export default router;
