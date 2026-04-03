/**
 * Sales Analytics Service — IT Retail / MarktPOS API
 * Wraps all CashFlowData, DepartmentSales, ProductSalesData, etc. endpoints.
 */

import axios from 'axios';

const BASE_URL = process.env.MARKTPOS_BASE_URL || 'https://app.marktpos.com';
const STORE_ID = process.env.ITRETAIL_STORE_ID || '';

// ─── Token cache ──────────────────────────────────────────────────────────────
let _cachedToken = null;
let _tokenExpiry = 0; // epoch ms

const getToken = async () => {
  if (_cachedToken && Date.now() < _tokenExpiry) {
    return _cachedToken;
  }

  const username = process.env.MARKTPOS_USERNAME;
  const password = process.env.MARKTPOS_PASSWORD;

  if (!username || !password) {
    throw new Error('MarktPOS global credentials (MARKTPOS_USERNAME/PASSWORD) are not configured in .env');
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('username', username);
  params.append('password', password);

  try {
    const resp = await axios.post(
      `${BASE_URL}/token?accesslevel=0`,
      params.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      }
    );

    _cachedToken = resp.data.access_token;
    // expires_in is 1209599 s (~14 days); refresh 1 hour before expiry
    const expiresIn = (resp.data.expires_in || 1209599) * 1000;
    _tokenExpiry = Date.now() + expiresIn - 3600_000;

    return _cachedToken;
  } catch (err) {
    console.error('❌ MarktPOS OData Token Error:', err.response?.data || err.message);
    throw new Error(`Failed to obtain MarktPOS OData token: ${err.response?.status === 400 ? 'Invalid credentials' : err.message}`);
  }
};

// ─── Authenticated API helper ─────────────────────────────────────────────────
const apiGet = async (path, params = {}) => {
  try {
    const token = await getToken();
    const resp = await axios.get(`${BASE_URL}/api/${path}`, {
      params,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000,
    });
    return resp.data;
  } catch (err) {
    console.error(`❌ IT Retail OData API error [${path}]:`, err.response?.data || err.message);
    throw err;
  }
};

// ─── Helper: inject storeIds when not provided ────────────────────────────────
const withStore = (params = {}) => ({
  storeIds: STORE_ID,
  ...params,
});

// ─── Sales Summary endpoints ──────────────────────────────────────────────────

/**
 * GET /CashFlowData/GetDailySalesSummary
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 */
export const getDailySales = (from, to) =>
  apiGet('CashFlowData/GetDailySalesSummary', withStore({ from, to }));

/**
 * GET /CashFlowData/GetWeeklySalesSummary
 */
export const getWeeklySales = (from, to) =>
  apiGet('CashFlowData/GetWeeklySalesSummary', withStore({ from, to }));

/**
 * GET /CashFlowData/GetMonthlySalesSummary
 */
export const getMonthlySales = (from, to) =>
  apiGet('CashFlowData/GetMonthlySalesSummary', withStore({ from, to }));

/**
 * GET /MonthlySalesData/Get  — year-over-year monthly comparison
 */
export const getMonthlySalesComparison = () =>
  apiGet('MonthlySalesData/Get', withStore());

// ─── Department Sales endpoints ───────────────────────────────────────────────

/**
 * GET /DepartmentSales/Get
 */
export const getDepartmentSales = (from, to) =>
  apiGet('DepartmentSales/Get', withStore({ from, to }));

/**
 * GET /DepartmentSales/GetComparisonSalesSummary
 * @param {string} from   period 1 start
 * @param {string} to     period 1 end
 * @param {string} from2  period 2 start
 * @param {string} to2    period 2 end
 */
export const getDepartmentComparison = (from, to, from2, to2) =>
  apiGet('DepartmentSales/GetComparisonSalesSummary', withStore({ from, to, from2, to2 }));

// ─── Product endpoints ────────────────────────────────────────────────────────

/**
 * GET /TopProductsData/Get?date=
 * @param {string} date  YYYY-MM-DD
 */
export const getTopProducts = (date) =>
  apiGet('TopProductsData/Get', { date });

/**
 * GET /ProductSalesData/GetGrouped
 * @param {string} from
 * @param {string} to
 * @param {string} orderBy   e.g. 'NetSales'
 * @param {number} pageSize
 * @param {number} skip
 */
export const getProductsGrouped = (from, to, orderBy = 'NetSales', pageSize = 20, skip = 0) =>
  apiGet('ProductSalesData/GetGrouped', withStore({ from, to, orderBy, pageSize, skip }));

/**
 * GET /ProductMovementData/Get
 * @param {string}  upc
 * @param {string}  dateStart
 * @param {string}  dateFinish
 * @param {boolean} weekly
 */
export const getProductMovement = (upc, dateStart, dateFinish, weekly = false) =>
  apiGet('ProductMovementData/Get', { upc, dateStart, dateFinish, weekly });

/**
 * GET /ProductSalesData/GetDailyProductMovement
 * @param {string} startDate
 * @param {string} endDate
 */
export const getDailyProductMovement = (startDate, endDate) =>
  apiGet('ProductSalesData/GetDailyProductMovement', {
    storeId: STORE_ID,
    startDate,
    endDate,
  });
