/**
 * fuelController.ts — back-compat shim
 *
 * S80 (Refactor Pass D) split this 1369-line file into per-domain modules
 * under controllers/fuel/. The shim keeps every existing import path live:
 *   import { handler } from '../controllers/fuelController.js'
 * still resolves to the same function.
 *
 * See controllers/fuel/index.ts for the domain layout + handler list.
 *
 * Pattern matches:
 *   - controllers/sales/  (S53)
 *   - controllers/shift/  (S53)
 */

export * from './fuel/index.js';
