/**
 * adminPaymentTerminalController.ts — backward-compat shim.
 *
 * The implementation lives in `./payment/adminTerminal/` (split into 2
 * focused modules: crud, ping).
 *
 * This file exists so existing imports keep working without changes:
 *   import { listTerminals } from '../controllers/adminPaymentTerminalController.js';
 *
 * New code should prefer importing from `./payment/adminTerminal/*` for
 * clearer dependency hints.
 */

export * from './payment/adminTerminal/index.js';
