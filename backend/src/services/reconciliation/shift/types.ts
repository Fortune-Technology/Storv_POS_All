/**
 * Shift reconciliation — public types.
 *
 * The reconciliation result is the single canonical shape both
 * `closeShift` (which persists it) and `getEndOfDayReport` (which displays
 * it) consume. Two surfaces, one data structure.
 */

import type { SalesSource } from '../../lottery/reporting/types.js';

/**
 * One labeled line in the breakdown ledger. The frontend renders these
 * directly without doing any math itself — order, sign, and label are
 * already correct.
 *
 * `kind` lets the UI style the row (incoming = green, outgoing = amber,
 * subtotal = bold, etc.) without parsing the label.
 */
export interface ReconciliationLine {
  key: string;
  label: string;
  amount: number;
  kind: 'opening' | 'incoming' | 'outgoing' | 'subtotal';
  /** When true the row is informational and DOESN'T affect expectedDrawer. */
  passThrough?: boolean;
  /** Optional sub-text shown under the label (e.g. count of items). */
  hint?: string;
}

/** Lottery cash flow detail — surfaced separately so the UI can render its own panel. */
export interface LotteryCashFlow {
  /** Authoritative ticket-math sales during the shift window (instant tickets). */
  ticketMathSales: number;
  /** What the cashier rang up at the POS for instant lottery sales. */
  posLotterySales: number;
  /**
   * Un-rung cash from instant ticket sales = max(0, ticketMathSales − posLotterySales).
   * Positive value = cashier sold tickets without creating a Transaction.
   * Cash IS in the drawer; we add it to expected.
   */
  unreportedCash: number;
  /** Daily LotteryOnlineTotal.machineSales summed across the shift window. */
  machineDrawSales: number;
  /** LotteryOnlineTotal.machineCashing summed across the shift window. */
  machineCashings: number;
  /** LotteryOnlineTotal.instantCashing summed across the shift window. */
  instantCashings: number;
  /** Tier-of-truth flag for `ticketMathSales`. */
  source: SalesSource;
  /** Lottery contribution to expected drawer (positive = cash in). */
  netLotteryCash: number;
}

/** Result of {@link computeShiftReconciliation}. */
export interface ShiftReconciliation {
  shiftId: string;
  storeId: string;
  orgId: string;

  // Window covered (informational)
  openedAt: Date;
  closedAt: Date | null;

  // Core POS cash flow (existing fields, unchanged shape)
  openingFloat: number;
  cashSales: number;
  cashRefunds: number;
  cashDropsTotal: number;
  cashPayoutsTotal: number;
  /** "Cash In" payouts: paid_in + received_on_acct (drawer gains). */
  cashIn: number;
  /** "Cash Out" payouts: paid_out + loans (drawer loses). */
  cashOut: number;

  // Lottery cash flow detail (NEW)
  lottery: LotteryCashFlow;

  // Final reconciliation
  /** Sum of all the above (opening + ins − outs). */
  expectedDrawer: number;
  /** What the cashier physically counted. Null until shift is closed. */
  closingAmount: number | null;
  /** counted − expected. Null until shift is closed. */
  variance: number | null;

  // Pre-rendered breakdown (the order + signs the UI should display).
  // Frontend just iterates and renders. Zero math on the client.
  lineItems: ReconciliationLine[];
}
