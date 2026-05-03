/**
 * StoreVeu Exchange Routes — B2B wholesale between stores.
 *
 * Permission model:
 *   exchange.view     — list orders, balances, partners, ledger (manager+)
 *   exchange.create   — create draft, send PO (manager+)
 *   exchange.receive  — confirm/reject incoming POs (manager+)
 *   exchange.settle   — record/accept/dispute settlements (owner+)
 *   exchange.manage   — claim store code, partner handshake, revoke (owner+)
 */

import express from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requirePermission } from '../rbac/permissionService.js';

import {
  getMyStoreCode, checkCodeAvailability, setMyStoreCode, lookupByCode,
  listPartners, sendPartnerRequest, acceptPartnerRequest, rejectPartnerRequest,
  revokePartnership, pendingIncoming, listAcceptedPartners,
} from '../controllers/exchangeController.js';

import {
  createDraftOrder, updateOrder, sendOrder, cancelOrder, rejectOrder,
  confirmOrder, listOrders, getOrder, deleteDraft,
  archiveOrder, unarchiveOrder, addDisputeMessage,
} from '../controllers/wholesaleOrderController.js';

import {
  listBalances, getLedger, recordSettlement, confirmSettlement, listSettlements,
  disputeSettlement, resolveSettlement, exchangeReport,
} from '../controllers/partnerLedgerController.js';

const router = express.Router();
router.use(protect);
router.use(scopeToTenant);

// ── Store Code ─────────────────────────────────────────────────────
router.get ('/store-code',               requirePermission('exchange.view'),   getMyStoreCode);
router.get ('/store-code/check',         requirePermission('exchange.view'),   checkCodeAvailability);
router.put ('/store-code',               requirePermission('exchange.manage'), setMyStoreCode);
router.get ('/lookup/:code',             requirePermission('exchange.view'),   lookupByCode);

// ── Trading Partners ───────────────────────────────────────────────
router.get ('/partners',                   requirePermission('exchange.view'),   listPartners);
router.get ('/partners/accepted',          requirePermission('exchange.view'),   listAcceptedPartners);
router.get ('/partners/pending-incoming',  requirePermission('exchange.view'),   pendingIncoming);
router.post('/partners',                   requirePermission('exchange.manage'), sendPartnerRequest);
router.post('/partners/:id/accept',        requirePermission('exchange.manage'), acceptPartnerRequest);
router.post('/partners/:id/reject',        requirePermission('exchange.manage'), rejectPartnerRequest);
router.post('/partners/:id/revoke',        requirePermission('exchange.manage'), revokePartnership);

// ── Wholesale Orders ───────────────────────────────────────────────
router.get   ('/orders',              requirePermission('exchange.view'),    listOrders);
router.get   ('/orders/:id',          requirePermission('exchange.view'),    getOrder);
router.post  ('/orders',              requirePermission('exchange.create'),  createDraftOrder);
router.put   ('/orders/:id',          requirePermission('exchange.create'),  updateOrder);
router.delete('/orders/:id',          requirePermission('exchange.create'),  deleteDraft);
router.post  ('/orders/:id/send',     requirePermission('exchange.create'),  sendOrder);
router.post  ('/orders/:id/cancel',   requirePermission('exchange.create'),  cancelOrder);
router.post  ('/orders/:id/reject',   requirePermission('exchange.receive'), rejectOrder);
router.post  ('/orders/:id/confirm',  requirePermission('exchange.receive'), confirmOrder);

// Session 39 — archive + multi-round dispute
router.post  ('/orders/:id/archive',          requirePermission('exchange.view'),    archiveOrder);
router.post  ('/orders/:id/unarchive',        requirePermission('exchange.view'),    unarchiveOrder);
router.post  ('/orders/:id/dispute-message',  requirePermission('exchange.view'),    addDisputeMessage);

// ── Partner Balances + Ledger ──────────────────────────────────────
router.get('/balances',                          requirePermission('exchange.view'), listBalances);
router.get('/balances/:partnerStoreId/ledger',   requirePermission('exchange.view'), getLedger);

// ── Settlements ────────────────────────────────────────────────────
router.get ('/settlements',             requirePermission('exchange.view'),   listSettlements);
router.post('/settlements',             requirePermission('exchange.settle'), recordSettlement);
router.post('/settlements/:id/confirm', requirePermission('exchange.settle'), confirmSettlement);
router.post('/settlements/:id/dispute', requirePermission('exchange.settle'), disputeSettlement);
router.post('/settlements/:id/resolve', requirePermission('exchange.settle'), resolveSettlement);

// ── Unified Report ─────────────────────────────────────────────────
router.get('/report', requirePermission('exchange.view'), exchangeReport);

export default router;
