/**
 * Dejavoo Payment Routes — /api/payment/dejavoo
 *
 * All routes require JWT auth (protect middleware).
 * The cashier app calls these via its station token + JWT.
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  dejavooSale,
  dejavooRefund,
  dejavooVoid,
  dejavooEbtBalance,
  dejavooCancel,
  dejavooTerminalStatus,
  dejavooTransactionStatus,
  dejavooSettle,
  dejavooMerchantStatus,
  dejavooLookupCustomer,
  // Customer-facing display methods (cosmetic UX — failures non-fatal).
  dejavooPushCart,
  dejavooPushWelcome,
  dejavooPushThankYou,
  dejavooPushBrandedReceipt,
  dejavooClearDisplay,
} from '../controllers/dejavooPaymentController.js';

const router = Router();

// All routes require authentication
router.use(protect);

// ── Card-present transactions ────────────────────────────────────────────────
router.post('/sale',            dejavooSale);
router.post('/refund',          dejavooRefund);
router.post('/void',            dejavooVoid);

// ── EBT ──────────────────────────────────────────────────────────────────────
router.post('/ebt-balance',     dejavooEbtBalance);

// ── Customer lookup (prompts phone on terminal → local Customer search) ────
router.post('/lookup-customer', dejavooLookupCustomer);

// ── Terminal control ─────────────────────────────────────────────────────────
router.post('/cancel',          dejavooCancel);
router.post('/terminal-status', dejavooTerminalStatus);
router.post('/status',          dejavooTransactionStatus);
router.post('/settle',          dejavooSettle);

// ── Customer-facing display (cosmetic UX) ────────────────────────────────────
// Routes mounted under /display/ so the cashier-app can blanket-apply
// fire-and-forget error handling to all of them. None of these affect
// money movement — they only push display state to the customer-facing
// screen / printer on the P17.
router.post('/display/cart',     dejavooPushCart);            // live cart push
router.post('/display/welcome',  dejavooPushWelcome);         // "Welcome to <store>"
router.post('/display/thank-you', dejavooPushThankYou);       // post-sale ack
router.post('/display/receipt',  dejavooPushBrandedReceipt);  // full branded receipt
router.post('/display/clear',    dejavooClearDisplay);        // reset display

// ── Read-only status for portal (no secrets exposed) ─────────────────────────
router.get('/merchant-status',  dejavooMerchantStatus);

export default router;
