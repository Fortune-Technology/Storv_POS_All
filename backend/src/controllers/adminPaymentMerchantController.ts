/**
 * adminPaymentMerchantController.ts — backward-compat shim.
 *
 * The implementation lives in `./payment/adminMerchant/` (split into 3
 * focused modules: helpers, crud, lifecycle).
 *
 * This file exists so existing imports keep working without changes:
 *   import { listPaymentMerchants } from '../controllers/adminPaymentMerchantController.js';
 *
 * New code should prefer importing directly from `./payment/adminMerchant/*`
 * for clearer dependency hints.
 */

export * from './payment/adminMerchant/index.js';
