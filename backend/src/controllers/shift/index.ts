/**
 * Shift controller — public API barrel.
 *
 * Re-exports every public handler from the sub-modules so callers can do:
 *   import { closeShift } from 'controllers/shift/index.js'
 *   import { closeShift } from 'controllers/shiftController.js'  ← legacy shim
 *
 * Both paths work. New code should prefer importing directly from
 * `./lifecycle.js` / `./movements.js` / `./reports.js` for clearer
 * dependency hints.
 *
 * Module layout:
 *   helpers.ts    — getOrgId + TenderLine type
 *   lifecycle.ts  — open / close / active / balance-adjust
 *   movements.ts  — drops + payouts (POST + back-office GET)
 *   reports.ts    — single-shift detail + multi-shift list
 */

// ─── Lifecycle (state machine: open → close, balance adjust) ─────────────
export {
  getActiveShift,
  openShift,
  closeShift,
  updateShiftBalance,
} from './lifecycle.js';

// ─── Movements (cash drops + payouts) ────────────────────────────────────
export {
  addCashDrop,
  addPayout,
  listPayouts,
  listCashDrops,
} from './movements.js';

// ─── Reports (detail + list views) ───────────────────────────────────────
export {
  getShiftReport,
  listShifts,
} from './reports.js';
