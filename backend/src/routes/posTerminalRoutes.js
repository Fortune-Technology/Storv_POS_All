/**
 * POS Terminal Routes  —  /api/pos-terminal
 * Used exclusively by the cashier-app frontend.
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { requireTenant } from '../middleware/scopeToTenant.js';
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
  getEndOfDayReport,
  clockEvent,
  getClockStatus,
  getPosBranding,
  getPOSConfig,
  savePOSConfig,
} from '../controllers/posTerminalController.js';
import {
  registerStation,
  verifyStation,
  pinLogin,
} from '../controllers/stationController.js';

const router = Router();

// All routes require auth — cashier, manager, owner, admin all permitted
const guard = [protect, requireTenant, authorize('cashier', 'manager', 'owner', 'admin', 'superadmin')];

// Catalog sync
router.get('/catalog/snapshot',          ...guard, getCatalogSnapshot);
router.get('/deposit-rules',             ...guard, getDepositRules);
router.get('/tax-rules',                 ...guard, getTaxRules);

// Transactions — list, create, batch, get, void, refund
router.get('/transactions',              ...guard, listTransactions);
router.post('/transactions',             ...guard, createTransaction);
router.post('/transactions/batch',       ...guard, batchCreateTransactions);
router.get('/transactions/:id',          ...guard, getTransaction);
router.post('/transactions/:id/void',    ...guard, voidTransaction);
router.post('/transactions/:id/refund',  ...guard, createRefund);

// Reports
router.get('/reports/end-of-day',        ...guard, getEndOfDayReport);

// Clock in / out (no JWT — uses station token + PIN)
router.post('/clock',                    clockEvent);
router.get('/clock/status',              ...guard, getClockStatus);

router.get('/branding', ...guard, getPosBranding);

// POS layout config
router.get('/config',  ...guard, getPOSConfig);
router.put('/config',  ...guard, savePOSConfig);

// Station management
router.post('/station-register', ...guard, registerStation);
router.get('/station-verify',    verifyStation);
router.post('/pin-login',        pinLogin);

export default router;
