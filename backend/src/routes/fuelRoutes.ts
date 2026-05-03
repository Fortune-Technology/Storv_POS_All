/**
 * Fuel Routes — gas station mode.
 *
 * Permissions:
 *   fuel.view   — list types/settings/transactions (cashier+)
 *   fuel.create — record a fuel sale (cashier+)
 *   fuel.edit   — manage types/settings (manager+)
 *   fuel.delete — remove types (manager+)
 */

import express from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  getFuelTypes, createFuelType, updateFuelType, deleteFuelType,
  getFuelSettings, updateFuelSettings,
  listFuelTransactions, getFuelReport, getFuelDashboard,
  listFuelTanks, createFuelTank, updateFuelTank, deleteFuelTank,
  listManifoldGroups, createManifoldGroup, updateManifoldGroup, deleteManifoldGroup,
  listDeliveries, createDelivery, deleteDelivery,
  listStickReadings, createStickReading, deleteStickReading,
  listBlendConfigs, upsertBlendConfig, deleteBlendConfig,
  getInventoryStatus, getFuelPnlReport,
  listFuelPumps, createFuelPump, updateFuelPump, deleteFuelPump,
  listRecentFuelSales,
} from '../controllers/fuelController.js';

const router = express.Router();
router.use(protect);
router.use(scopeToTenant);

// Types
router.get(   '/types',        requirePermission('fuel.view'),   getFuelTypes);
router.post(  '/types',        requirePermission('fuel.create'), createFuelType);
router.put(   '/types/:id',    requirePermission('fuel.edit'),   updateFuelType);
router.delete('/types/:id',    requirePermission('fuel.delete'), deleteFuelType);

// Settings
router.get('/settings', requirePermission('fuel.view'), getFuelSettings);
router.put('/settings', requirePermission('fuel.edit'), updateFuelSettings);

// Transactions / Reports
router.get('/transactions', requirePermission('fuel.view'), listFuelTransactions);
router.get('/report',       requirePermission('fuel.edit'), getFuelReport);
router.get('/dashboard',    requirePermission('fuel.edit'), getFuelDashboard);

// Tanks
router.get(   '/tanks',     requirePermission('fuel.view'),   listFuelTanks);
router.post(  '/tanks',     requirePermission('fuel.create'), createFuelTank);
router.put(   '/tanks/:id', requirePermission('fuel.edit'),   updateFuelTank);
router.delete('/tanks/:id', requirePermission('fuel.delete'), deleteFuelTank);

// Manifold Groups
router.get(   '/manifold-groups',     requirePermission('fuel.view'),   listManifoldGroups);
router.post(  '/manifold-groups',     requirePermission('fuel.create'), createManifoldGroup);
router.put(   '/manifold-groups/:id', requirePermission('fuel.edit'),   updateManifoldGroup);
router.delete('/manifold-groups/:id', requirePermission('fuel.delete'), deleteManifoldGroup);

// Deliveries
router.get(   '/deliveries',     requirePermission('fuel.view'),   listDeliveries);
router.post(  '/deliveries',     requirePermission('fuel.create'), createDelivery);
router.delete('/deliveries/:id', requirePermission('fuel.delete'), deleteDelivery);

// Stick Readings
router.get(   '/stick-readings',     requirePermission('fuel.view'),   listStickReadings);
router.post(  '/stick-readings',     requirePermission('fuel.create'), createStickReading);
router.delete('/stick-readings/:id', requirePermission('fuel.delete'), deleteStickReading);

// Blend Configs
router.get(   '/blend-configs',     requirePermission('fuel.view'),   listBlendConfigs);
router.post(  '/blend-configs',     requirePermission('fuel.edit'),   upsertBlendConfig);
router.delete('/blend-configs/:id', requirePermission('fuel.delete'), deleteBlendConfig);

// Inventory status + P&L report
router.get('/inventory-status', requirePermission('fuel.view'), getInventoryStatus);
router.get('/pnl-report',       requirePermission('fuel.view'), getFuelPnlReport);

// Fuel Pumps (V1.5)
router.get(   '/pumps',     requirePermission('fuel.view'),   listFuelPumps);
router.post(  '/pumps',     requirePermission('fuel.create'), createFuelPump);
router.put(   '/pumps/:id', requirePermission('fuel.edit'),   updateFuelPump);
router.delete('/pumps/:id', requirePermission('fuel.delete'), deleteFuelPump);

// Recent fuel sales — powers the pump-aware refund picker
router.get('/recent-sales', requirePermission('fuel.view'), listRecentFuelSales);

export default router;
