/**
 * Scan Data + Coupon Routes  (Session 45 — foundation)
 *
 * Mounted under:
 *   /api/scan-data  → manufacturer catalog, enrollments, product mappings, submissions
 *   /api/coupons    → coupon catalog, CSV import, redemptions
 *
 * Permissions:
 *   scan_data.view       — manager+   (read enrollments / mappings / submissions)
 *   scan_data.enroll     — owner+     (create/update enrollments + SFTP creds)
 *   scan_data.configure  — manager+   (product mapping)
 *   scan_data.submit     — manager+   (manual resubmit — Session 47)
 *   coupons.view         — manager+   (catalog read)
 *   coupons.manage       — manager+   (catalog CRUD + import)
 *   coupons.redeem       — cashier+   (POS apply — Session 46)
 *   coupons.approve      — manager+   (high-value gate — Session 46)
 */

import express from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  listManufacturers,
  listEnrollments, getEnrollment, upsertEnrollment, updateEnrollmentStatus, deleteEnrollment,
  listProductMappings, upsertProductMapping, bulkUpsertProductMappings, deleteProductMapping,
  listTobaccoProducts,
  listSubmissions, getSubmissionStats,
  regenerateSubmission, downloadSubmission, testEnrollmentConnection,
  processSubmissionAck, getSubmissionAckLines,
  generateCertSampleFile, getEnrollmentCertChecklist, getCertPlaybook, getCertScenarios,
} from '../controllers/scanDataController.js';
import {
  listCoupons, getCoupon, createCoupon, updateCoupon, deleteCoupon,
  importCouponsCsv, listRedemptions, getRedemptionStats, validateCoupon,
} from '../controllers/couponController.js';

// ───────── Scan Data router ─────────
const scanDataRouter = express.Router();
scanDataRouter.use(protect);
scanDataRouter.use(scopeToTenant);

// Manufacturer catalog (read-only — managed via admin-app in Session 48)
scanDataRouter.get('/manufacturers', requirePermission('scan_data.view'), listManufacturers);

// Enrollments
scanDataRouter.get(   '/enrollments',         requirePermission('scan_data.view'),   listEnrollments);
scanDataRouter.get(   '/enrollments/:id',     requirePermission('scan_data.view'),   getEnrollment);
scanDataRouter.post(  '/enrollments',         requirePermission('scan_data.enroll'), upsertEnrollment);
scanDataRouter.put(   '/enrollments/:id/status', requirePermission('scan_data.enroll'), updateEnrollmentStatus);
scanDataRouter.delete('/enrollments/:id',     requirePermission('scan_data.enroll'), deleteEnrollment);

// Tobacco product mappings
scanDataRouter.get(   '/product-mappings',          requirePermission('scan_data.view'),      listProductMappings);
scanDataRouter.post(  '/product-mappings',          requirePermission('scan_data.configure'), upsertProductMapping);
scanDataRouter.post(  '/product-mappings/bulk',     requirePermission('scan_data.configure'), bulkUpsertProductMappings);
scanDataRouter.delete('/product-mappings/:id',      requirePermission('scan_data.configure'), deleteProductMapping);
scanDataRouter.get(   '/tobacco-products',          requirePermission('scan_data.view'),      listTobaccoProducts);

// Submissions
scanDataRouter.get('/submissions',                requirePermission('scan_data.view'),   listSubmissions);
scanDataRouter.get('/submissions/stats',          requirePermission('scan_data.view'),   getSubmissionStats);
scanDataRouter.post('/submissions/regenerate',    requirePermission('scan_data.submit'), regenerateSubmission);
scanDataRouter.get('/submissions/:id/download',   requirePermission('scan_data.view'),   downloadSubmission);
// Ack reconciliation (Session 48)
scanDataRouter.get('/submissions/:id/ack-lines',  requirePermission('scan_data.view'),   getSubmissionAckLines);
scanDataRouter.post('/submissions/:id/process-ack', requirePermission('scan_data.submit'), processSubmissionAck);

// SFTP smoke test for a single enrollment (cert-prep)
scanDataRouter.post('/enrollments/:id/test-connection', requirePermission('scan_data.enroll'), testEnrollmentConnection);

// Cert harness (Session 49)
scanDataRouter.post('/cert/sample-file',         requirePermission('scan_data.submit'), generateCertSampleFile);
scanDataRouter.get( '/cert/checklist',           requirePermission('scan_data.view'),   getEnrollmentCertChecklist);
scanDataRouter.get( '/cert/scenarios',           requirePermission('scan_data.view'),   getCertScenarios);
scanDataRouter.get( '/cert/playbook/:mfrCode',   requirePermission('scan_data.view'),   getCertPlaybook);

// ───────── Coupons router ─────────
const couponsRouter = express.Router();
couponsRouter.use(protect);
couponsRouter.use(scopeToTenant);

couponsRouter.get(   '/',          requirePermission('coupons.view'),   listCoupons);
// POS validation — runtime check at register (cashier+)
couponsRouter.post(  '/validate',  requirePermission('coupons.redeem'),  validateCoupon);
couponsRouter.get(   '/:id',       requirePermission('coupons.view'),    getCoupon);
couponsRouter.post(  '/',          requirePermission('coupons.manage'),  createCoupon);
couponsRouter.put(   '/:id',       requirePermission('coupons.manage'),  updateCoupon);
couponsRouter.delete('/:id',       requirePermission('coupons.manage'),  deleteCoupon);
couponsRouter.post(  '/import',    requirePermission('coupons.manage'),  importCouponsCsv);

// Redemptions (read-only in S45; create flow happens via posTerminalController in S46)
couponsRouter.get('/redemptions/list',  requirePermission('coupons.view'), listRedemptions);
couponsRouter.get('/redemptions/stats', requirePermission('coupons.view'), getRedemptionStats);

export { scanDataRouter, couponsRouter };
