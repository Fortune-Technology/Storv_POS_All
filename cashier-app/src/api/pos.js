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

// ── Manufacturer Coupons (Session 46) ────────────────────────────────────
// Validate a coupon at POS — returns { valid, coupon, qualifyingLines, computedDiscount, requiresApproval, ... }
export const validateCouponAtPOS = (body) =>
  api.post('/coupons/validate', body).then(r => r.data);

// ── Transactions ─────────────────────────────────────────────────────────
export const submitTransaction = (tx) =>
  api.post('/pos-terminal/transactions', tx).then(r => r.data);

export const batchSubmitTransactions = (transactions) =>
  api.post('/pos-terminal/transactions/batch', { transactions }).then(r => r.data);

export const getPosBranding = (storeId) =>
  api.get('/pos-terminal/branding', { params: { storeId } }).then(r => r.data);

// ── Station management ────────────────────────────────────────────────────

// Register this physical terminal.
//
// `managerToken` is OPTIONAL: if provided, sent as a Bearer token (preserves
// the legacy authenticated-pair flow). If omitted, the request goes through
// without an Authorization header — the backend route is unguarded for the
// "Reset this register → re-pair without login" flow. The backend still
// scopes by storeId (looks up the Store row to derive orgId).
export const registerStation = (body, managerToken) => {
  const headers = managerToken
    ? { Authorization: `Bearer ${managerToken}` }
    : undefined;
  return api
    .post('/pos-terminal/station-register', body, headers ? { headers } : undefined)
    .then(r => r.data);
};

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

// ── Label Print Jobs (Electron-routed Zebra printing) ────────────────────
// The cashier-app polls /claim, processes jobs via window.electronAPI.zebraPrintZPL,
// then reports back via /:id/complete.
export const claimLabelPrintJobs = (stationId, limit = 5) =>
  api.post('/label-print-jobs/claim', { stationId, limit }).then(r => r.data);

export const completeLabelPrintJob = (id, { success, error, stationId }) =>
  api.post(`/label-print-jobs/${id}/complete`, { success, error, stationId }).then(r => r.data);

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
// 52-week stats live on the SALES router, not catalog. Accepts a params object
// (e.g. { upc } or { productId }) just like the portal helper. Previously this
// pointed at /catalog/products/:id/stats which 404'd and got silently caught.
export const getProduct52WeekStats   = (params)        => api.get('/sales/products/52week-stats', { params }).then(r => r.data).catch(() => ({ weeks: [] }));

// Departments
export const getCatalogDepartments    = ()             => api.get('/catalog/departments').then(r => r.data);
export const createCatalogDepartment  = (data)         => api.post('/catalog/departments', data).then(r => r.data);
export const updateCatalogDepartment  = (id, data)     => api.put(`/catalog/departments/${id}`, data).then(r => r.data);
export const deleteCatalogDepartment  = (id)           => api.delete(`/catalog/departments/${id}`).then(r => r.data);
// Backend route is /catalog/department-attributes?departmentId=X — a flat list
// endpoint, not nested under /departments/:id. Previously the cashier called
// /catalog/departments/:id/attributes which 404'd and was silently caught.
export const getDepartmentAttributes  = (departmentId) => api.get('/catalog/department-attributes', { params: { departmentId } }).then(r => r.data).catch(() => ({ attributes: [] }));

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
// Backend route requires the /bulk-replace suffix. Without it this used to
// 404 — and the form-save swallowed the rejection so pack sizes were silently
// not persisted when created from the cashier-app.
export const bulkReplaceProductPackSizes = (id, sizes) => api.put(`/catalog/products/${id}/pack-sizes/bulk-replace`, { sizes }).then(r => r.data);

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

// Per-box yesterday-close map for the EoD wizard's YESTERDAY column.
// Returns { closes: { [boxId]: { ticket, ticketsSold, closedAt } } }
// keyed off the most recent close_day_snapshot before the given date's
// local midnight. Mirrors the back-office Counter snapshot data so the
// wizard's "Yesterday" column matches what the owner sees.
export const getLotteryYesterdayCloses = (params) =>
  api.get('/lottery/yesterday-closes', { params }).then(r => r.data?.closes ?? r.data);

// Store-level lottery settings (sellDirection, commissionRate, etc.).
// Used by the EoD wizard so its soldout-math can match the backend's
// (sentinel = -1 for desc, totalTickets for asc).
export const getLotterySettings = (storeId) =>
  api.get('/lottery/settings', { params: { storeId } })
    .then(r => r.data?.data ?? r.data);

