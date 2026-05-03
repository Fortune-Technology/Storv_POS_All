/**
 * Dejavoo HPP — public API barrel.
 *
 * Re-exports every public symbol from the sub-modules. Callers that want the
 * full surface should import this barrel; callers that only need one slice
 * (e.g. just `parseHppResponse` + `verifyWebhookAuthHeader`) should prefer
 * the direct sub-module path (`./hpp/webhook.js`) for clearer dependency
 * hints.
 */

// Types
export type {
  DejavooHppMerchant,
  CreateCheckoutOpts,
  CreateCheckoutResult,
} from './types.js';

// API constants
export { HPP_API_SPEC } from './api-spec.js';

// Client helpers
export {
  buildAuthHeaderValue,
  generateReferenceId,
} from './client.js';

// Checkout
export { createCheckoutSession, queryPaymentStatus } from './checkout.js';

// Webhook + response parsing
export {
  verifyWebhookAuthHeader,
  parseHppResponse,
  mapStatus,
  buildNotifyUrl,
} from './webhook.js';
