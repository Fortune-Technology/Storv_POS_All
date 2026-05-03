/**
 * matchingService.ts — backward-compat shim.
 *
 * Implementation lives in `./inventory/matching.ts` (Session 55 service-layer
 * domain refactor). This file exists so existing imports keep working:
 *   import { matchLineItems } from '../services/matchingService.js';
 *
 * New code should prefer `./inventory/matching.js` directly.
 */

export * from './inventory/matching.js';
