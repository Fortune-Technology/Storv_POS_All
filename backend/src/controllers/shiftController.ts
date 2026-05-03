/**
 * shiftController.ts — backward-compat shim.
 *
 * The implementation lives in `./shift/` (split into 4 focused modules:
 * helpers, lifecycle, movements, reports).
 *
 * This file exists so existing imports keep working without changes:
 *   import { closeShift } from '../controllers/shiftController.js';
 *
 * New code should prefer importing directly from `./shift/*` for clearer
 * dependency hints — e.g.
 *   import { closeShift } from '../controllers/shift/lifecycle.js';
 */

export * from './shift/index.js';
