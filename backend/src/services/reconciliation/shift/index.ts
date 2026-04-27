/**
 * Shift reconciliation — public API barrel.
 *
 * Mirrors the dejavoo/{hpp,spin}/index.ts pattern. Callers that want the
 * full surface should import this barrel; callers that only need the
 * orchestrator should prefer `./service.js` for clearer dependency hints.
 *
 *   import { reconcileShift } from '../services/reconciliation/shift/index.js';
 *
 * Single source of truth for cash-drawer expectation math, including
 * lottery cash flow (Session 45 / Round-2 fix).
 */

// Public types
export type {
  ShiftReconciliation,
  LotteryCashFlow,
  ReconciliationLine,
} from './types.js';

// Orchestrator (loads queries → compute)
export { reconcileShift } from './service.js';

// Pure compute (DI-friendly — testable with raw inputs, no DB)
export { computeShiftReconciliation } from './compute.js';
export type { ComputeArgs } from './compute.js';

// Sub-readers — exported for tests + cases where one slice is needed
export {
  loadShift,
  readCashFlowsFromTransactions,
  readPayoutBuckets,
  readLotteryShiftRaw,
} from './queries.js';
