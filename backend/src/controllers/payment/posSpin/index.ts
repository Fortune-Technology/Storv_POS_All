/**
 * POS SPIn — public API barrel.
 *
 * Re-exports every public handler from the sub-modules so callers can do:
 *   import { dejavooSale } from 'controllers/payment/posSpin/index.js'
 *   import { dejavooSale } from 'controllers/dejavooPaymentController.js' ← legacy shim
 */

// Money-moving transactions
export { dejavooSale, dejavooRefund, dejavooVoid } from './transactions.js';

// EBT balance inquiry (read-only)
export { dejavooEbtBalance } from './ebt.js';

// Terminal control + status
export {
  dejavooCancel,
  dejavooTerminalStatus,
  dejavooTransactionStatus,
  dejavooSettle,
} from './control.js';

// Customer phone-number lookup via terminal prompt
export { dejavooLookupCustomer } from './lookup.js';

// Customer-facing display (live cart push + welcome / thank-you / receipt)
export {
  dejavooPushCart,
  dejavooPushWelcome,
  dejavooPushThankYou,
  dejavooPushBrandedReceipt,
  dejavooClearDisplay,
} from './customerDisplay.js';

// Read-only merchant configuration for the portal
export { dejavooMerchantStatus } from './status.js';
