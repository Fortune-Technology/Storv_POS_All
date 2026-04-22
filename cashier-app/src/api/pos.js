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

// Tiny payload (~7B per id × N products) — used to reconcile the local
// IndexedDB cache against server truth on every sign-in. Fixes the case
// where products were deleted while the cashier was offline or the cache
// has drifted from repeated import/delete cycles in the back office.
export const getCatalogActiveIds = (storeId) =>
  api.get('/pos-terminal/catalog/active-ids', { params: { storeId } })
     .then(r => r.data);

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

// Quick-button layout (cashier home-screen WYSIWYG). Read-only from the
// cashier-app — portal builder manages writes.
export const getQuickButtonLayout = (storeId) =>
  api.get('/quick-buttons', { params: { storeId } }).then(r => r.data);

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

// End-of-Day report — flexible form. Call with either:
//   getEndOfDayReport(shiftId)                          → single shift (cashier app closing flow)
//   getEndOfDayReport(null, { storeId, date, ... })     → date-range / store / cashier view
//   getEndOfDayReport({ storeId, date })                → date-range via object arg
//
// The legacy form (storeId, date) is still supported for back-compat.
export const getEndOfDayReport = (shiftIdOrParams, maybeParams) => {
  // String or number first arg → treat as shiftId
  if (typeof shiftIdOrParams === 'string' || typeof shiftIdOrParams === 'number') {
    if (maybeParams) {
      // Legacy (storeId, date) form — shiftIdOrParams was actually storeId
      return api.get('/pos-terminal/end-of-day', {
        params: { storeId: shiftIdOrParams, ...(typeof maybeParams === 'string' ? { date: maybeParams } : maybeParams) },
      }).then(r => r.data);
    }
    return api.get(`/pos-terminal/shift/${shiftIdOrParams}/eod-report`).then(r => r.data);
  }
  // Object arg → treat as query params
  return api.get('/pos-terminal/end-of-day', { params: shiftIdOrParams || {} }).then(r => r.data);
};

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

// ───────────────────────────────────────────────────────────────────────────
// Session 39 Round 3 — Full product CRUD aliases mirroring portal/services/api
// signatures 1:1, for use by the ported ProductFormModal (copied from
// frontend/src/pages/ProductForm.jsx). Each maps to an existing backend
// /api/catalog/* endpoint that the portal already exercises.
// ───────────────────────────────────────────────────────────────────────────

export const getCatalogProduct       = (id)            => api.get(`/catalog/products/${id}`).then(r => r.data);
export const createCatalogProduct    = (data)          => api.post('/catalog/products', data).then(r => r.data);
export const updateCatalogProduct    = (id, data)      => api.put(`/catalog/products/${id}`, data).then(r => r.data);
export const duplicateCatalogProduct = (id)            => api.post(`/catalog/products/${id}/duplicate`).then(r => r.data);
export const getProduct52WeekStats   = (id)            => api.get(`/catalog/products/${id}/stats`).then(r => r.data).catch(() => ({ weeks: [] }));

// Departments
export const getCatalogDepartments    = ()             => api.get('/catalog/departments').then(r => r.data);
export const createCatalogDepartment  = (data)         => api.post('/catalog/departments', data).then(r => r.data);
export const updateCatalogDepartment  = (id, data)     => api.put(`/catalog/departments/${id}`, data).then(r => r.data);
export const deleteCatalogDepartment  = (id)           => api.delete(`/catalog/departments/${id}`).then(r => r.data);
export const getDepartmentAttributes  = (id)           => api.get(`/catalog/departments/${id}/attributes`).then(r => r.data).catch(() => ({ attributes: [] }));

// Vendors (CRUD — the paid-out helper above hits /pos-terminal/vendors read-only)
export const getCatalogVendors        = ()             => api.get('/catalog/vendors').then(r => r.data);
export const createCatalogVendor      = (data)         => api.post('/catalog/vendors', data).then(r => r.data);
export const updateCatalogVendor      = (id, data)     => api.put(`/catalog/vendors/${id}`, data).then(r => r.data);
export const deleteCatalogVendor      = (id)           => api.delete(`/catalog/vendors/${id}`).then(r => r.data);

