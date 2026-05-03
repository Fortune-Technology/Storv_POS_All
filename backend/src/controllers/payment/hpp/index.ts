/**
 * HPP — public API barrel.
 *
 * Re-exports every public handler from the sub-modules so callers can do:
 *   import { dejavooHppWebhook } from 'controllers/payment/hpp/index.js'
 *   import { dejavooHppWebhook } from 'controllers/dejavooHppController.js' ← legacy shim
 */

// Internal: ecom-backend → pos-backend (X-Internal-Api-Key)
export { dejavooHppCreateSession } from './createSession.js';

// Public: iPOSpays → pos-backend (Authorization-header verified)
export { dejavooHppWebhook } from './webhook.js';

// Admin-only: superadmin manages the per-store webhook secret
export { regenerateHppWebhookSecret, getHppWebhookUrl } from './admin.js';
