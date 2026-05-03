/**
 * salesService.ts — backward-compat shim.
 *
 * Implementation lives in `./sales/sales.ts` (Session 55 service-layer
 * domain refactor). This file exists so existing imports keep working:
 *   import { getDailySales } from '../services/salesService.js';
 *
 * New code should prefer `./sales/sales.js` directly. Note that the
 * controllers/sales/ tree (Session 53) is the controller-layer counterpart;
 * services/sales/ is for shared aggregation logic.
 */

export * from './sales/sales.js';
