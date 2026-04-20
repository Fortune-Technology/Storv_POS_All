/**
 * Catalog Routes — Native POS Product Catalog (PostgreSQL)
 *
 * All routes require authentication.
 * Managers and above can read/write catalog data.
 * Cashiers can only read (for POS terminal lookups).
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { protect, authorize } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  // Departments
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  // Department Attributes (Session 4)
  getDepartmentAttributes,
  createDepartmentAttribute,
  updateDepartmentAttribute,
  deleteDepartmentAttribute,
  applyStandardAttributes,
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
  duplicateMasterProduct,
  exportMasterProducts,
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
  listProductGroups,
  getProductGroup,
  createProductGroup,
  updateProductGroup,
  deleteProductGroup,
  applyGroupTemplate,
  addProductsToGroup,
  removeProductsFromGroup,
} from '../controllers/productGroupController.js';
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
router.get('/departments',        requirePermission('departments.view'),   getDepartments);
router.post('/departments',       requirePermission('departments.create'), createDepartment);
router.put('/departments/:id',    requirePermission('departments.edit'),   updateDepartment);
router.delete('/departments/:id', requirePermission('departments.delete'), deleteDepartment);

// Department Attributes (Session 4)
router.get('/department-attributes',         requirePermission('departments.view'),   getDepartmentAttributes);
router.post('/department-attributes',        requirePermission('departments.edit'),   createDepartmentAttribute);
router.put('/department-attributes/:id',     requirePermission('departments.edit'),   updateDepartmentAttribute);
router.delete('/department-attributes/:id',  requirePermission('departments.edit'),   deleteDepartmentAttribute);
router.post('/departments/:id/apply-standard-attributes', requirePermission('departments.edit'), applyStandardAttributes);

// ─── Tax Rules ───────────────────────────────────────────
router.get('/tax-rules',        requirePermission('rules_fees.view'), getTaxRules);
router.post('/tax-rules',       requirePermission('rules_fees.edit'), createTaxRule);
router.put('/tax-rules/:id',    requirePermission('rules_fees.edit'), updateTaxRule);
router.delete('/tax-rules/:id', requirePermission('rules_fees.edit'), deleteTaxRule);

// ─── Deposit Rules ───────────────────────────────────────
router.get('/deposit-rules',     requirePermission('rules_fees.view'), getDepositRules);
router.post('/deposit-rules',    requirePermission('rules_fees.edit'), createDepositRule);
router.put('/deposit-rules/:id', requirePermission('rules_fees.edit'), updateDepositRule);

// ─── Vendors ─────────────────────────────────────────────
router.get('/vendors',                 requirePermission('vendors.view'),   getVendors);
router.post('/vendors',                requirePermission('vendors.create'), createVendor);
router.get('/vendors/:id',             requirePermission('vendors.view'),   getVendor);
router.put('/vendors/:id',             requirePermission('vendors.edit'),   updateVendor);
router.delete('/vendors/:id',          requirePermission('vendors.delete'), deleteVendor);
router.get('/vendors/:id/products',    requirePermission('vendors.view'),   getVendorProducts);
router.get('/vendors/:id/payouts',     requirePermission('vendor_payouts.view'), getVendorPayouts);
router.get('/vendors/:id/stats',       requirePermission('vendors.view'),   getVendorStats);

// ─── Rebate Programs ─────────────────────────────────────
router.get('/rebates',     requirePermission('vendors.view'), getRebatePrograms);
router.post('/rebates',    requirePermission('vendors.edit'), createRebateProgram);
router.put('/rebates/:id', requirePermission('vendors.edit'), updateRebateProgram);

// ─── Master Products ─────────────────────────────────────
// Search first (must be before /:id)
// ─── Product Groups (template groups for shared classification/pricing) ─────
router.get('/groups',                      requirePermission('products.view'),   listProductGroups);
router.get('/groups/:id',                  requirePermission('products.view'),   getProductGroup);
router.post('/groups',                     requirePermission('products.create'), createProductGroup);
router.put('/groups/:id',                  requirePermission('products.edit'),   updateProductGroup);
router.delete('/groups/:id',               requirePermission('products.delete'), deleteProductGroup);
router.post('/groups/:id/apply',           requirePermission('products.edit'),   applyGroupTemplate);
router.post('/groups/:id/add-products',    requirePermission('products.edit'),   addProductsToGroup);
router.post('/groups/:id/remove-products', requirePermission('products.edit'),   removeProductsFromGroup);

router.get('/products/search',           requirePermission('products.view'),   searchMasterProducts);
router.get('/products/export',           requirePermission('products.view'),   exportMasterProducts);
router.get('/products/bulk',             requirePermission('products.view'),   getMasterProducts);
router.post('/products/bulk-update',     requirePermission('products.edit'),   bulkUpdateMasterProducts);
router.post('/products/bulk-delete',     requirePermission('products.delete'), bulkDeleteMasterProducts);
router.post('/products/delete-all',      requirePermission('products.delete'), deleteAllProducts);
router.post('/products/bulk-department', requirePermission('products.edit'),   bulkSetDepartment);
router.post('/products/bulk-active',     requirePermission('products.edit'),   bulkToggleActive);

router.get('/products',                requirePermission('products.view'),   getMasterProducts);
router.post('/products',               requirePermission('products.create'), createMasterProduct);
router.get('/products/:id',            requirePermission('products.view'),   getMasterProduct);
router.post('/products/:id/duplicate', requirePermission('products.create'), duplicateMasterProduct);
router.put('/products/:id',            requirePermission('products.edit'),   updateMasterProduct);
router.delete('/products/:id',         requirePermission('products.delete'), deleteMasterProduct);

// ─── Product UPCs ─────────────────────────────────────
router.get('/products/:id/upcs',            requirePermission('products.view'), getProductUpcs);
router.post('/products/:id/upcs',           requirePermission('products.edit'), addProductUpc);
router.delete('/products/:id/upcs/:upcId',  requirePermission('products.edit'), deleteProductUpc);

// ─── Product Image Upload ────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imgDir = path.join(__dirname, '..', '..', 'uploads', 'product-images');
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

const imgUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, imgDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `product-${req.params.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|webp|gif|svg|avif)$/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

router.post('/products/:id/image', requirePermission('products.edit'), imgUpload.single('image'), async (req, res) => {
  try {
    const prisma = (await import('../config/postgres.js')).default;
    const productId = parseInt(req.params.id);
    const orgId = req.orgId || req.user?.orgId;

    const product = await prisma.masterProduct.findFirst({ where: { id: productId, orgId } });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const base = process.env.BACKEND_URL || process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const imageUrl = `${base}/uploads/product-images/${req.file.filename}`;

    await prisma.masterProduct.update({ where: { id: productId }, data: { imageUrl } });

    // Also populate global image cache
    if (product.upc) {
      const { upsertGlobalImage } = await import('../services/globalImageService.js');
      await upsertGlobalImage({ upc: product.upc, imageUrl, source: 'upload', productName: product.name, brand: product.brand }).catch(() => {});
    }

    res.json({ success: true, imageUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Product Pack Sizes ───────────────────────────────
router.get('/products/:id/pack-sizes',                 requirePermission('products.view'), getProductPackSizes);
router.post('/products/:id/pack-sizes',                requirePermission('products.edit'), addProductPackSize);
router.put('/products/:id/pack-sizes/bulk-replace',    requirePermission('products.edit'), bulkReplacePackSizes);
router.put('/products/:id/pack-sizes/:sizeId',         requirePermission('products.edit'), updateProductPackSize);
router.delete('/products/:id/pack-sizes/:sizeId',      requirePermission('products.edit'), deleteProductPackSize);

// ─── Store Products ──────────────────────────────────────
router.get('/store-products',        requirePermission('products.view'),   getStoreProducts);
router.post('/store-products',       requirePermission('inventory.edit'),  upsertStoreProduct);
router.put('/store-products/stock',  requirePermission('inventory.edit'),  adjustStoreStock);

// ─── Promotions ──────────────────────────────────────────
router.get('/promotions',           requirePermission('promotions.view'),   getPromotions);
router.post('/promotions',          requirePermission('promotions.create'), createPromotion);
router.put('/promotions/:id',       requirePermission('promotions.edit'),   updatePromotion);
router.delete('/promotions/:id',    requirePermission('promotions.delete'), deletePromotion);
router.post('/promotions/evaluate', requirePermission('promotions.view'),   evaluatePromotions);

// ─── Import ───────────────────────────────────────────────────
router.post('/import/preview',       requirePermission('products.create'), previewImport);
router.post('/import/commit',        requirePermission('products.create'), commitImport);
router.get('/import/template/:type', requirePermission('products.view'),   getImportTemplate);
router.get('/import/history',        requirePermission('products.view'),   getImportHistory);
router.get('/import/history/:id',    requirePermission('products.view'),   getImportJob);

// ─── Vendor Payments (back-office) ────────────────────────────────
router.get('/vendor-payments',        requirePermission('vendor_payouts.view'),   listVendorPayments);
router.post('/vendor-payments',       requirePermission('vendor_payouts.create'), createVendorPayment);
router.put('/vendor-payments/:id',    requirePermission('vendor_payouts.edit'),   updateVendorPayment);



export default router;
