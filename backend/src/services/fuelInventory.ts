/**
 * fuelInventory.ts — backward-compat shim.
 *
 * Implementation lives in `./fuel/inventory.ts` (Session 55 service-layer
 * domain refactor). This file exists so existing imports keep working:
 *   import { applySale, applyRefund } from '../services/fuelInventory.js';
 *
 * New code should prefer `./fuel/inventory.js` directly.
 */

export * from './fuel/inventory.js';
