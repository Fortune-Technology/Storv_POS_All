/**
 * Catalog Routes — Native POS Product Catalog (PostgreSQL)
 *
 * All routes require authentication.
 * Managers and above can read/write catalog data.
 * Cashiers can only read (for POS terminal lookups).
 */

import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  // Departments
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  // Tax Rules
  getTaxRules,
  createTaxRule,
  updateTaxRule,
  deleteTaxRule,
  // Deposit Rules
  getDepositRules,
  createDepositRule,
  updateDepositRule,
  // Vendors
  getVendors,
  getVendor,
  createVendor,
  updateVendor,
  deleteVendor,
  getVendorProducts,
  getVendorPayouts,
  getVendorStats,
  // Rebate Programs
  getRebatePrograms,
  createRebateProgram,
  updateRebateProgram,
  // Master Products
  getMasterProducts,
  searchMasterProducts,
  getMasterProduct,
  createMasterProduct,
  updateMasterProduct,
  deleteMasterProduct,
  bulkUpdateMasterProducts,
  bulkDeleteMasterProducts,
  bulkSetDepartment,
  bulkToggleActive,
  deleteAllProducts,
  // Product UPCs
  getProductUpcs,
  addProductUpc,
  deleteProductUpc,
  // Product Pack Sizes
  getProductPackSizes,
  addProductPackSize,
  updateProductPackSize,
  deleteProductPackSize,
  bulkReplacePackSizes,
  // Store Products
  getStoreProducts,
  upsertStoreProduct,
  adjustStoreStock,
  // E-commerce stock check
  ecomStockCheck,
  // Promotions
  getPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  evaluatePromotions,
} from '../controllers/catalogController.js';
import {
  previewImport,
  commitImport,
  getImportTemplate,
  getImportHistory,
  getImportJob,
} from '../controllers/importController.js';
import {
  listVendorPayments,
  createVendorPayment,
  updateVendorPayment,
} from '../controllers/vendorPaymentController.js';

const router = express.Router();

// ─── E-commerce Stock Check (NO auth — internal service-to-service call) ──
// Must be BEFORE router.use(protect) so it doesn't require JWT
router.post('/ecom-stock-check', ecomStockCheck);

// All other routes require auth + tenant scoping
router.use(protect);
router.use(scopeToTenant);

// ─── Departments ─────────────────────────────────────────
// Cashiers can read (for POS display); managers+ can write
router.get('/departments', authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getDepartments);
router.post('/departments', authorize('superadmin', 'admin', 'owner', 'manager'), createDepartment);
router.put('/departments/:id', authorize('superadmin', 'admin', 'owner', 'manager'), updateDepartment);
router.delete('/departments/:id', authorize('superadmin', 'admin', 'owner'), deleteDepartment);

// ─── Tax Rules ───────────────────────────────────────────
router.get('/tax-rules', authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getTaxRules);
router.post('/tax-rules', authorize('superadmin', 'admin', 'owner'), createTaxRule);
router.put('/tax-rules/:id', authorize('superadmin', 'admin', 'owner'), updateTaxRule);
router.delete('/tax-rules/:id', authorize('superadmin', 'admin', 'owner'), deleteTaxRule);

// ─── Deposit Rules ───────────────────────────────────────
router.get('/deposit-rules', authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getDepositRules);
router.post('/deposit-rules', authorize('superadmin', 'admin', 'owner'), createDepositRule);
router.put('/deposit-rules/:id', authorize('superadmin', 'admin', 'owner'), updateDepositRule);

// ─── Vendors ─────────────────────────────────────────────
router.get('/vendors', authorize('superadmin', 'admin', 'owner', 'manager', 'store'), getVendors);
router.post('/vendors', authorize('superadmin', 'admin', 'owner', 'manager'), createVendor);
router.get('/vendors/:id', authorize('superadmin', 'admin', 'owner', 'manager'), getVendor);
router.put('/vendors/:id', authorize('superadmin', 'admin', 'owner', 'manager'), updateVendor);
router.delete('/vendors/:id', authorize('superadmin', 'admin', 'owner'), deleteVendor);
router.get('/vendors/:id/products', authorize('superadmin', 'admin', 'owner', 'manager'), getVendorProducts);
router.get('/vendors/:id/payouts', authorize('superadmin', 'admin', 'owner', 'manager'), getVendorPayouts);
router.get('/vendors/:id/stats', authorize('superadmin', 'admin', 'owner', 'manager'), getVendorStats);

// ─── Rebate Programs ─────────────────────────────────────
router.get('/rebates', authorize('superadmin', 'admin', 'owner', 'manager'), getRebatePrograms);
router.post('/rebates', authorize('superadmin', 'admin', 'owner'), createRebateProgram);
router.put('/rebates/:id', authorize('superadmin', 'admin', 'owner'), updateRebateProgram);