// Aggregate sales for a single date — same number the back-office shows
// in the Daily page's "Instant Sales" / "Today Sold" fields. The EoD
// wizard's confirm screen reads this AFTER save so the cashier sees the
// authoritative recorded number, eliminating wizard-vs-back-office drift.
export const getDailyLotteryInventory = (params) =>
  api.get('/lottery/daily-inventory', { params }).then(r => r.data?.data ?? r.data);

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

// V1.5: pumps (only fetched when pumpTrackingEnabled is on)
export const getFuelPumps = (storeId) =>
  api.get('/fuel/pumps', { params: { storeId } })
    .then(r => {
      const d = r.data;
      return Array.isArray(d) ? d : (d?.data ?? []);
    });

// V1.5: recent fuel sales — powers pump-aware refund picker
export const getRecentFuelSales = (storeId, { limit = 30, pumpId, shiftId } = {}) =>
  api.get('/fuel/recent-sales', { params: { storeId, limit, pumpId, shiftId } })
    .then(r => {
      const d = r.data;
      return Array.isArray(d) ? d : (d?.data ?? []);
    });

// V1.5: list tanks + stick-reading CRUD — used by CloseShift reconciliation prompt
export const getFuelTanks = (storeId) =>
  api.get('/fuel/tanks', { params: { storeId } })
    .then(r => {
      const d = r.data;
      return Array.isArray(d) ? d : (d?.data ?? []);
    });

export const createFuelStickReading = (data) =>
  api.post('/fuel/stick-readings', data)
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
//
// IMPORTANT — terminal-call timeouts:
//   The default axios client has an 8-second timeout (api/client.js) which is
//   correct for normal CRUD calls but CATASTROPHIC for terminal calls.
//   A real card sale legitimately takes 30-120 seconds end-to-end:
//     * Dejavoo cloud routes the request to the physical terminal (~1-3s)
//     * Customer reads prompt, presents card (~5-30s, can be longer)
//     * Card chip/contactless processing + EMV exchange (~3-10s)
//     * Processor authorization (~2-15s)
//     * Receipt generation + response back through cloud (~1-3s)
//   The Theneo SPIn spec defaults to 120s for SPInProxyTimeout.
//   We use 150s here so the client window is slightly wider than the backend's
//   so the backend response always arrives before the client gives up.
//
// What the 8s bug used to cause: terminal approved real card (APPROVAL TASxxx
// shown to customer), backend got the response, but cashier-app's axios threw
// `timeout of 8000ms exceeded` at the 8-second mark — POS marked the sale as
// declined while the customer's card was actually charged. Money taken, no
// transaction record. Fixed by setting a per-call timeout for every terminal
// endpoint below.
const TERMINAL_TIMEOUT_MS = 150_000; // 150 seconds — wider than backend's 120s

/** Process a card-present sale on the Dejavoo terminal. */
export const dejavooSale = (body) =>
  api.post('/payment/dejavoo/sale', body, { timeout: TERMINAL_TIMEOUT_MS }).then(r => r.data);

/** Process a return/refund on the Dejavoo terminal. */
export const dejavooRefund = (body) =>
  api.post('/payment/dejavoo/refund', body, { timeout: TERMINAL_TIMEOUT_MS }).then(r => r.data);

/** Void a previous Dejavoo transaction. */
export const dejavooVoid = (body) =>
  api.post('/payment/dejavoo/void', body, { timeout: TERMINAL_TIMEOUT_MS }).then(r => r.data);

/** Check EBT balance (SNAP or Cash Benefit). */
export const dejavooEbtBalance = (body) =>
  api.post('/payment/dejavoo/ebt-balance', body, { timeout: TERMINAL_TIMEOUT_MS }).then(r => r.data);

/** Abort an in-flight transaction on the terminal (cashier cancels). */
export const dejavooCancel = (body) =>
  api.post('/payment/dejavoo/cancel', body, { timeout: TERMINAL_TIMEOUT_MS }).then(r => r.data);

/** Check if the Dejavoo terminal is connected and reachable. */
export const dejavooTerminalStatus = (body) =>
  api.post('/payment/dejavoo/terminal-status', body, { timeout: TERMINAL_TIMEOUT_MS }).then(r => r.data);

/** Check status of a specific transaction by referenceId. */
export const dejavooTransactionStatus = (body) =>
  api.post('/payment/dejavoo/status', body, { timeout: TERMINAL_TIMEOUT_MS }).then(r => r.data);

