import api from './client.js';

// ── Auth (reuse portal auth endpoint) ──────────────────────────────────────
export const loginCashier = (email, password) =>
  api.post('/auth/login', { email, password }).then(r => r.data);

// ── Business event log (No Sale, etc.) ────────────────────────────────────
// Fire-and-forget — never blocks the UI; errors are silently swallowed.
export const logPosEvent = (body) =>
  api.post('/pos-terminal/events', body).catch(() => {});

// ── Catalog snapshot (IndexedDB seeding) ────────────────────────────────────
export const getCatalogSnapshot = (storeId, updatedSince, page = 1) =>
  api.get('/pos-terminal/catalog/snapshot', {
    params: { storeId, updatedSince, page, limit: 500 },
  }).then(r => r.data);

export const getDepositRules = () =>
  api.get('/pos-terminal/deposit-rules').then(r => r.data);

export const getTaxRules = () =>
  api.get('/pos-terminal/tax-rules').then(r => r.data);

// ── Product lookup (online fallback) ───────────────────────────────────────
// Uses /search endpoint which does exact UPC match (with 12/13/14-digit variants)
// before falling back to text search — unlike the bulk /products list endpoint
// which ignores the `q` param entirely and returns alphabetical page 1.
export const lookupProductByUPC = (upc, storeId) =>
  api.get('/catalog/products/search', {
    params: { q: upc, storeId, limit: 1 },
  }).then(r => r.data?.data?.[0] || r.data?.[0] || null);

// ── Transactions ─────────────────────────────────────────────────────────
export const submitTransaction = (tx) =>
  api.post('/pos-terminal/transactions', tx).then(r => r.data);

export const batchSubmitTransactions = (transactions) =>
  api.post('/pos-terminal/transactions/batch', { transactions }).then(r => r.data);

export const getPosBranding = (storeId) =>
  api.get('/pos-terminal/branding', { params: { storeId } }).then(r => r.data);

// ── Station management ────────────────────────────────────────────────────

// Register this physical terminal (manager's token sent as Bearer)
export const registerStation = (body, managerToken) =>
  api.post('/pos-terminal/station-register', body, {
    headers: { Authorization: `Bearer ${managerToken}` },
  }).then(r => r.data);

// Verify station token is still valid (used on boot)
export const verifyStation = (stationToken) =>
  api.get('/pos-terminal/station-verify', {
    headers: { 'X-Station-Token': stationToken },
  }).then(r => r.data);

// Standard email/password login (used ONLY by StationSetupScreen for manager auth)
export const loginWithPassword = (email, password) =>
  api.post('/auth/login', { email, password }).then(r => r.data);

export const searchCustomers = (query, storeId) =>
  api.get('/customers', { params: { q: query, storeId, limit: 10 } }).then(r => {
    const d = r.data;
    return Array.isArray(d) ? d : (d?.data ?? d?.customers ?? []);
  });

export const createCustomer = (data) =>
  api.post('/customers', data).then(r => r.data);

// ── Loyalty ───────────────────────────────────────────────────────────────
export const getLoyaltyConfig = (storeId) =>
  api.get('/loyalty/config', { params: { storeId } }).then(r => r.data);

export const getPOSConfig = (storeId) =>
  api.get('/pos-terminal/config', { params: { storeId } }).then(r => r.data);

export const getDepartmentsForPOS = () =>
  api.get('/catalog/departments').then(r => {
    const d = r.data;
    return Array.isArray(d) ? d : (d?.data ?? d?.departments ?? []);
  });

// ── Quick Product Creation (manager at POS) ───────────────────────────────
export const createProduct = (data) =>
  api.post('/catalog/products', data).then(r => {
    const d = r.data;
    return d?.data ?? d?.product ?? d;
  });

// ── Transaction list & actions ─────────────────────────────────────────────
export const listTransactions = (params) =>
  api.get('/pos-terminal/transactions', { params }).then(r => r.data);

export const voidTransaction = (id, note) =>
  api.post(`/pos-terminal/transactions/${id}/void`, { note }).then(r => r.data);

export const createRefund = (id, body) =>
  api.post(`/pos-terminal/transactions/${id}/refund`, body).then(r => r.data);

// No-receipt refund — no parent transaction required
export const createOpenRefund = (body) =>
  api.post('/pos-terminal/transactions/open-refund', body).then(r => r.data);

export const getEndOfDayReport = (storeId, date) =>
  api.get('/pos-terminal/reports/end-of-day', { params: { storeId, date } }).then(r => r.data);

// ── Clock in / out (station-token only, no JWT) ───────────────────────────
export const clockInOut = (pin, type, storeId, stationToken) =>
  api.post('/pos-terminal/clock', { pin, type, storeId }, {
    headers: { 'X-Station-Token': stationToken },
  }).then(r => r.data);

