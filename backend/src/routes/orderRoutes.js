/**
 * Vendor Order Routes — /api/vendor-orders
 * Purchase order generation, management, and receiving.
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
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

// Suggestions (run algorithm)
router.get('/suggestions', getSuggestions);

// Generate draft POs from suggestions
router.post('/generate', generatePOs);

// Purchase Order CRUD
router.post('/purchase-orders',           createManualPO);
router.get('/purchase-orders',            listPurchaseOrders);
router.get('/purchase-orders/:id',        getPurchaseOrder);
router.put('/purchase-orders/:id',        updatePurchaseOrder);
router.delete('/purchase-orders/:id',     deletePurchaseOrder);

// PO lifecycle
router.post('/purchase-orders/:id/submit',  submitPurchaseOrder);
router.post('/purchase-orders/:id/approve', approvePurchaseOrder);
router.post('/purchase-orders/:id/reject',  rejectPurchaseOrder);
router.post('/purchase-orders/:id/receive', receivePurchaseOrder);

// Invoice-based receiving
router.post('/receive-by-invoice', receiveByInvoice);

// Cost variance analysis
router.get('/cost-variance', getCostVariance);

// Vendor performance metrics
router.get('/vendor-performance', getVendorPerformance);

// PDF export
router.get('/purchase-orders/:id/pdf', getPurchaseOrderPDF);

export default router;
