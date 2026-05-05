/**
 * Lottery Routes
 *
 * Permissions (all require auth + tenant scope):
 *   lottery.view    — list games/boxes/tx/reports (cashier+)
 *   lottery.create  — record a lottery sale/payout (cashier+)
 *   lottery.edit    — update games/boxes/settings (manager+)
 *   lottery.delete  — remove games/boxes (manager+)
 *   lottery.manage  — shift reports, commission, catalog admin (manager+ / admin)
 */

import express from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  getLotteryGames, createLotteryGame, updateLotteryGame, deleteLotteryGame,
  getLotteryBoxes, receiveBoxOrder, activateBox, updateBox, deleteBox, adjustBoxTickets,
  getLotteryTransactions, createLotteryTransaction, bulkCreateLotteryTransactions,
  getLotteryShiftReport, saveLotteryShiftReport, getShiftReports, getShiftAudit, getPreviousShiftReadings,
  getLotteryDashboard, getLotteryReport, getLotteryCommissionReport,
  getLotterySettings, updateLotterySettings,
  getCatalogTickets, getAllCatalogTickets, createCatalogTicket, updateCatalogTicket, deleteCatalogTicket,
  getTicketRequests, createTicketRequest, reviewTicketRequest, getPendingRequestCount,
  receiveFromCatalog,
  scanLotteryBarcode, parseLotteryScan, moveBoxToSafe, markBoxSoldout, restoreBoxToCounter, returnBoxToLotto,
  cancelPendingMove, runPendingMovesNow,
  getLotteryOnlineTotal, upsertLotteryOnlineTotal,
  getDailyLotteryInventory, getYesterdayCloses, getCounterSnapshot,
  upsertHistoricalClose,
  listLotterySettlements, getLotterySettlement,
  upsertLotterySettlement, finalizeLotterySettlement, markLotterySettlementPaid,
  syncLotteryCatalog,
} from '../controllers/lotteryController.js';

const router = express.Router();
router.use(protect);
router.use(scopeToTenant);

// Games
router.get(   '/games',       requirePermission('lottery.view'),   getLotteryGames);
router.post(  '/games',       requirePermission('lottery.create'), createLotteryGame);
router.put(   '/games/:id',   requirePermission('lottery.edit'),   updateLotteryGame);
router.delete('/games/:id',   requirePermission('lottery.delete'), deleteLotteryGame);

// Boxes
router.get(   '/boxes',              requirePermission('lottery.view'),   getLotteryBoxes);
router.post(  '/boxes/receive',      requirePermission('lottery.manage'), receiveBoxOrder);
router.put(   '/boxes/:id/activate', requirePermission('lottery.manage'), activateBox);
router.post(  '/boxes/:id/adjust',   requirePermission('lottery.manage'), adjustBoxTickets);
router.put(   '/boxes/:id',          requirePermission('lottery.edit'),   updateBox);
router.delete('/boxes/:id',          requirePermission('lottery.delete'), deleteBox);

// Transactions
router.get( '/transactions',       requirePermission('lottery.view'),   getLotteryTransactions);
router.post('/transactions',       requirePermission('lottery.create'), createLotteryTransaction);
router.post('/transactions/bulk',  requirePermission('lottery.create'), bulkCreateLotteryTransactions);

// Shift reports
router.get( '/shift-reports',          requirePermission('lottery.manage'), getShiftReports);
router.get( '/shift-audit',            requirePermission('lottery.manage'), getShiftAudit);
router.get( '/previous-shift-readings', requirePermission('lottery.view'),  getPreviousShiftReadings);
router.get( '/shift-reports/:shiftId', requirePermission('lottery.view'),   getLotteryShiftReport);
router.post('/shift-reports',          requirePermission('lottery.manage'), saveLotteryShiftReport);

// Analytics
router.get('/dashboard',  requirePermission('lottery.manage'), getLotteryDashboard);
router.get('/report',     requirePermission('lottery.manage'), getLotteryReport);
router.get('/commission', requirePermission('lottery.manage'), getLotteryCommissionReport);

// Settings
router.get('/settings', requirePermission('lottery.view'), getLotterySettings);
router.put('/settings', requirePermission('lottery.edit'), updateLotterySettings);

// Ticket catalog (admin-scope — superadmin bypass keeps this available to platform admins)
router.get(   '/catalog',         requirePermission('lottery.view'),   getCatalogTickets);
router.get(   '/catalog/all',     requirePermission('lottery.manage'), getAllCatalogTickets);
router.post(  '/catalog',         requirePermission('lottery.manage'), createCatalogTicket);
router.put(   '/catalog/:id',     requirePermission('lottery.manage'), updateCatalogTicket);
router.delete('/catalog/:id',     requirePermission('lottery.manage'), deleteCatalogTicket);

