/**
 * dejavooHppController.ts — backward-compat shim.
 *
 * The implementation lives in `./payment/hpp/` (split into 4 focused
 * modules: helpers, createSession, webhook, admin).
 *
 * This file exists so existing imports keep working without changes:
 *   import { dejavooHppWebhook } from '../controllers/dejavooHppController.js';
 *
 * New code should prefer importing from `./payment/hpp/*` for clearer
 * dependency hints.
 */

export * from './payment/hpp/index.js';
