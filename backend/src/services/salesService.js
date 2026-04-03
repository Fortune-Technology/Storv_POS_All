/**
 * Sales Analytics Service — IT Retail / MarktPOS API
 * Wraps all CashFlowData, DepartmentSales, ProductSalesData, etc. endpoints.
 */

import { marktPOSRequest } from './marktPOSService.js';

// ─── Authenticated API helper ─────────────────────────────────────────────────
const apiGet = async (path, user, params = {}) => {
  return marktPOSRequest('GET', path, user, null, 0, params);
};

// ─── Helper: inject storeIds when not provided ────────────────────────────────
const withStore = (storeId, params = {}) => ({
  storeIds: storeId || params.storeIds || '',
  ...params,
});

// ─── Sales Summary endpoints ──────────────────────────────────────────────────

/**
 * GET /CashFlowData/GetDailySalesSummary
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 */
export const getDailySales = (user, storeId, from, to) =>
  apiGet('CashFlowData/GetDailySalesSummary', user, withStore(storeId, { from, to }));

/**
 * GET /CashFlowData/GetWeeklySalesSummary
 */
export const getWeeklySales = (user, storeId, from, to) =>
  apiGet('CashFlowData/GetWeeklySalesSummary', user, withStore(storeId, { from, to }));

/**
 * GET /CashFlowData/GetMonthlySalesSummary
 */
export const getMonthlySales = (user, storeId, from, to) =>
  apiGet('CashFlowData/GetMonthlySalesSummary', user, withStore(storeId, { from, to }));

/**
 * GET /MonthlySalesData/Get  — year-over-year monthly comparison
 */
export const getMonthlySalesComparison = (user, storeId) =>
  apiGet('MonthlySalesData/Get', user, withStore(storeId));

// ─── Department Sales endpoints ───────────────────────────────────────────────

/**
 * GET /DepartmentSales/Get
 */
export const getDepartmentSales = (user, storeId, from, to) =>
  apiGet('DepartmentSales/Get', user, withStore(storeId, { from, to }));

/**
 * GET /DepartmentSales/GetComparisonSalesSummary
 * @param {string} from   period 1 start
 * @param {string} to     period 1 end
 * @param {string} from2  period 2 start
 * @param {string} to2    period 2 end
 */
export const getDepartmentComparison = (user, storeId, from, to, from2, to2) =>
  apiGet('DepartmentSales/GetComparisonSalesSummary', user, withStore(storeId, { from, to, from2, to2 }));

// ─── Product endpoints ────────────────────────────────────────────────────────

/**
 * GET /TopProductsData/Get?date=
 * @param {string} date  YYYY-MM-DD
 */
export const getTopProducts = (user, storeId, date) =>
  apiGet('TopProductsData/Get', user, { date });

/**
 * GET /ProductSalesData/GetGrouped
 * @param {string} from
 * @param {string} to
 * @param {string} orderBy   e.g. 'NetSales'
 * @param {number} pageSize
 * @param {number} skip
 */
export const getProductsGrouped = (user, storeId, from, to, orderBy = 'NetSales', pageSize = 20, skip = 0) =>
  apiGet('ProductSalesData/GetGrouped', user, withStore(storeId, { from, to, orderBy, pageSize, skip }));

/**
 * GET /ProductMovementData/Get
 * @param {string}  upc
 * @param {string}  dateStart
 * @param {string}  dateFinish
 * @param {boolean} weekly
 */
export const getProductMovement = (user, storeId, upc, dateStart, dateFinish, weekly = false) =>
  apiGet('ProductMovementData/Get', user, { upc, dateStart, dateFinish, weekly });

/**
 * GET /ProductSalesData/GetDailyProductMovement
 * @param {string} startDate
 * @param {string} endDate
 */
export const getDailyProductMovement = (user, storeId, startDate, endDate) =>
  apiGet('ProductSalesData/GetDailyProductMovement', user, {
    storeId: storeId,
    startDate,
    endDate,
  });
