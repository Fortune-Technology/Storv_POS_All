/**
 * Lottery reporting — public API barrel.
 *
 * Mirrors the dejavoo/{hpp,spin}/index.ts pattern: callers that want the
 * full surface should import this barrel; callers that only need one
 * function (e.g. just `bestEffortDailySales`) can import it directly from
 * `./realSales.js` for clearer dependency hints.
 *
 * This module owns the THREE-tier ticket-math fallback used by every
 * surface that reports "instant lottery sales":
 *   - Daily inventory (`getDailyLotteryInventory`)
 *   - Dashboard / Reports / Commission (`getLotteryDashboard`, etc.)
 *   - Weekly settlement engine
 *   - Shift reconciliation (this is the new consumer)
 *
 * One source of truth = no risk of two surfaces showing different sales
 * for the same period.
 */

export type {
  SalesSource,
  RangeSalesSource,
  BoxSale,
  GameSale,
  DailySalesResult,
  SnapshotSalesResult,
  RangeSalesArgs,
  RangeSalesResult,
  DailySalesArgs,
  BestEffortArgs,
  WindowSalesResult,
} from './types.js';

export {
  snapshotSales,
  liveSalesFromCurrentTickets,
  bestEffortDailySales,
  rangeSales,
  windowSales,
} from './realSales.js';
