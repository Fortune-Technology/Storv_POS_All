/**
 * POS Terminal Routes  —  /api/pos-terminal
 * Used exclusively by the cashier-app frontend.
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { requireTenant } from '../middleware/scopeToTenant.js';
import { pinLimiter } from '../middleware/rateLimit.js';
import {
  getCatalogSnapshot,
  getDepositRules,
  getTaxRules,
  createTransaction,
  batchCreateTransactions,
  getTransaction,
  listTransactions,
  voidTransaction,
  createRefund,
  createOpenRefund,
  getEndOfDayReport,
  clockEvent,
  getClockStatus,
  getPosBranding,
  getPOSConfig,
  savePOSConfig,
  printNetworkReceipt,
  printNetworkLabel,
  logPosEvent,
  listPosEvents,
} from '../controllers/posTerminalController.js';
import {
  registerStation,
  verifyStation,
  pinLogin,
} from '../controllers/stationController.js';
import {
  getActiveShift,
  openShift,
  closeShift,
  addCashDrop,
  addPayout,
  getShiftReport,
  listShifts,
  listPayouts,
  listCashDrops,
  updateShiftBalance,
} from '../controllers/shiftController.js';
import { getVendors } from '../controllers/catalogController.js';

const router = Router();

// All routes require auth — cashier, manager, owner, admin all permitted
const guard = [protect, requireTenant, authorize('cashier', 'manager', 'owner', 'admin', 'superadmin')];

// Catalog sync
router.get('/catalog/snapshot',          ...guard, getCatalogSnapshot);
router.get('/deposit-rules',             ...guard, getDepositRules);
router.get('/tax-rules',                 ...guard, getTaxRules);

// Transactions — list, create, batch, get, void, refund
router.get('/transactions',                  ...guard, listTransactions);
router.post('/transactions',                 ...guard, createTransaction);
router.post('/transactions/batch',           ...guard, batchCreateTransactions);
router.post('/transactions/open-refund',     ...guard, createOpenRefund);   // no-receipt refund (before /:id)
router.get('/transactions/:id',              ...guard, getTransaction);
router.post('/transactions/:id/void',        ...guard, voidTransaction);
router.post('/transactions/:id/refund',      ...guard, createRefund);

// Reports
router.get('/reports/end-of-day',        ...guard, getEndOfDayReport);

// Clock in / out (no JWT — uses station token + PIN, rate-limited to block brute force)
router.post('/clock',                    pinLimiter, clockEvent);
router.get('/clock/status',              ...guard, getClockStatus);

router.get('/branding', ...guard, getPosBranding);

// POS layout config
router.get('/config',  ...guard, getPOSConfig);
router.put('/config',  ...guard, savePOSConfig);

// Network printer proxy — forwards base64 ESC/POS data to TCP socket
router.post('/print-network', ...guard, printNetworkReceipt);

// Zebra label printer — sends ZPL (plain text) to network label printer
router.post('/print-label', ...guard, printNetworkLabel);

// Station management
router.post('/station-register', ...guard, registerStation);
router.get('/station-verify',    verifyStation);
router.post('/pin-login',        pinLimiter, pinLogin);

// Vendors list (for paid-out dropdown)
router.get('/vendors',           ...guard, getVendors);

// Cash Drawer / Shift management
router.get('/shift/active',      ...guard, getActiveShift);
router.post('/shift/open',       ...guard, openShift);
router.get('/shifts',            ...guard, listShifts);
router.post('/shift/:id/close',  ...guard, closeShift);
router.post('/shift/:id/drop',   ...guard, addCashDrop);
router.post('/shift/:id/payout', ...guard, addPayout);
router.get('/shift/:id/report',  ...guard, getShiftReport);
router.put('/shift/:id/balance', ...guard, updateShiftBalance);

// Payout & Cash Drop reporting (back-office)
router.get('/payouts',           ...guard, listPayouts);
router.get('/cash-drops',        ...guard, listCashDrops);

// POS Business Event Log (No Sale, manager overrides, etc.)
router.post('/events',           ...guard, logPosEvent);
router.get('/events',            ...guard, listPosEvents);

export default router;
