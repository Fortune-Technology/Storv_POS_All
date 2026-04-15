/**
 * Vendor Order Routes — /api/vendor-orders
 * Purchase order generation, management, and receiving.
 *
 * Role tiers:
 *   Read   — manager and above
 *   Write  — manager and above (create/edit PO, submit, receive)
 *   Approve/Delete — owner and above (financial sign-off)
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  getSuggestions,
  generatePOs,
  listPurchaseOrders,
  getPurchaseOrder,
  updatePurchaseOrder,
  submitPurchaseOrder,
  receivePurchaseOrder,
  receiveByInvoice,
  approvePurchaseOrder,
  rejectPurchaseOrder,
  deletePurchaseOrder,
  getPurchaseOrderPDF,
  getCostVariance,
  getVendorPerformance,
  createManualPO,
} from '../controllers/orderController.js';

const router = Router();

router.use(protect);
router.use(scopeToTenant);

const readRoles  = authorize('superadmin', 'admin', 'owner', 'manager');
const writeRoles = authorize('superadmin', 'admin', 'owner', 'manager');
const ownerRoles = authorize('superadmin', 'admin', 'owner');

// Suggestions (run algorithm)
router.get('/suggestions', readRoles, getSuggestions);

// Generate draft POs from suggestions
router.post('/generate', writeRoles, generatePOs);

// Purchase Order CRUD
router.post('/purchase-orders',        writeRoles, createManualPO);
router.get('/purchase-orders',         readRoles,  listPurchaseOrders);
router.get('/purchase-orders/:id',     readRoles,  getPurchaseOrder);
router.put('/purchase-orders/:id',     writeRoles, updatePurchaseOrder);
router.delete('/purchase-orders/:id',  ownerRoles, deletePurchaseOrder);

// PO lifecycle — approve/reject are financial sign-off (owner+)
router.post('/purchase-orders/:id/submit',  writeRoles, submitPurchaseOrder);
router.post('/purchase-orders/:id/approve', ownerRoles, approvePurchaseOrder);
router.post('/purchase-orders/:id/reject',  ownerRoles, rejectPurchaseOrder);
router.post('/purchase-orders/:id/receive', writeRoles, receivePurchaseOrder);

// Invoice-based receiving
router.post('/receive-by-invoice', writeRoles, receiveByInvoice);

// Cost variance analysis
router.get('/cost-variance', readRoles, getCostVariance);

// Vendor performance metrics
router.get('/vendor-performance', readRoles, getVendorPerformance);

// PDF export
router.get('/purchase-orders/:id/pdf', readRoles, getPurchaseOrderPDF);

export default router;
