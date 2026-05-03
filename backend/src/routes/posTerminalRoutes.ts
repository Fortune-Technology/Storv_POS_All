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
  getCatalogActiveIds,
  getDepositRules,
  getTaxRules,
  createTransaction,
  batchCreateTransactions,
  getTransaction,
  listTransactions,
  voidTransaction,
  createRefund,
  createOpenRefund,
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
  listStationsForStore,
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
router.get('/catalog/active-ids',        ...guard, getCatalogActiveIds);
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

// Reports — both `/reports/end-of-day` and `/end-of-day` point at the same
// comprehensive controller (header / payouts / tenders / transactions / fuel
// / reconciliation / totals).

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
//
// `station-register` is intentionally UNGUARDED for now: the cashier-app's
// "Reset this register" flow needs to re-pair without forcing a manager
// login each time. The endpoint enforces its own scoping (storeId must
// resolve to a real Store; orgId is derived from the Store row, not from
// any user JWT). If you can supply a valid storeId you can pair against
// it — appropriate for UAT testing on shared dev hardware.
//
// To tighten for production: re-add `...guard` and require manager-or-
// higher role. Audit-log every pair (Station has lastSeenAt; consider an
// explicit StationPairingLog model).
router.post('/station-register', registerStation);
router.get('/station-verify',    verifyStation);
router.post('/pin-login',        pinLimiter, pinLogin);

// Vendors list (for paid-out dropdown)
router.get('/vendors',           ...guard, getVendors);

// Stations — list for back-office open-shift flow
router.get('/stations',          ...guard, listStationsForStore);

// Cash Drawer / Shift management
router.get('/shift/active',      ...guard, getActiveShift);
router.post('/shift/open',       ...guard, openShift);
router.get('/shifts',            ...guard, listShifts);
router.post('/shift/:id/close',  ...guard, closeShift);
router.post('/shift/:id/drop',   ...guard, addCashDrop);
router.post('/shift/:id/payout', ...guard, addPayout);
router.get('/shift/:id/report',  ...guard, getShiftReport);
router.put('/shift/:id/balance', ...guard, updateShiftBalance);

// End-of-Day report — cashier-accessible alias (scoped to their shift by shiftId).
// Back-office uses /api/reports/end-of-day with the same controller.
import { getEndOfDayReport as _eodReport } from '../controllers/endOfDayReportController.js';
router.get('/shift/:id/eod-report', ...guard, (req, res, next) => {
  // Translate :id → ?shiftId= so the controller's resolveScope() finds it.
  req.query.shiftId = req.params.id;
  return _eodReport(req, res, next);
});
// Alternative: /pos-terminal/end-of-day?shiftId=… / ?date=… etc.
router.get('/end-of-day',         ...guard, _eodReport);
// Legacy path kept for old clients — now points at the same controller.
router.get('/reports/end-of-day', ...guard, _eodReport);

// Payout & Cash Drop reporting (back-office)
router.get('/payouts',           ...guard, listPayouts);
router.get('/cash-drops',        ...guard, listCashDrops);

// POS Business Event Log (No Sale, manager overrides, etc.)
router.post('/events',           ...guard, logPosEvent);
router.get('/events',            ...guard, listPosEvents);

export default router;
