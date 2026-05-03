/**
 * dejavooPaymentController.ts — backward-compat shim.
 *
 * The implementation lives in `./payment/posSpin/` (split into 6 focused
 * modules: helpers, transactions, ebt, control, lookup, status).
 *
 * This file exists so existing imports keep working without changes:
 *   import { dejavooSale } from '../controllers/dejavooPaymentController.js';
 *
 * New code should prefer importing from `./payment/posSpin/*` for clearer
 * dependency hints.
 */

export * from './payment/posSpin/index.js';
