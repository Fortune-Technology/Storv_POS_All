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
  // B4 — per-shift ticket-math sales using bracketing snapshot events.
  shiftSales,
  // B9 — timezone-aware day-boundary helpers exported so controllers can
  // parse `from`/`to` query strings into UTC instants that respect the
  // store's IANA timezone (instead of treating dates as UTC midnight).
  formatLocalDate,
  localDayStartUTC,
  localDayEndUTC,
} from './realSales.js';