// ─── Master Products ─────────────────────────────────────
// Search first (must be before /:id)
router.get('/products/search', authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), searchMasterProducts);
router.get('/products/bulk', authorize('superadmin', 'admin', 'owner', 'manager'), getMasterProducts);
router.post('/products/bulk-update',     authorize('superadmin', 'admin', 'owner', 'manager'), bulkUpdateMasterProducts);
router.post('/products/bulk-delete',     authorize('superadmin', 'admin', 'owner'),           bulkDeleteMasterProducts);
router.post('/products/delete-all',      authorize('superadmin', 'admin', 'owner'),           deleteAllProducts);
router.post('/products/bulk-department', authorize('superadmin', 'admin', 'owner', 'manager'), bulkSetDepartment);
router.post('/products/bulk-active',     authorize('superadmin', 'admin', 'owner', 'manager'), bulkToggleActive);

router.get('/products', authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getMasterProducts);
router.post('/products', authorize('superadmin', 'admin', 'owner', 'manager'), createMasterProduct);
router.get('/products/:id', authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getMasterProduct);
router.put('/products/:id', authorize('superadmin', 'admin', 'owner', 'manager'), updateMasterProduct);
router.delete('/products/:id', authorize('superadmin', 'admin', 'owner'), deleteMasterProduct);

// ─── Product UPCs ─────────────────────────────────────
router.get('/products/:id/upcs', authorize('superadmin', 'admin', 'owner', 'manager'), getProductUpcs);
router.post('/products/:id/upcs', authorize('superadmin', 'admin', 'owner', 'manager'), addProductUpc);
router.delete('/products/:id/upcs/:upcId', authorize('superadmin', 'admin', 'owner', 'manager'), deleteProductUpc);

// ─── Product Pack Sizes ───────────────────────────────
router.get('/products/:id/pack-sizes', authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getProductPackSizes);
router.post('/products/:id/pack-sizes', authorize('superadmin', 'admin', 'owner', 'manager'), addProductPackSize);
router.put('/products/:id/pack-sizes/bulk-replace', authorize('superadmin', 'admin', 'owner', 'manager'), bulkReplacePackSizes);
router.put('/products/:id/pack-sizes/:sizeId', authorize('superadmin', 'admin', 'owner', 'manager'), updateProductPackSize);
router.delete('/products/:id/pack-sizes/:sizeId', authorize('superadmin', 'admin', 'owner', 'manager'), deleteProductPackSize);

// ─── Store Products ──────────────────────────────────────
router.get('/store-products', authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getStoreProducts);
router.post('/store-products', authorize('superadmin', 'admin', 'owner', 'manager'), upsertStoreProduct);
router.put('/store-products/stock', authorize('superadmin', 'admin', 'owner', 'manager'), adjustStoreStock);

// ─── Promotions ──────────────────────────────────────────
router.get('/promotions', authorize('superadmin', 'admin', 'owner', 'manager', 'cashier'), getPromotions);
router.post('/promotions', authorize('superadmin', 'admin', 'owner', 'manager'), createPromotion);
router.put('/promotions/:id', authorize('superadmin', 'admin', 'owner', 'manager'), updatePromotion);
router.delete('/promotions/:id', authorize('superadmin', 'admin', 'owner'), deletePromotion);
router.post('/promotions/evaluate', authorize('superadmin', 'admin', 'owner', 'manager', 'cashier'), evaluatePromotions);

// ─── Import ───────────────────────────────────────────────────
// Preview requires manager+; commit requires manager+; templates are public (no auth needed for template download)
router.post('/import/preview', authorize('superadmin', 'admin', 'owner', 'manager'), previewImport);
router.post('/import/commit', authorize('superadmin', 'admin', 'owner', 'manager'), commitImport);
router.get('/import/template/:type', authorize('superadmin', 'admin', 'owner', 'manager'), getImportTemplate);
router.get('/import/history', authorize('superadmin', 'admin', 'owner', 'manager'), getImportHistory);
router.get('/import/history/:id', authorize('superadmin', 'admin', 'owner', 'manager'), getImportJob);

// ─── Vendor Payments (back-office) ────────────────────────────────
router.get('/vendor-payments', authorize('superadmin', 'admin', 'owner', 'manager'), listVendorPayments);
router.post('/vendor-payments', authorize('superadmin', 'admin', 'owner', 'manager'), createVendorPayment);
router.put('/vendor-payments/:id', authorize('superadmin', 'admin', 'owner'), updateVendorPayment);



export default router;
