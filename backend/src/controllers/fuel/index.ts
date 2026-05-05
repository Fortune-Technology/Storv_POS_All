/**
 * controllers/fuel/index.ts
 *
 * Barrel — re-exports every public handler from the fuel/* per-domain
 * modules. Pattern matches controllers/sales/ and controllers/shift/ from
 * S53. The original fuelController.ts is now a 1-line shim that re-exports
 * from this barrel, so every existing `import { handler } from
 * '../controllers/fuelController.js'` keeps resolving unchanged.
 *
 * Domain layout (S80 Refactor Pass D):
 *   helpers          — getOrgId, getStore, num, FifoLayer (shared types)
 *   types            — FuelType CRUD (4 handlers)
 *   settings         — FuelSettings get + upsert (2 handlers)
 *   transactions     — listFuelTransactions + listRecentFuelSales (2 handlers)
 *   reports          — getFuelReport + getFuelDashboard (2 handlers)
 *   tanks            — FuelTank CRUD (4 handlers)
 *   manifoldGroups   — FuelManifoldGroup CRUD (4 handlers)
 *   deliveries       — FuelDelivery CRUD with FIFO + variance (3 handlers)
 *   stickReadings    — FuelStickReading CRUD (3 handlers)
 *   blendConfigs     — FuelBlendConfig CRUD (3 handlers)
 *   inventoryStatus  — Reconciliation tab dashboard (1 handler)
 *   pnlReport        — Time-granular FIFO P&L (1 handler)
 *   pumps            — FuelPump CRUD (4 handlers)
 */

// Types (4)
export { getFuelTypes, createFuelType, updateFuelType, deleteFuelType } from './types.js';

// Settings (2)
export { getFuelSettings, updateFuelSettings } from './settings.js';

// Transactions (2)
export { listFuelTransactions, listRecentFuelSales } from './transactions.js';

// Reports (2)
export { getFuelReport, getFuelDashboard } from './reports.js';

// Tanks (4)
export { listFuelTanks, createFuelTank, updateFuelTank, deleteFuelTank } from './tanks.js';

// Manifold Groups (4)
export { listManifoldGroups, createManifoldGroup, updateManifoldGroup, deleteManifoldGroup } from './manifoldGroups.js';

// Deliveries (3)
export { listDeliveries, createDelivery, deleteDelivery } from './deliveries.js';

// Stick Readings (3)
export { listStickReadings, createStickReading, deleteStickReading } from './stickReadings.js';

// Blend Configs (3)
export { listBlendConfigs, upsertBlendConfig, deleteBlendConfig } from './blendConfigs.js';

// Inventory Status (1)
export { getInventoryStatus } from './inventoryStatus.js';

// P&L Report (1)
export { getFuelPnlReport } from './pnlReport.js';

// Pumps (4)
export { listFuelPumps, createFuelPump, updateFuelPump, deleteFuelPump } from './pumps.js';
