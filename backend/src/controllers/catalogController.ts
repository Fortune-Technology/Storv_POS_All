/**
 * catalogController — split into `controllers/catalog/` folder (S81, refactor
 * pass D, S53 pattern). This file is now a 1-line shim so every existing
 * `import { ... } from '../controllers/catalogController.js'` keeps working.
 *
 * Original 4605-line file is split across:
 *   - catalog/helpers.ts          (shared types + tenant scope + UPC + sync emitters)
 *   - catalog/departments.ts      (Departments + Dept Attributes — 10 handlers)
 *   - catalog/taxRules.ts         (Tax Rules + Deposit Rules + Tax-unmapped — 8)
 *   - catalog/vendors.ts          (Vendor CRUD + Product-Vendor + Rebates — 16)
 *   - catalog/products.ts         (Master Product CRUD + bulk + duplicate + export — 13)
 *   - catalog/storeInventory.ts   (Store-level products + adjust + ecom stock — 4)
 *   - catalog/promotions.ts       (Promotions CRUD + cart evaluation — 5)
 *   - catalog/productVariants.ts  (per-product UPCs + pack sizes — 8)
 *   - catalog/index.ts            (barrel)
 */

export * from './catalog/index.js';
