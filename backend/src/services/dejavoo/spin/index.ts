/**
 * Dejavoo SPIn — public API barrel.
 *
 * Re-exports every public symbol from the sub-modules. Callers that want the
 * full surface should import this barrel; callers that only need one slice
 * of functionality (e.g. just `sale` + `refund`) should prefer the direct
 * sub-module path (`./spin/transactions.js`) for clearer dependency hints.
 */

// Types
export type { DejavooSpinMerchant, SpinOpts } from './types.js';

// Client + helpers
export { generateReferenceId } from './client.js';

// Transaction methods
export { sale, refund, voidTransaction, tipAdjust, balance, getCard } from './transactions.js';

// Terminal control + probes
export { abort, settle, status, userInput, terminalStatus } from './terminal.js';

// Lookup tables
export { PAYMENT_TYPE_MAP, STATUS_MESSAGES } from './constants.js';
