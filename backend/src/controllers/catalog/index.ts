/**
 * Barrel — re-exports every public handler from the catalog controller
 * sub-modules so route files can keep importing from the original
 * `controllers/catalogController.ts` shim path. Maintains backward
 * compatibility for every existing import. (S81 — refactor pass D, S53 pattern.)
 *
 * Module layout (8 sub-modules + helpers + shim):
 *   helpers.ts          — getOrgId/getStoreId, toPrice, sync emitters, UPC
 *                         uniqueness, touchMasterProduct, flattenDeposit,
 *                         pagination, shared row types
 *   departments.ts      — Departments + Department Attributes (10 handlers)
 *   taxRules.ts         — Tax Rules + Deposit Rules + Tax-unmapped diagnostic (8)
 *   vendors.ts          — Vendor CRUD + Product-Vendor mappings + Rebates (16
 *                         + helper export `upsertProductVendor` for invoiceController)
 *   products.ts         — Master product CRUD + bulk + duplicate + export + search (13)
 *   storeInventory.ts   — Store products + Stock adjustment + Ecom stock check (4)
 *   promotions.ts       — Promotions CRUD + cart-time evaluation (5)
 *   productVariants.ts  — Per-product UPCs + Pack sizes (cashier picker) (8)
 *
 * Last domain re-export (Prisma type alias) lives at the very bottom — it's
 * exported by the original module so cleanup scripts can import it from the
 * shim path; preserving it here keeps that import working.
 */

// Departments + Dept Attributes
export {
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  applyDepartmentTemplate,
  getDepartmentAttributes,
  createDepartmentAttribute,
  updateDepartmentAttribute,
  applyStandardAttributes,
  deleteDepartmentAttribute,
} from './departments.js';

// Tax + Deposit + Tax-unmapped
export {
  getTaxRules,
  createTaxRule,
  updateTaxRule,
  deleteTaxRule,
  getDepositRules,
  createDepositRule,
  updateDepositRule,
  getTaxUnmappedProducts,
} from './taxRules.js';

// Vendors + Product-Vendor + Rebates
export {
  getVendors,
  getVendor,
  createVendor,
  updateVendor,
  deleteVendor,
  getVendorProducts,
  getVendorPayouts,
  getVendorStats,
  upsertProductVendor,
  listProductVendors,
  createProductVendor,
  updateProductVendor,
  deleteProductVendor,
  makeProductVendorPrimary,
  getRebatePrograms,
  createRebateProgram,
  updateRebateProgram,
} from './vendors.js';

// Master Products
export {
  getMasterProducts,
  exportMasterProducts,
  searchMasterProducts,
  getMasterProduct,
  createMasterProduct,
  duplicateMasterProduct,
  updateMasterProduct,
  deleteMasterProduct,
  bulkUpdateMasterProducts,
  bulkDeleteMasterProducts,
  bulkSetDepartment,
  bulkToggleActive,
  deleteAllProducts,
} from './products.js';

// Store-level inventory + ecom stock check
export {
  getStoreProducts,
  upsertStoreProduct,
  adjustStoreStock,
  ecomStockCheck,
} from './storeInventory.js';

// Promotions
export {
  getPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  evaluatePromotions,
} from './promotions.js';

// Per-product variants (UPCs + Pack Sizes)
export {
  getProductUpcs,
  addProductUpc,
  deleteProductUpc,
  getProductPackSizes,
  addProductPackSize,
  updateProductPackSize,
  deleteProductPackSize,
  bulkReplacePackSizes,
} from './productVariants.js';

// Re-export Prisma type alias so consumers that import from this module
// (e.g., tax-rule cleanup scripts) can stay TS-safe.
export type { Prisma } from '@prisma/client';
