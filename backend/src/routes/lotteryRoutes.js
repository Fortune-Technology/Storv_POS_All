/**
 * Lottery Routes
 *
 * All routes require authentication + tenant scoping.
 * Cashiers can record transactions; managers+ can manage games/boxes.
 */

import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  // Games
  getLotteryGames,
  createLotteryGame,
  updateLotteryGame,
  deleteLotteryGame,
  // Boxes
  getLotteryBoxes,
  receiveBoxOrder,
  activateBox,
  updateBox,
  deleteBox,
  // Transactions
  getLotteryTransactions,
  createLotteryTransaction,
  bulkCreateLotteryTransactions,
  // Shift reports
  getLotteryShiftReport,
  saveLotteryShiftReport,
  getShiftReports,
  // Dashboard + analytics
  getLotteryDashboard,
  getLotteryReport,
  getLotteryCommissionReport,
  // Settings
  getLotterySettings,
  updateLotterySettings,
} from '../controllers/lotteryController.js';

const router = express.Router();

router.use(protect);
router.use(scopeToTenant);

// ─── Games ────────────────────────────────────────────────────────────────────
router.get('/games',       authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getLotteryGames);
router.post('/games',      authorize('superadmin', 'admin', 'owner', 'manager'), createLotteryGame);
router.put('/games/:id',   authorize('superadmin', 'admin', 'owner', 'manager'), updateLotteryGame);
router.delete('/games/:id',authorize('superadmin', 'admin', 'owner'), deleteLotteryGame);

// ─── Boxes / Inventory ────────────────────────────────────────────────────────
router.get('/boxes',             authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getLotteryBoxes);
router.post('/boxes/receive',    authorize('superadmin', 'admin', 'owner', 'manager'), receiveBoxOrder);
router.put('/boxes/:id/activate',authorize('superadmin', 'admin', 'owner', 'manager'), activateBox);
router.put('/boxes/:id',         authorize('superadmin', 'admin', 'owner', 'manager'), updateBox);
router.delete('/boxes/:id',      authorize('superadmin', 'admin', 'owner', 'manager'), deleteBox);

// ─── Transactions ─────────────────────────────────────────────────────────────
router.get('/transactions',       authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getLotteryTransactions);
router.post('/transactions',      authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), createLotteryTransaction);
router.post('/transactions/bulk', authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), bulkCreateLotteryTransactions);

// ─── Shift Reports ────────────────────────────────────────────────────────────
router.get('/shift-reports',         authorize('superadmin', 'admin', 'owner', 'manager'), getShiftReports);
router.get('/shift-reports/:shiftId',authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), getLotteryShiftReport);
router.post('/shift-reports',        authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'), saveLotteryShiftReport);

// ─── Analytics ────────────────────────────────────────────────────────────────
router.get('/dashboard',   authorize('superadmin', 'admin', 'owner', 'manager'), getLotteryDashboard);
router.get('/report',      authorize('superadmin', 'admin', 'owner', 'manager'), getLotteryReport);
router.get('/commission',  authorize('superadmin', 'admin', 'owner', 'manager'), getLotteryCommissionReport);

// ─── Settings ─────────────────────────────────────────────────────────────────
router.get('/settings',  authorize('superadmin', 'admin', 'owner', 'manager'), getLotterySettings);
router.put('/settings',  authorize('superadmin', 'admin', 'owner', 'manager'), updateLotterySettings);

export default router;
