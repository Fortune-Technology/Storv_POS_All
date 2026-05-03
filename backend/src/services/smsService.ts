/**
 * smsService.ts — backward-compat shim.
 *
 * Implementation lives in `./notifications/sms.ts` (Session 55 service-layer
 * domain refactor). This file exists so existing imports keep working:
 *   import { sendInvitationSms } from '../services/smsService.js';
 *
 * New code should prefer `./notifications/sms.js` directly.
 */

export * from './notifications/sms.js';