// ── Vendors (for paid-out dropdown) ──────────────────────────────────────
export const getVendors = () =>
  api.get('/pos-terminal/vendors').then(r => {
    const d = r.data;
    return Array.isArray(d) ? d : (d?.data ?? d?.vendors ?? []);
  });

// ── Shift / Cash Drawer ───────────────────────────────────────────────────
export const getActiveShift = (storeId) =>
  api.get('/pos-terminal/shift/active', { params: { storeId } }).then(r => r.data);

export const openShift = (body) =>
  api.post('/pos-terminal/shift/open', body).then(r => r.data);

export const closeShift = (shiftId, body) =>
  api.post(`/pos-terminal/shift/${shiftId}/close`, body).then(r => r.data);

export const addCashDrop = (shiftId, body) =>
  api.post(`/pos-terminal/shift/${shiftId}/drop`, body).then(r => r.data);

export const addPayout = (shiftId, body) =>
  api.post(`/pos-terminal/shift/${shiftId}/payout`, body).then(r => r.data);

export const getShiftReport = (shiftId) =>
  api.get(`/pos-terminal/shift/${shiftId}/report`).then(r => r.data);

export const listShifts = (params) =>
  api.get('/pos-terminal/shifts', { params }).then(r => r.data);

export const getActivePromotionsForPOS = () =>
  api.get('/catalog/promotions', { params: { active: 'true' } }).then(r => {
    const d = r.data;
    return Array.isArray(d) ? d : (d?.data ?? []);
  });

// ── Lottery ───────────────────────────────────────────────────────────────────
export const getLotteryGames = (storeId) =>
  api.get('/lottery/games', { params: { storeId } }).then(r => r.data);

export const getLotteryBoxes = (params) =>
  api.get('/lottery/boxes', { params }).then(r => r.data);

export const createLotteryTransaction = (tx) =>
  api.post('/lottery/transactions', tx).then(r => r.data);

export const bulkCreateLotteryTransactions = (transactions, shiftId) =>
  api.post('/lottery/transactions/bulk', { transactions, shiftId }).then(r => r.data);

export const getLotteryShiftReport = (shiftId) =>
  api.get(`/lottery/shift-reports/${shiftId}`).then(r => r.data);

export const saveLotteryShiftReport = (data) =>
  api.post('/lottery/shift-reports', data).then(r => r.data);

// ── Hardware config (receipt printer / cash drawer / scale) ───────────────
export const saveHardwareConfig = (stationId, hardwareConfig, storeId) =>
  api.post('/payment/hardware', { stationId, hardwareConfig }, { headers: { 'x-store-id': storeId } }).then(r => r.data);

export const getHardwareConfig = (stationId, storeId) =>
  api.get(`/payment/hardware/${stationId}`, { headers: { 'x-store-id': storeId } }).then(r => r.data);

// ── CardPointe — In-Store Terminal Payments ────────────────────────────────
// All card-on-terminal operations. The backend proxies to CardPointe APIs.

/** Initiate a card charge on the physical terminal. Waits for customer interaction. */
export const cpCharge = (body) =>
  api.post('/payment/cp/charge', body).then(r => r.data);

/** Capture a signature on the terminal (standalone, after charge). */
export const cpSignature = (body) =>
  api.post('/payment/cp/signature', body).then(r => r.data);

/** Void an open (not-yet-settled) payment via the Gateway API. */
export const cpVoid = (body) =>
  api.post('/payment/cp/void', body).then(r => r.data);

/** Refund a settled payment via the Gateway API. */
export const cpRefund = (body) =>
  api.post('/payment/cp/refund', body).then(r => r.data);

/** Cancel a pending terminal operation (customer walked away etc.). */
export const cpCancel = (body) =>
  api.post('/payment/cp/cancel', body).then(r => r.data);

/** Link a CardPointe payment transaction to a POS transaction after it's saved. */
export const cpLinkTransaction = (paymentTransactionId, posTransactionId) =>
  api.patch('/payment/cp/link', { paymentTransactionId, posTransactionId }).then(r => r.data);

/** Get the payment terminal registered to a station. */
export const getPaymentTerminalForStation = (stationId, storeId) =>
  api.get('/payment/terminals', { params: { stationId, storeId } })
    .then(r => (r.data?.data || []).find(t => t.stationId === stationId) || null);

/** Get payment settings for a store (signature threshold, tip config, etc.). */
export const getPaymentSettings = (storeId) =>
  api.get(`/payment/settings/${storeId}`).then(r => r.data?.data || null);

// ── Legacy PAX POSLINK (backward compat for un-migrated stations) ──────────
export const paxSale   = (body) => api.post('/payment/pax/sale',   body).then(r => r.data);
export const paxVoid   = (body) => api.post('/payment/pax/void',   body).then(r => r.data);
export const paxRefund = (body) => api.post('/payment/pax/refund', body).then(r => r.data);
export const paxTest   = (ip, port) => api.post('/payment/pax/test', { ip, port }).then(r => r.data);