/** Settle / close the current batch on the terminal. */
export const dejavooSettle = (body) =>
  api.post('/payment/dejavoo/settle', body, { timeout: TERMINAL_TIMEOUT_MS }).then(r => r.data);

// ── Customer-facing display ─────────────────────────────────────────────────
// Display methods route to /payment/dejavoo/display/* on the backend. They
// push cart state / branded messages to the P17's customer-facing screen
// and printer. None of them move money so they're shorter-timeout (15s) and
// callers should treat their failures as fire-and-forget — display flakes
// must never block a sale or surface as a cashier error.
const DISPLAY_TIMEOUT_MS = 15_000;

/** Push live cart updates so the customer sees items on the terminal screen. */
export const dejavooPushCart = (body) =>
  api.post('/payment/dejavoo/display/cart', body, { timeout: DISPLAY_TIMEOUT_MS }).then(r => r.data);

/** Print a "Welcome to <Store>" banner on the terminal printer. */
export const dejavooPushWelcome = (body) =>
  api.post('/payment/dejavoo/display/welcome', body, { timeout: DISPLAY_TIMEOUT_MS }).then(r => r.data);

/** Print a "Thank You" message on the terminal printer after a sale. */
export const dejavooPushThankYou = (body) =>
  api.post('/payment/dejavoo/display/thank-you', body, { timeout: DISPLAY_TIMEOUT_MS }).then(r => r.data);

/** Print a full branded transaction receipt on the terminal printer. */
export const dejavooPushBrandedReceipt = (body) =>
  api.post('/payment/dejavoo/display/receipt', body, { timeout: DISPLAY_TIMEOUT_MS }).then(r => r.data);

/** Reset the customer-facing display to empty between transactions. */
export const dejavooClearDisplay = (body) =>
  api.post('/payment/dejavoo/display/clear', body, { timeout: DISPLAY_TIMEOUT_MS }).then(r => r.data);

/**
 * Get read-only merchant status for THIS cashier's store.
 *
 * The backend reads `storeId` from the `X-Store-Id` header. Without it, it
 * returns `{ configured: false, reason: 'no_active_store' }` — which makes
 * the cashier-app think no terminal is configured and silently fall through
 * to the manual-approval path. ALWAYS pass storeId.
 *
 * @param {string} storeId  The active cashier's storeId.
 */
export const dejavooMerchantStatus = (storeId) =>
  api.get('/payment/dejavoo/merchant-status', {
    headers: storeId ? { 'X-Store-Id': storeId } : undefined,
  }).then(r => r.data);

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
// Same 150s timeout for the same reason — PAX terminals also need ~30-90s
// for a real card-present sale end-to-end.
export const paxSale   = (body) => api.post('/payment/pax/sale',   body, { timeout: TERMINAL_TIMEOUT_MS }).then(r => r.data);
export const paxVoid   = (body) => api.post('/payment/pax/void',   body, { timeout: TERMINAL_TIMEOUT_MS }).then(r => r.data);
export const paxRefund = (body) => api.post('/payment/pax/refund', body, { timeout: TERMINAL_TIMEOUT_MS }).then(r => r.data);
export const paxTest   = (ip, port) => api.post('/payment/pax/test', { ip, port }, { timeout: TERMINAL_TIMEOUT_MS }).then(r => r.data);

// ── AI Support Assistant ───────────────────────────────────────────────────
export const listAiConversations   = ()            => api.get('/ai-assistant/conversations').then(r => r.data);
export const createAiConversation  = ()            => api.post('/ai-assistant/conversations').then(r => r.data);
export const getAiConversation     = (id)          => api.get(`/ai-assistant/conversations/${id}`).then(r => r.data);
export const sendAiMessage         = (id, content) => api.post(`/ai-assistant/conversations/${id}/messages`, { content }).then(r => r.data);
export const submitAiFeedback      = (msgId, feedback, note = null) =>
  api.post(`/ai-assistant/messages/${msgId}/feedback`, { feedback, note }).then(r => r.data);
export const escalateAiConversation = (id, subject, priority = 'normal') =>
  api.post(`/ai-assistant/conversations/${id}/escalate`, { subject, priority }).then(r => r.data);

// ── Tasks (assigned from back-office) ──────────────────────────────────────
export const getMyTasks       = (params = {}) => api.get('/tasks/my', { params }).then(r => r.data);
export const getTaskCounts    = ()            => api.get('/tasks/counts').then(r => r.data);
export const updateTaskStatus = (id, data)    => api.put(`/tasks/${id}`, data).then(r => r.data);
