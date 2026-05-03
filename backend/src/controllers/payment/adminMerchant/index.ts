/**
 * Admin merchant — public API barrel.
 *
 * Re-exports every public handler from the sub-modules so callers can do:
 *   import { listPaymentMerchants } from 'controllers/payment/adminMerchant/index.js'
 *   import { listPaymentMerchants } from 'controllers/adminPaymentMerchantController.js' ← legacy shim
 *
 * Both paths work. New code should prefer importing directly from
 * `./adminMerchant/crud.js` etc. for clearer dependency hints.
 */

// CRUD
export {
  listPaymentMerchants,
  getPaymentMerchant,
  createPaymentMerchant,
  updatePaymentMerchant,
  deletePaymentMerchant,
} from './crud.js';

// Lifecycle (status transitions + audit + test)
export {
  activatePaymentMerchant,
  disablePaymentMerchant,
  getPaymentMerchantAudit,
  testPaymentMerchant,
} from './lifecycle.js';