// Store inventory (per-store quantity / price overrides)
export const upsertStoreInventory     = (data)         => api.post('/catalog/store-inventory', data).then(r => r.data);
export const getStoreInventory        = (productId, storeId) =>
  api.get('/catalog/store-inventory', { params: { productId, storeId } }).then(r => r.data);

// Promotions
export const getCatalogPromotions     = (params)       => api.get('/catalog/promotions', { params }).then(r => r.data);
export const createCatalogPromotion   = (data)         => api.post('/catalog/promotions', data).then(r => r.data);
export const updateCatalogPromotion   = (id, data)     => api.put(`/catalog/promotions/${id}`, data).then(r => r.data);
export const deleteCatalogPromotion   = (id)           => api.delete(`/catalog/promotions/${id}`).then(r => r.data);

// Per-product multi-UPC + pack sizes
export const getProductUpcs           = (id)           => api.get(`/catalog/products/${id}/upcs`).then(r => r.data);
export const addProductUpc            = (id, data)     => api.post(`/catalog/products/${id}/upcs`, data).then(r => r.data);
export const deleteProductUpc         = (id, upcId)    => api.delete(`/catalog/products/${id}/upcs/${upcId}`).then(r => r.data);

export const getProductPackSizes      = (id)           => api.get(`/catalog/products/${id}/pack-sizes`).then(r => r.data);
export const bulkReplaceProductPackSizes = (id, sizes) => api.put(`/catalog/products/${id}/pack-sizes`, { sizes }).then(r => r.data);

// Product groups (Session 9 grouping)
export const listProductGroups        = ()             => api.get('/catalog/product-groups').then(r => r.data);

// Tax rules (needed by ProductForm for tax preview)
export const getCatalogTaxRules       = ()             => api.get('/catalog/tax-rules').then(r => r.data);

// Product image upload
export const uploadProductImage       = (id, file) => {
  const fd = new FormData();
  fd.append('image', file);
  return api.post(`/catalog/products/${id}/image`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);
};

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

// Phase 1a: EoD scan endpoint — routes a raw barcode through the backend
// scan engine which finds/activates/updates the matching book.
// context should be 'eod' when called from the end-of-day wizard (Phase 1b).
export const scanLotteryBarcode = (raw, context = 'eod') =>
  api.post('/lottery/scan', { raw, context }).then(r => r.data);

// Phase 3g: mark a book as sold-out from the EoD wizard (flips to depleted).
// Body: { reason?: string, notes?: string }
export const soldoutLotteryBox = (id, data = {}) =>
  api.post(`/lottery/boxes/${id}/soldout`, data).then(r => r.data);

// Phase 3g: store/update the store-level online-sales totals for a date.
// Body: { date:'YYYY-MM-DD', instantCashing, machineSales, machineCashing }
export const upsertLotteryOnlineTotal = (data) =>
  api.put('/lottery/online-total', data).then(r => r.data);

// Phase 3g: read the store-level online-sales totals for a date.
export const getLotteryOnlineTotal = (date) =>
  api.get('/lottery/online-total', { params: { date } }).then(r => r.data);

// ── Fuel ──────────────────────────────────────────────────────────────────────
export const getFuelTypes = (storeId) =>
  api.get('/fuel/types', { params: { storeId } })
    .then(r => {
      const d = r.data;
      return Array.isArray(d) ? d : (d?.data ?? []);
    });

export const getFuelSettings = (storeId) =>
  api.get('/fuel/settings', { params: { storeId } })
    .then(r => r.data?.data ?? r.data);

// ── Hardware config (receipt printer / cash drawer / scale) ───────────────
export const saveHardwareConfig = (stationId, hardwareConfig, storeId) =>
  api.post('/payment/hardware', { stationId, hardwareConfig }, { headers: { 'x-store-id': storeId } }).then(r => r.data);

export const getHardwareConfig = (stationId, storeId) =>
  api.get(`/payment/hardware/${stationId}`, { headers: { 'x-store-id': storeId } }).then(r => r.data);

