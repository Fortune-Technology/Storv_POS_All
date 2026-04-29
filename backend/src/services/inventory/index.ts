/**
 * Inventory — supply-chain + product-data services.
 *
 *   orderEngine.ts — 14-factor demand-driven reorder algorithm. Pulls 90 days
 *                    of sales history, projects via Holt-Winters, applies
 *                    weather + holiday + DOW factors, stockout penalty,
 *                    safety stock + service level, then proposes purchase
 *                    quantities per vendor.
 *   matching.ts    — invoice-line → master-product matcher with the 7-tier
 *                    cascade (UPC → vendor itemCode → VendorProductMap →
 *                    PLU → cross-store GlobalProductMatch → composite
 *                    fuzzy → AI). Used by invoice import.
 *   import.ts      — bulk-import pipeline (CSV/XLSX → MasterProduct).
 *                    Handles column-mapping, transforms, image rehosting,
 *                    multi-pack expansion, and idempotent upserts.
 *
 * orderEngine has a dynamic import of `../weather/weather.js` — keeps the
 * weather service optional at module-load time so a missing weather API
 * key doesn't crash the reorder controller.
 */

export * from './orderEngine.js';
export * from './matching.js';
export * from './import.js';
