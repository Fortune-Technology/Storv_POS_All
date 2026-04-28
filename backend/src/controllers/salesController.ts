/**
 * salesController.ts — backward-compat shim.
 *
 * The implementation lives in `./sales/` (split into 6 focused modules:
 * helpers, aggregations, predictions, weather, realtime, vendorOrders).
 *
 * This file exists so existing imports keep working without changes:
 *   import { realtimeSales } from '../controllers/salesController.js';
 *
 * New code should prefer importing directly from `./sales/*` for clearer
 * dependency hints — e.g. `import { daily } from '../controllers/sales/aggregations.js'`.
 */

export * from './sales/index.js';
