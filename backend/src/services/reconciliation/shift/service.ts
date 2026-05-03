/**
 * Shift reconciliation — orchestrator.
 *
 * The single entry point both `closeShift` and `getEndOfDayReport` call.
 * Loads every input from the DB then hands off to the pure compute step.
 *
 * `closingAmount` is optional:
 *   - omitted → returns the reconciliation as a "preview" with variance = null
 *   - supplied → variance is computed against that counted amount
 *
 * `closeShift` calls this twice in effect: first as a preview to decide
 * what to persist on the Shift row, then implicitly with the cashier's
 * counted amount.
 */

import {
  loadShift,
  readCashFlowsFromTransactions,
  readPayoutBuckets,
  readLotteryShiftRaw,
} from './queries.js';
import { computeShiftReconciliation } from './compute.js';
import type { ShiftReconciliation } from './types.js';

export interface ReconcileShiftArgs {
  shiftId: string;
  /** Cashier-counted closing amount. Omit for preview. */
  closingAmount?: number | null;
  /**
   * Override for window end. Defaults to `shift.closedAt` (if closed) or
   * `now` (if open). closeShift passes `now` because we're reconciling at
   * the moment of close, before we've written `closedAt`.
   */
  windowEnd?: Date;
  /**
   * S67 — when true, lottery cash flow is excluded from `expectedDrawer`
   * so the drawer reconciliation reflects business cash only. Lottery
   * detail stays available on `lotteryCashFlow` for separate rendering.
   * Default false (preserves S44/S61 behavior).
   */
  lotterySeparateFromDrawer?: boolean;
}

export async function reconcileShift(args: ReconcileShiftArgs): Promise<ShiftReconciliation> {
  const { shiftId, closingAmount = null, windowEnd, lotterySeparateFromDrawer = false } = args;

  const shift = await loadShift(shiftId);
  const start = shift.openedAt;
  const end = windowEnd ?? shift.closedAt ?? new Date();

  // Parallel reads — none of these depend on each other
  const [cash, payouts, lottery] = await Promise.all([
    readCashFlowsFromTransactions({
      orgId: shift.orgId,
      storeId: shift.storeId,
      windowStart: start,
      windowEnd: end,
    }),
    readPayoutBuckets({
      shiftId,
      orgId: shift.orgId,
      storeId: shift.storeId,
      windowStart: start,
      windowEnd: end,
    }),
    readLotteryShiftRaw({
      orgId: shift.orgId,
      storeId: shift.storeId,
      windowStart: start,
      windowEnd: end,
    }),
  ]);

  return computeShiftReconciliation({
    shift,
    cash,
    payouts,
    lottery,
    closingAmount,
    lotterySeparateFromDrawer,
  });
}
