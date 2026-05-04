/**
 * S77 Phase 2 — Contract routes
 *
 * Three routers exported:
 *   - `vendorContractRoutes` → mounted at /api/contracts (auth required, gate-tolerant for `pending` users)
 *   - `adminContractRoutes`  → mounted at /api/admin/contracts (superadmin only)
 *   - `adminTemplateRoutes`  → mounted at /api/admin/contract-templates (superadmin only)
 */
import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  // vendor
  vendorListMyContracts, vendorGetMyContract, vendorSignMyContract, vendorDownloadMyPdf,
  // admin contracts
  adminListContracts, adminGetContract, adminCreateContract, adminUpdateContract,
  adminSendContract, adminResendContract, adminCancelContract, adminActivateContract, adminDownloadPdf,
  // admin templates
  adminListTemplates, adminGetTemplate,
} from '../controllers/contractController.js';

// ── Vendor self-service ──────────────────────────────────────────────
const vendorContractRoutes = express.Router();
vendorContractRoutes.get   ('/me',                   protect, vendorListMyContracts);
vendorContractRoutes.get   ('/me/:id',               protect, vendorGetMyContract);
vendorContractRoutes.post  ('/me/:id/sign',          protect, vendorSignMyContract);
vendorContractRoutes.get   ('/me/:id/pdf',           protect, vendorDownloadMyPdf);

// ── Admin contracts ──────────────────────────────────────────────────
const adminContractRoutes = express.Router();
adminContractRoutes.get    ('/',                     protect, adminListContracts);
adminContractRoutes.get    ('/:id',                  protect, adminGetContract);
adminContractRoutes.post   ('/',                     protect, adminCreateContract);
adminContractRoutes.patch  ('/:id',                  protect, adminUpdateContract);
adminContractRoutes.post   ('/:id/send',             protect, adminSendContract);
adminContractRoutes.post   ('/:id/resend',           protect, adminResendContract);
adminContractRoutes.post   ('/:id/cancel',           protect, adminCancelContract);
adminContractRoutes.post   ('/:id/activate',         protect, adminActivateContract);
adminContractRoutes.get    ('/:id/pdf',              protect, adminDownloadPdf);

// ── Admin templates ──────────────────────────────────────────────────
const adminTemplateRoutes = express.Router();
adminTemplateRoutes.get    ('/',                     protect, adminListTemplates);
adminTemplateRoutes.get    ('/:id',                  protect, adminGetTemplate);

export { vendorContractRoutes, adminContractRoutes, adminTemplateRoutes };
