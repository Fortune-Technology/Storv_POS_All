import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { attachPOSUser } from '../middleware/attachPOSUser.js';
import {
  connectPOS,
  getStatus,
  fetchProducts,
  syncAllProducts,
  updateProductPrice,
  bulkPriceUpdate,
  fetchCustomers,
  syncPOSCustomers,
  fetchDepartments,
  getLogs,
  getLocalProducts,
  debugProductsRaw,
  debugReferenceData,
  globalProductSearch,
  getAllVendors,
  getTaxesFees,
  updatePOSProductDetails,
  createPOSProduct,
} from '../controllers/posController.js';

const router = express.Router();

// All routes require authentication; managers, admins and owners can access POS
router.use(protect);
router.use(authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'));
router.use(scopeToTenant);   // sets req.storeId from X-Store-Id header
router.use(attachPOSUser);   // merges store POS credentials → req.posUser

// Connection management
router.post('/connect', connectPOS);
router.get('/status', getStatus);

// Products from MarktPOS
router.get('/products/search', globalProductSearch);
router.get('/products', fetchProducts);
router.post('/products/sync', syncAllProducts);
router.get('/products/local', getLocalProducts);

// Price management
router.put('/products/:id/price', updateProductPrice);
router.post('/products/bulk-price-update', bulkPriceUpdate);

// Customers & departments
router.get('/customers', fetchCustomers);
router.post('/customers/sync', syncPOSCustomers);
router.get('/departments', fetchDepartments);
router.get('/vendors', getAllVendors);

// Taxes & Fees (for deposit/tax dropdowns in invoice review)
router.get('/taxes-fees', getTaxesFees);

// Product detail update (pack, case_cost, retail price, dept, vendor, cert_code, fees, taxes)
router.put('/products/:id/details', updatePOSProductDetails);

// Create new product in IT Retail
router.post('/products/create', createPOSProduct);

// Logs
router.get('/logs', getLogs);

// Debug — raw MarktPOS response (first 3 products)
router.get('/debug/products-raw', debugProductsRaw);
// Debug — raw departments / fees / taxes response (use to confirm endpoint shapes)
router.get('/debug/reference-data', debugReferenceData);

export default router;
