/**
 * importService.ts — backward-compat shim.
 *
 * Implementation lives in `./inventory/import.ts` (Session 55 service-layer
 * domain refactor). This file exists so existing imports keep working:
 *   import { ... } from '../services/importService.js';
 *
 * New code should prefer `./inventory/import.js` directly.
 */

export * from './inventory/import.js';
