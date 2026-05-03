/**
 * Shared types for the lottery reporting service.
 *
 * These were previously defined inline in lotteryController.ts. Moving them
 * here so they can be imported by both the controller and the new
 * reconciliation service without duplication.
 */

export type SalesSource = 'snapshot' | 'live' | 'pos_fallback' | 'empty';
export type RangeSalesSource = SalesSource | 'mixed';

/** Per-box ticket-math result for a day or window. */
export interface BoxSale {
  sold: number;
  price: number;
  amount: number;
}

/** Per-game roll-up. */
export interface GameSale {
  sales: number;
  count: number;
}

/** Result of {@link bestEffortDailySales}. */
export interface DailySalesResult {
  totalSales: number;
  byBox: Map<string, BoxSale>;
  byGame: Map<string, GameSale>;
  source: SalesSource;
}

/** Result of {@link snapshotSales} — only the snapshot tier; no fallback. */
export interface SnapshotSalesResult {
  totalSales: number;
  byBox: Map<string, BoxSale>;
}

export interface RangeSalesArgs {
  orgId: string;
  storeId: string;
  /** UTC start (inclusive). */
  from: Date;
  /** UTC end (inclusive). */
  to: Date;
}

export interface RangeSalesResult {
  totalSales: number;
  byDay: Array<{ date: string; sales: number; source: SalesSource }>;
  byGame: Map<string, GameSale>;
  source: RangeSalesSource;
}

export interface DailySalesArgs {
  orgId: string;
  storeId: string;
  /** UTC midnight of the target day. */
  dayStart: Date;
  /** UTC 23:59:59.999 of the target day. */
  dayEnd: Date;
}

export interface BestEffortArgs extends DailySalesArgs {
  /**
   * When true, the helper will fall back to live `box.currentTicket` deltas
   * vs. yesterday's snapshot (Tier 2). Used for in-progress sales BEFORE
   * the EoD wizard has run.
   */
  isToday?: boolean;
}

/**
 * Window-scoped (e.g. shift-window) sales — the building block for the
 * shift reconciliation service. Same shape as DailySalesResult so callers
 * can swap day↔window without re-keying.
 */
export type WindowSalesResult = DailySalesResult;
