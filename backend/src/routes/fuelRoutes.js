/**
 * Fuel Routes — gas station mode.
 *
 * All routes require authentication + tenant scoping.
 * Cashiers can read types/settings + record transactions;
 * managers+ can manage types and settings.
 */

import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  getFuelTypes,
  createFuelType,
  updateFuelType,
  deleteFuelType,
  getFuelSettings,
  updateFuelSettings,
  listFuelTransactions,
  getFuelReport,
  getFuelDashboard,
} from '../controllers/fuelController.js';

const router = express.Router();

router.use(protect);
router.use(scopeToTenant);

const readRoles  = authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store');
const writeRoles = authorize('superadmin', 'admin', 'owner', 'manager');

// ─── Types ────────────────────────────────────────────────────────────────────
router.get('/types',         readRoles,  getFuelTypes);
router.post('/types',        writeRoles, createFuelType);
router.put('/types/:id',     writeRoles, updateFuelType);
router.delete('/types/:id',  writeRoles, deleteFuelType);

// ─── Settings ─────────────────────────────────────────────────────────────────
router.get('/settings',  readRoles,  getFuelSettings);
router.put('/settings',  writeRoles, updateFuelSettings);

// ─── Transactions / Reports ───────────────────────────────────────────────────
router.get('/transactions', readRoles,  listFuelTransactions);
router.get('/report',       writeRoles, getFuelReport);
router.get('/dashboard',    writeRoles, getFuelDashboard);

export default router;
