/**
 * Sales — revenue + transaction analytics services.
 *
 *   sales.ts      — main analytics aggregator: getDailySales, getWeeklySales,
 *                   getMonthlySales, getDepartmentSales, getTopProducts,
 *                   getProductsGrouped, getProductMovement, etc. Backs
 *                   `controllers/sales/*` and the Live Dashboard.
 *   dailySale.ts  — back-office daily-sale entry service (manual sale entries
 *                   for stores that don't run the POS for every transaction).
 *
 * Note: this folder is the SERVICE-side counterpart to `controllers/sales/`
 * (Session 53 controller split). Same domain, different layer.
 */

export * from './sales.js';
export * from './dailySale.js';