// Ticket Requests
router.get( '/ticket-requests',               requirePermission('lottery.view'),   getTicketRequests);
router.get( '/ticket-requests/pending-count', requirePermission('lottery.manage'), getPendingRequestCount);
router.post('/ticket-requests',               requirePermission('lottery.create'), createTicketRequest);
router.put( '/ticket-requests/:id/review',    requirePermission('lottery.manage'), reviewTicketRequest);

// Receive from Catalog
router.post('/boxes/receive-catalog', requirePermission('lottery.manage'), receiveFromCatalog);

// ── Phase 1a: Scan + Location actions ───────────────────────────────────
// Scan a ticket/book barcode and let the engine decide whether to activate,
// update currentTicket, or auto-soldout an old book.
router.post('/scan', requirePermission('lottery.manage'), scanLotteryBarcode);

// Parse-only: decode a barcode via the state adapters WITHOUT a DB lookup.
// Used by the Receive Books scan flow where we intentionally want new books
// (which don't exist in inventory yet) to parse successfully.
router.post('/scan/parse', requirePermission('lottery.manage'), parseLotteryScan);

// Book lifecycle actions (context menu on Counter/Safe/Soldout tabs)
router.post(  '/boxes/:id/move-to-safe',     requirePermission('lottery.manage'), moveBoxToSafe);
router.post(  '/boxes/:id/soldout',          requirePermission('lottery.manage'), markBoxSoldout);
// Undo a soldout — flips back to active, restores currentTicket to its
// pre-soldout position (read from prior close_day_snapshot), neutralises
// the inflated soldout-day sales via a correction snapshot.
router.post(  '/boxes/:id/restore-to-counter', requirePermission('lottery.manage'), restoreBoxToCounter);
router.post(  '/boxes/:id/return-to-lotto',  requirePermission('lottery.manage'), returnBoxToLotto);
router.delete('/boxes/:id/pending-move',     requirePermission('lottery.manage'), cancelPendingMove);

// On-demand pending-move sweep — called by "Close the Day"
router.post('/run-pending-moves', requirePermission('lottery.manage'), runPendingMovesNow);

// ── Phase 1b: Daily Scan + Online Totals ─────────────────────────────────
// May 2026 — `/close-day` route removed. Pending-move sweep runs every 15
// min via `startPendingMoveScheduler` (server.ts), and per-book snapshots
// are written by the cashier-app EoD wizard's saveLotteryShiftReport. The
// manual button was redundant + caused duplicate snapshots when admins
// clicked it multiple times.
router.get( '/online-total',    requirePermission('lottery.view'),   getLotteryOnlineTotal);
router.put( '/online-total',    requirePermission('lottery.manage'), upsertLotteryOnlineTotal);
router.get( '/daily-inventory', requirePermission('lottery.view'),   getDailyLotteryInventory);
// April 2026: per-box previous-close snapshot map for the Daily page's
// "yesterday" column. Driven by close_day_snapshot LotteryScanEvent rows.
router.get( '/yesterday-closes', requirePermission('lottery.view'), getYesterdayCloses);
// Date-scoped Counter view — which books were on the counter on a given
// date plus their opening/closing ticket snapshots for historical browsing.
router.get( '/counter-snapshot', requirePermission('lottery.view'), getCounterSnapshot);
// Edit a historical day's close ticket (manual mode on past dates).
router.put( '/historical-close', requirePermission('lottery.manage'), upsertHistoricalClose);

// ── Phase 2: Weekly Settlement ───────────────────────────────────────────
router.get( '/settlements',                     requirePermission('lottery.view'),   listLotterySettlements);
router.get( '/settlements/:weekStart',          requirePermission('lottery.view'),   getLotterySettlement);
router.put( '/settlements/:weekStart',          requirePermission('lottery.manage'), upsertLotterySettlement);
router.post('/settlements/:weekStart/finalize', requirePermission('lottery.manage'), finalizeLotterySettlement);
router.post('/settlements/:weekStart/paid',     requirePermission('lottery.manage'), markLotterySettlementPaid);

// ── Phase 3b: Catalog sync from state lottery feeds ──────────────────────
router.post('/catalog/sync', requirePermission('lottery.manage'), syncLotteryCatalog);

export default router;