// ── (REMOVED) CardPointe integration — replaced by Dejavoo SPIn below ──────
// Keeping the export names cp* as deprecated no-op stubs so any stale UI
// code won't crash while we finish migrating every caller.
const __cpRemoved = () => Promise.reject(new Error('CardPointe integration removed — use Dejavoo SPIn'));
export const cpCharge           = __cpRemoved;
export const cpSignature        = __cpRemoved;
export const cpVoid             = __cpRemoved;
export const cpRefund           = __cpRemoved;
export const cpCancel           = __cpRemoved;
export const cpLinkTransaction  = __cpRemoved;
export const getPaymentTerminalForStation = () => Promise.resolve(null);
export const getPaymentSettings = () => Promise.resolve(null);

// ── Dejavoo SPIn — In-Store Terminal Payments ────────────────────────────────
// All Dejavoo card-on-terminal operations. The backend proxies to SPIn REST API.
// Multi-tenant: backend resolves credentials from stationId → store → PaymentMerchant.

/** Process a card-present sale on the Dejavoo terminal. */
export const dejavooSale = (body) =>
  api.post('/payment/dejavoo/sale', body).then(r => r.data);

/** Process a return/refund on the Dejavoo terminal. */
export const dejavooRefund = (body) =>
  api.post('/payment/dejavoo/refund', body).then(r => r.data);

/** Void a previous Dejavoo transaction. */
export const dejavooVoid = (body) =>
  api.post('/payment/dejavoo/void', body).then(r => r.data);

/** Check EBT balance (SNAP or Cash Benefit). */
export const dejavooEbtBalance = (body) =>
  api.post('/payment/dejavoo/ebt-balance', body).then(r => r.data);

/** Abort an in-flight transaction on the terminal (cashier cancels). */
export const dejavooCancel = (body) =>
  api.post('/payment/dejavoo/cancel', body).then(r => r.data);

/** Check if the Dejavoo terminal is connected and reachable. */
export const dejavooTerminalStatus = (body) =>
  api.post('/payment/dejavoo/terminal-status', body).then(r => r.data);

/** Check status of a specific transaction by referenceId. */
export const dejavooTransactionStatus = (body) =>
  api.post('/payment/dejavoo/status', body).then(r => r.data);

/** Settle / close the current batch on the terminal. */
export const dejavooSettle = (body) =>
  api.post('/payment/dejavoo/settle', body).then(r => r.data);

/** Get read-only merchant status for the store (no secrets exposed). */
export const dejavooMerchantStatus = () =>
  api.get('/payment/dejavoo/merchant-status').then(r => r.data);

/**
 * Prompt the customer on the Dejavoo terminal to enter their phone number,
 * then look up the matching Customer record. Used for instant loyalty lookup
 * while the cashier is scanning products.
 *
 * Returns { success, customer } | { success, notFound, phone } | { success: false, reason }
 */
export const dejavooLookupCustomer = (body) =>
  api.post('/payment/dejavoo/lookup-customer', body).then(r => r.data);

// ── Legacy PAX POSLINK (backward compat for un-migrated stations) ──────────
export const paxSale   = (body) => api.post('/payment/pax/sale',   body).then(r => r.data);
export const paxVoid   = (body) => api.post('/payment/pax/void',   body).then(r => r.data);
export const paxRefund = (body) => api.post('/payment/pax/refund', body).then(r => r.data);
export const paxTest   = (ip, port) => api.post('/payment/pax/test', { ip, port }).then(r => r.data);

// ── AI Support Assistant ───────────────────────────────────────────────────
export const listAiConversations   = ()            => api.get('/ai-assistant/conversations').then(r => r.data);
export const createAiConversation  = ()            => api.post('/ai-assistant/conversations').then(r => r.data);
export const getAiConversation     = (id)          => api.get(`/ai-assistant/conversations/${id}`).then(r => r.data);
export const sendAiMessage         = (id, content) => api.post(`/ai-assistant/conversations/${id}/messages`, { content }).then(r => r.data);
export const submitAiFeedback      = (msgId, feedback, note = null) =>
  api.post(`/ai-assistant/messages/${msgId}/feedback`, { feedback, note }).then(r => r.data);
export const escalateAiConversation = (id, subject, priority = 'normal') =>
  api.post(`/ai-assistant/conversations/${id}/escalate`, { subject, priority }).then(r => r.data);
