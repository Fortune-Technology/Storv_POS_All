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
  createVendor,
  updateVendor,
  deleteVendor,
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
  // Store Products
  getStoreProducts,
  upsertStoreProduct,
  adjustStoreStock,
  // Promotions
  getPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
} from '../controllers/catalogController.js';

const router = express.Router();

// All routes require auth + tenant scoping
router.use(protect);
router.use(scopeToTenant);

// ─── Departments ─────────────────────────────────────────
// Cashiers can read (for POS display); managers+ can write
router.get('/departments',         authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getDepartments);
router.post('/departments',        authorize('superadmin', 'admin', 'owner', 'manager'), createDepartment);
router.put('/departments/:id',     authorize('superadmin', 'admin', 'owner', 'manager'), updateDepartment);
router.delete('/departments/:id',  authorize('superadmin', 'admin', 'owner'), deleteDepartment);

// ─── Tax Rules ───────────────────────────────────────────
router.get('/tax-rules',           authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getTaxRules);
router.post('/tax-rules',          authorize('superadmin', 'admin', 'owner'), createTaxRule);
router.put('/tax-rules/:id',       authorize('superadmin', 'admin', 'owner'), updateTaxRule);
router.delete('/tax-rules/:id',    authorize('superadmin', 'admin', 'owner'), deleteTaxRule);

// ─── Deposit Rules ───────────────────────────────────────
router.get('/deposit-rules',       authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getDepositRules);
router.post('/deposit-rules',      authorize('superadmin', 'admin', 'owner'), createDepositRule);
router.put('/deposit-rules/:id',   authorize('superadmin', 'admin', 'owner'), updateDepositRule);

// ─── Vendors ─────────────────────────────────────────────
router.get('/vendors',             authorize('superadmin', 'admin', 'owner', 'manager', 'store'), getVendors);
router.post('/vendors',            authorize('superadmin', 'admin', 'owner', 'manager'), createVendor);
router.put('/vendors/:id',         authorize('superadmin', 'admin', 'owner', 'manager'), updateVendor);
router.delete('/vendors/:id',      authorize('superadmin', 'admin', 'owner'), deleteVendor);

// ─── Rebate Programs ─────────────────────────────────────
router.get('/rebates',             authorize('superadmin', 'admin', 'owner', 'manager'), getRebatePrograms);
router.post('/rebates',            authorize('superadmin', 'admin', 'owner'), createRebateProgram);
router.put('/rebates/:id',         authorize('superadmin', 'admin', 'owner'), updateRebateProgram);

// ─── Master Products ─────────────────────────────────────
// Search first (must be before /:id)
router.get('/products/search',     authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), searchMasterProducts);
router.get('/products/bulk',       authorize('superadmin', 'admin', 'owner', 'manager'), getMasterProducts);
router.post('/products/bulk-update', authorize('superadmin', 'admin', 'owner', 'manager'), bulkUpdateMasterProducts);

router.get('/products',            authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getMasterProducts);
router.post('/products',           authorize('superadmin', 'admin', 'owner', 'manager'), createMasterProduct);
router.get('/products/:id',        authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getMasterProduct);
router.put('/products/:id',        authorize('superadmin', 'admin', 'owner', 'manager'), updateMasterProduct);
router.delete('/products/:id',     authorize('superadmin', 'admin', 'owner'), deleteMasterProduct);

// ─── Store Products ──────────────────────────────────────
router.get('/store-products',      authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getStoreProducts);
router.post('/store-products',     authorize('superadmin', 'admin', 'owner', 'manager'), upsertStoreProduct);
router.put('/store-products/stock',authorize('superadmin', 'admin', 'owner', 'manager'), adjustStoreStock);

// ─── Promotions ──────────────────────────────────────────
router.get('/promotions',          authorize('superadmin', 'admin', 'owner', 'manager', 'cashier'), getPromotions);
router.post('/promotions',         authorize('superadmin', 'admin', 'owner', 'manager'), createPromotion);
router.put('/promotions/:id',      authorize('superadmin', 'admin', 'owner', 'manager'), updatePromotion);
router.delete('/promotions/:id',   authorize('superadmin', 'admin', 'owner'), deletePromotion);

export default router;
