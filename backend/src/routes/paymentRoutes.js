/**
 * paymentRoutes.js
 *
 * CardPointe in-store payment integration + legacy PAX fallback.
 *
 * Auth levels:
 *   cashier+ = any logged-in POS user (PIN auth via station token)
 *   manager+ = role: manager | admin | superadmin
 */

import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  // CardPointe — terminal charge flow
  cpCharge,
  cpSignature,
  cpVoid,
  cpRefund,
  cpCancel,
  cpInquire,
  linkPaymentTx,
  ecomCharge,
  // Merchant credentials
  getMerchant,
  saveMerchant,
  // Terminal CRUD
  listTerminals,
  createTerminal,
  updateTerminal,
  deleteTerminal,
  pingTerminal,
  // Payment settings
  getPaymentSettings,
  savePaymentSettings,
  // Payment transaction list
  listPaymentTransactions,
  // Hardware config (receipt printer / drawer / scale)
  getHardwareConfig,
  saveHardwareConfig,
  // Legacy PAX (backward compat)
  paxSale,
  paxVoid,
  paxRefund,
  paxTest,
} from '../controllers/paymentController.js';

const router = express.Router();

// ── CardPointe — terminal operations (cashier+) ───────────────────────────
router.post('/cp/charge',    protect, scopeToTenant, cpCharge);
router.post('/cp/signature', protect, scopeToTenant, cpSignature);
router.post('/cp/void',      protect, scopeToTenant, cpVoid);
router.post('/cp/refund',    protect, scopeToTenant, cpRefund);
router.post('/cp/cancel',    protect, scopeToTenant, cpCancel);
router.get( '/cp/inquire/:retref', protect, scopeToTenant, cpInquire);
router.patch('/cp/link',     protect, scopeToTenant, linkPaymentTx);

// ── Ecommerce online charge (service-to-service, no JWT) ─────────────────
router.post('/ecom/charge', ecomCharge);

// ── CardPointe — merchant credentials (superadmin only) ──────────────────
router.get( '/merchant',     protect, authorize('superadmin'), scopeToTenant, getMerchant);
router.put( '/merchant',     protect, authorize('superadmin'), scopeToTenant, saveMerchant);

// ── CardPointe — terminal management (superadmin only) ────────────────────
router.get(   '/terminals',      protect, authorize('superadmin'), scopeToTenant, listTerminals);
router.post(  '/terminals',      protect, authorize('superadmin'), scopeToTenant, createTerminal);
router.put(   '/terminals/:id',  protect, authorize('superadmin'), scopeToTenant, updateTerminal);
router.delete('/terminals/:id',  protect, authorize('superadmin'), scopeToTenant, deleteTerminal);
router.post(  '/terminals/:id/ping', protect, authorize('superadmin'), scopeToTenant, pingTerminal);

// ── Payment settings (read: cashier+, write: superadmin only) ───────────────
router.get('/settings/:storeId', protect, scopeToTenant, getPaymentSettings);
router.put('/settings/:storeId', protect, authorize('superadmin'), scopeToTenant, savePaymentSettings);

// ── Payment transaction history (manager+) ────────────────────────────────
router.get('/transactions', protect, authorize('manager', 'admin', 'superadmin'), scopeToTenant, listPaymentTransactions);

// ── Hardware config (receipt printer / cash drawer / scale) ──────────────
router.get( '/hardware/:stationId', protect, scopeToTenant, getHardwareConfig);
router.post('/hardware',            protect, scopeToTenant, saveHardwareConfig);

// ── Legacy PAX POSLINK (backward compat) ─────────────────────────────────
router.post('/pax/sale',   protect, scopeToTenant, paxSale);
router.post('/pax/void',   protect, scopeToTenant, paxVoid);
router.post('/pax/refund', protect, scopeToTenant, paxRefund);
router.post('/pax/test',   protect, scopeToTenant, paxTest);

export default router;
