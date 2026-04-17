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

// ── Read-only status for portal (no secrets exposed) ─────────────────────────
router.get('/merchant-status',  dejavooMerchantStatus);

export default router;
