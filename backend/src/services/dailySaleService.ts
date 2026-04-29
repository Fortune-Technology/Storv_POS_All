/**
 * dailySaleService.ts — backward-compat shim.
 *
 * Implementation lives in `./sales/dailySale.ts` (Session 55 service-layer
 * domain refactor). This file exists so existing imports keep working:
 *   import { ... } from '../services/dailySaleService.js';
 *
 * New code should prefer `./sales/dailySale.js` directly.
 */

export * from './sales/dailySale.js';
