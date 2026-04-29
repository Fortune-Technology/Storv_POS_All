/**
 * orderEngine.ts — backward-compat shim.
 *
 * Implementation lives in `./inventory/orderEngine.ts` (Session 55
 * service-layer domain refactor). This file exists so existing imports
 * keep working:
 *   import { ... } from '../services/orderEngine.js';
 *
 * New code should prefer `./inventory/orderEngine.js` directly, or the
 * barrel at `./inventory/index.js` which also re-exports matching + import.
 */

export * from './inventory/orderEngine.js';
