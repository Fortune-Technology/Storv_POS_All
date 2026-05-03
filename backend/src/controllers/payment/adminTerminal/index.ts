/**
 * Admin terminal — public API barrel.
 *
 * Re-exports every public handler from the sub-modules so callers can do:
 *   import { listTerminals, pingTerminal } from 'controllers/payment/adminTerminal/index.js'
 *   import { listTerminals, pingTerminal } from 'controllers/adminPaymentTerminalController.js' ← legacy shim
 */

// CRUD + station picker
export {
  listTerminals,
  listStationsForStore,
  createTerminal,
  updateTerminal,
  deleteTerminal,
} from './crud.js';

// Live connectivity check
export { pingTerminal } from './ping.js';
