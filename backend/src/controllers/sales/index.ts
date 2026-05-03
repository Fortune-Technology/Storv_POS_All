/**
 * Sales controller — public API barrel.
 *
 * Re-exports every public handler from the sub-modules so callers can do:
 *   import { realtimeSales } from 'controllers/sales/index.js'
 *   import { realtimeSales } from 'controllers/salesController.js'  ← legacy shim
 *
 * Both paths work. New code should prefer importing directly from
 * `./aggregations.js` / `./predictions.js` etc. for clearer dependency hints.
 *
 * Module layout:
 *   helpers.ts      — date arithmetic, error formatting, shared types
 *   aggregations.ts — daily/weekly/monthly summaries, dept, products, top
 *   predictions.ts  — Holt-Winters forecasts + residual analysis + factors
 *   weather.ts      — sales × weather combined endpoints
 *   realtime.ts     — Live Dashboard (one mega-endpoint)
 *   vendorOrders.ts — legacy velocity-based reorder suggestions
 */

// ─── Aggregations ─────────────────────────────────────────────────────────
export {
  daily,
  weekly,
  monthly,
  monthlyComparison,
  departments,
  departmentComparison,
  topProducts,
  productsGrouped,
  productMovement,
  dailyProductMovement,
  product52WeekStats,
} from './aggregations.js';

// ─── Predictions ──────────────────────────────────────────────────────────
export {
  predictionsDaily,
  predictionsResiduals,
  predictionsWeekly,
  predictionsHourly,
  predictionsMonthly,
  predictionsFactors,
} from './predictions.js';

// ─── Weather + Sales ──────────────────────────────────────────────────────
export {
  dailyWithWeather,
  weeklyWithWeather,
  monthlyWithWeather,
  yearlyWithWeather,
} from './weather.js';

// ─── Live Dashboard ───────────────────────────────────────────────────────
export { realtimeSales } from './realtime.js';

// ─── Vendor Orders (legacy) ───────────────────────────────────────────────
export { vendorOrders } from './vendorOrders.js';
