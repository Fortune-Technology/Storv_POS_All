/**
 * emailService.ts — backward-compat shim.
 *
 * Implementation lives in `./notifications/email.ts` (Session 55 service-layer
 * domain refactor). This file exists so existing imports keep working:
 *   import { sendInvitation } from '../services/emailService.js';
 *
 * New code should prefer `./notifications/email.js` directly, or the barrel
 * at `./notifications/index.js` which also re-exports the SMS service.
 */

export * from './notifications/email.js';
