import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
});

// NEW Auth & Portal Routes
// Add a request interceptor to include the Bearer token + active store header
api.interceptors.request.use(
  (config) => {
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      if (user && user.token) {
        config.headers.Authorization = `Bearer ${user.token}`;
      }
    } catch { /* malformed user blob — ignore */ }
    // Attach active store so the backend scopes data correctly.
    // If a caller already set X-Store-Id explicitly (e.g. the ownership
    // transfer flow pinning to a non-active store), respect it.
    if (!config.headers['X-Store-Id'] && !config.headers['x-store-id']) {
      const activeStoreId = localStorage.getItem('activeStoreId');
      if (activeStoreId) {
        config.headers['X-Store-Id'] = activeStoreId;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// ── Global 401 handler ────────────────────────────────────────────────────
// When the backend rejects our JWT (expired or revoked), clear the session
// and bounce the user to /login. Without this, pages hang on stale tokens
// and users see blank screens or mid-navigation redirects.
//
// Skip the handler for the login / reset flows themselves — those 401s are
// expected "wrong password" responses and the page handles its own error.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url    = error?.config?.url || '';
    // verify-password is used by the inactivity lock to re-prove identity —
    // a 401 here means "wrong password", not "session expired", so we must
    // NOT log the user out.
    const isAuthFlow = /\/auth\/(login|signup|forgot-password|reset-password|verify-password)/.test(url);

    if (status === 401 && !isAuthFlow) {
      // Session is no longer valid — wipe and redirect once.
      try {
        localStorage.removeItem('user');
        localStorage.removeItem('token');
      } catch {}
      // Avoid redirect loops: only navigate when not already on a public page.
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        const isPublic = path === '/' || path.startsWith('/login') || path.startsWith('/signup') ||
          path.startsWith('/forgot-password') || path.startsWith('/reset-password') ||
          path.startsWith('/features') || path.startsWith('/pricing') || path.startsWith('/contact') ||
          path.startsWith('/about') || path.startsWith('/careers');
        if (!isPublic) {
          const returnTo = encodeURIComponent(path + window.location.search);
          window.location.replace(`/login?session=expired&returnTo=${returnTo}`);
        }
      }
    }
    return Promise.reject(error);
  }
);

// LEGACY API FUNCTIONS
export const getVendors = () => api.get('/vendors').then(res => res.data);
export const uploadFile = (file, vendorId) => {
    const formData = new FormData();
    formData.append('file', file);
    if (vendorId) formData.append('vendorId', vendorId);
    return api.post('/upload-file', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(res => res.data);
};
export const getPreview = (uploadId) => api.get(`/preview/${uploadId}`).then(res => res.data);
export const startTransform = (uploadId, depositMapId, format) => api.post('/transform', { uploadId, depositMapId, format }).then(res => res.data);
export const getTransformStatus = (id) => api.get(`/transform-status/${id}`).then(res => res.data);
export const getDownloadUrl = (id) => `${api.defaults.baseURL}/download/${id}`;
export const uploadDepositMap = (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/upload-deposit-map', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(res => res.data);
};
export const getDepositMaps = () => api.get('/deposit-maps').then(res => res.data);
export const getHistory = () => api.get('/history').then(res => res.data);
export const deleteTransform = (id) => api.delete(`/transform/${id}`).then(res => res.data);
export const checkHealth = () => api.get('/health', { baseURL: api.defaults.baseURL.replace('/api', '') }).then(res => res.data);

// NEW Auth Routes
export const signup = (userData) => api.post('/auth/signup', userData);

// Login User
export const login = (credentials) => api.post('/auth/login', credentials);

// Forgot Password
export const forgotPassword = (email) => api.post('/auth/forgot-password', { email });

// Reset Password (token from email link)
export const resetPassword = ({ token, password }) =>
  api.post('/auth/reset-password', { token, password }).then((r) => r.data);

// Phone Lookup
export const phoneLookup = (phone) => api.post('/auth/phone-lookup', { phone });

// Customers
export const getCustomers      = (params)     => api.get('/customers', { params }).then(r => r.data);
export const getCustomerById   = (id)         => api.get(`/customers/${id}`).then(r => r.data);
export const createCustomer    = (data)       => api.post('/customers', data).then(r => r.data);
export const updateCustomer    = (id, data)   => api.put(`/customers/${id}`, data).then(r => r.data);
export const deleteCustomer    = (id)         => api.delete(`/customers/${id}`).then(r => r.data);
export const checkPoints       = (phone)      => api.post('/customers/check-points', { phone }).then(r => r.data);

// Invoices
export const uploadInvoices = (formData) => api.post('/invoice/upload', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
// NEW: instant-queue (responds immediately, AI processes in background)
export const queueInvoice = (formData) => api.post('/invoice/queue', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
export const queueMultipageInvoice = (formData) => api.post('/invoice/queue-multipage', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
export const confirmInvoice = (data) => api.post('/invoice/confirm', data);
export const getInvoiceHistory = () => api.get('/invoice/history');
export const getInvoiceDrafts = () => api.get('/invoice/drafts');
export const getInvoiceById = (id) => api.get(`/invoice/${id}`);
export const saveInvoiceDraft = (id, data) => api.patch(`/invoice/${id}/draft`, data);
export const deleteInvoiceDraft = (id) => api.delete(`/invoice/drafts/${id}`);
export const clearInvoicePOSCache = () => api.post('/invoice/clear-pos-cache');
export const getInvoiceAccuracy = () => api.get('/invoice/accuracy').then(r => r.data);
// Vendor-level summary that separates purchase invoices from credit memos.
// Returns { purchases: {count, total}, credits: {count, total}, netCost, recentCredits[] }.
export const getVendorInvoiceSummary = (params) => api.get('/invoice/vendor-summary', { params }).then(r => r.data);

// ── Daily Sale — unified back-office reconciliation ────────────────────
export const getDailySale      = (date)       => api.get(date ? `/daily-sale/${date}` : '/daily-sale').then(r => r.data);
export const saveDailySale     = (date, body) => api.put(`/daily-sale/${date}`, body).then(r => r.data);
export const closeDailySale    = (date)       => api.post(`/daily-sale/${date}/close`).then(r => r.data);
// Re-run the matching cascade on a draft invoice, optionally scoped to a vendor.
// Preserves user-made manual matches unless force=true.
export const rematchInvoice = (id, { vendorId, force } = {}) =>
  api.post(`/invoice/${id}/rematch`, { vendorId, force }).then(r => r.data);

// Products
export const getProducts = () => api.get('/products');
export const bulkUpdatePrices = (updates) => api.put('/products/bulk-update', { updates });

// POS - MarktPOS Integration
export const connectPOS = (credentials) => api.post('/pos/connect', credentials);
export const getPOSStatus = () => api.get('/pos/status');
export const fetchPOSProducts = () => api.get('/pos/products');
export const searchPOSProducts = (query) => api.get('/pos/products/search', { params: { query } });
export const syncAllPOSProducts = () => api.post('/pos/products/sync');
export const getLocalPOSProducts = (params) => api.get('/pos/products/local', { params });
export const updatePOSProductPrice = (id, data) => api.put(`/pos/products/${id}/price`, data);
export const updatePOSProductDetails = (id, data) => api.put(`/pos/products/${id}/details`, data);
export const createPOSProduct = (data) => api.post('/pos/products/create', data);
export const bulkPOSPriceUpdate = (products) => api.post('/pos/products/bulk-price-update', { products });
export const fetchPOSCustomers = () => api.get('/pos/customers');
export const syncPOSCustomers = () => api.post('/pos/customers/sync');
export const fetchPOSDepartments = () => api.get('/pos/departments');
export const getPOSVendors = () => api.get('/pos/vendors');
export const getPOSTaxesFees = () => api.get('/pos/taxes-fees');
export const getPOSLogs = () => api.get('/pos/logs');
export const debugPOSProductsRaw = () => api.get('/pos/debug/products-raw');

// Fee Mappings
export const getFeeMappings = () => api.get('/fees-mappings');
export const upsertFeeMapping = (mapping) => api.post('/fees-mappings', mapping);
export const deleteFeeMapping = (id) => api.delete(`/fees-mappings/${id}`);

// Sales Analytics
export const getSalesDaily = (params) => api.get('/sales/daily', { params }).then(r => r.data);
export const getSalesWeekly = (params) => api.get('/sales/weekly', { params }).then(r => r.data);
export const getSalesMonthly = (params) => api.get('/sales/monthly', { params }).then(r => r.data);
export const getSalesMonthlyComparison = () => api.get('/sales/monthly-comparison').then(r => r.data);
export const getDepartmentSales = (params) => api.get('/sales/departments', { params }).then(r => r.data);
export const getDepartmentComparison = (params) => api.get('/sales/departments/comparison', { params }).then(r => r.data);
export const getTopProducts = (params) => api.get('/sales/products/top', { params }).then(r => r.data);
export const getProductsGrouped = (params) => api.get('/sales/products/grouped', { params }).then(r => r.data);
export const getProductMovement = (params) => api.get('/sales/products/movement', { params }).then(r => r.data);
export const getDailyProductMovement = (params) => api.get('/sales/products/daily-movement', { params }).then(r => r.data);
export const getProduct52WeekStats = (params) => api.get('/sales/products/52week-stats', { params }).then(r => r.data);
export const getSalesPredictionsDaily = (params) => api.get('/sales/predictions/daily', { params }).then(r => r.data);
export const getSalesPredictionsWeekly = (params) => api.get('/sales/predictions/weekly', { params }).then(r => r.data);
export const getSalesPredictionsHourly = (params) => api.get('/sales/predictions/hourly', { params }).then(r => r.data);
export const getSalesPredictionsMonthly = (params) => api.get('/sales/predictions/monthly', { params }).then(r => r.data);
export const getSalesPredictionsFactors = (params) => api.get('/sales/predictions/factors', { params }).then(r => r.data);
export const getSalesPredictionsResiduals = (params) => api.get('/sales/predictions/residuals', { params }).then(r => r.data);
export const getVendorOrders = () => api.get('/sales/vendor-orders').then(r => r.data);

// Sales + Weather Combined
export const getSalesDailyWithWeather = (params) => api.get('/sales/daily-with-weather', { params }).then(r => r.data);
export const getSalesWeeklyWithWeather = (params) => api.get('/sales/weekly-with-weather', { params }).then(r => r.data);
export const getSalesMonthlyWithWeather = (params) => api.get('/sales/monthly-with-weather', { params }).then(r => r.data);
export const getSalesYearlyWithWeather = (params) => api.get('/sales/yearly-with-weather', { params }).then(r => r.data);
export const getRealtimeSales = (params) => api.get('/sales/realtime', { params }).then(r => r.data);

// ── Vendor Orders / Purchase Orders ──────────────────────────────────────────
export const getOrderSuggestions    = ()       => api.get('/vendor-orders/suggestions').then(r => r.data);
export const generatePurchaseOrders = (data)   => api.post('/vendor-orders/generate', data).then(r => r.data);
export const listPurchaseOrders     = (params) => api.get('/vendor-orders/purchase-orders', { params }).then(r => r.data);
export const getPurchaseOrder       = (id)     => api.get(`/vendor-orders/purchase-orders/${id}`).then(r => r.data);
export const updatePurchaseOrder    = (id, d)  => api.put(`/vendor-orders/purchase-orders/${id}`, d).then(r => r.data);
export const submitPurchaseOrder    = (id)     => api.post(`/vendor-orders/purchase-orders/${id}/submit`).then(r => r.data);
export const receivePurchaseOrder   = (id, d)  => api.post(`/vendor-orders/purchase-orders/${id}/receive`, d).then(r => r.data);
export const deletePurchaseOrder    = (id)     => api.delete(`/vendor-orders/purchase-orders/${id}`).then(r => r.data);
export const approvePurchaseOrder   = (id, d)  => api.post(`/vendor-orders/purchase-orders/${id}/approve`, d).then(r => r.data);
export const rejectPurchaseOrder    = (id, d)  => api.post(`/vendor-orders/purchase-orders/${id}/reject`, d).then(r => r.data);
export const receiveByInvoice       = (data)   => api.post('/vendor-orders/receive-by-invoice', data).then(r => r.data);
export const getCostVariance        = (params) => api.get('/vendor-orders/cost-variance', { params }).then(r => r.data);
export const getVendorPerformance   = (params) => api.get('/vendor-orders/vendor-performance', { params }).then(r => r.data);
export const getPurchaseOrderPDF    = (id)     => api.get(`/vendor-orders/purchase-orders/${id}/pdf`, { responseType: 'blob' });

// Vendor Returns
export const listVendorReturns      = (params) => api.get('/vendor-returns', { params }).then(r => r.data);
export const getVendorReturn        = (id)     => api.get(`/vendor-returns/${id}`).then(r => r.data);
export const createVendorReturn     = (data)   => api.post('/vendor-returns', data).then(r => r.data);
export const submitVendorReturn     = (id)     => api.post(`/vendor-returns/${id}/submit`).then(r => r.data);
export const recordVendorCredit     = (id, d)  => api.post(`/vendor-returns/${id}/credit`, d).then(r => r.data);
export const closeVendorReturn      = (id)     => api.post(`/vendor-returns/${id}/close`).then(r => r.data);
export const deleteVendorReturn     = (id)     => api.delete(`/vendor-returns/${id}`).then(r => r.data);
export const createManualPO         = (data)   => api.post('/vendor-orders/purchase-orders', data).then(r => r.data);

// Inventory Adjustments
export const createInventoryAdjustment = (data)   => api.post('/inventory/adjustments', data).then(r => r.data);
export const listInventoryAdjustments  = (params) => api.get('/inventory/adjustments', { params }).then(r => r.data);
export const getAdjustmentSummary      = (params) => api.get('/inventory/adjustments/summary', { params }).then(r => r.data);

// ── Label Queue ──────────────────────────────────────────────────────────────
export const getLabelQueue      = (params) => api.get('/label-queue', { params }).then(r => r.data);
export const getLabelQueueCount = ()       => api.get('/label-queue/count').then(r => r.data);
export const addToLabelQueue    = (data)   => api.post('/label-queue/add', data).then(r => r.data);
export const printLabelQueue    = (data)   => api.post('/label-queue/print', data).then(r => r.data);
export const dismissLabelQueue  = (data)   => api.post('/label-queue/dismiss', data).then(r => r.data);

// ── Label Print Jobs (routed via cashier-app Electron bridge) ───────────────
// Portal submits ZPL here when direct Zebra Browser Print is blocked by
// Chrome LNA on public HTTPS origins.
export const submitLabelPrintJob    = (data)   => api.post('/label-print-jobs', data).then(r => r.data);
export const getLabelPrintJobs      = (params) => api.get('/label-print-jobs', { params }).then(r => r.data);
export const getLabelPrintJob       = (id)     => api.get(`/label-print-jobs/${id}`).then(r => r.data);
export const retryLabelPrintJob     = (id)     => api.post(`/label-print-jobs/${id}/retry`).then(r => r.data);

// ── Reports Hub ─────────────────────────────────────────────────────────────
// Session 64 — ReportsHub deleted, only 3 surviving sub-reports remain. The
// 5 unused helpers (getReportSummary/Tax/Events/Receive/HouseAccounts) and
// their backend routes are gone. Kept here:
//  - getReportInventory  → InventoryStatus  (mounted in InventoryCount tab)
//  - getReportCompare    → PeriodCompare    (mounted in AnalyticsHub tab)
//  - getReportNotes      → TxNotes          (mounted in POSReports tab)
export const getReportInventory     = (params) => api.get('/reports/hub/inventory', { params }).then(r => r.data);
export const getReportCompare       = (params) => api.get('/reports/hub/compare', { params }).then(r => r.data);
export const getReportNotes         = (params) => api.get('/reports/hub/notes', { params }).then(r => r.data);

// ── Chat ────────────────────────────────────────────────────────────────────
export const getChatChannels  = ()       => api.get('/chat/channels').then(r => r.data);
export const getChatMessages  = (params) => api.get('/chat/messages', { params }).then(r => r.data);
export const sendChatMessage  = (data)   => api.post('/chat/messages', data).then(r => r.data);
export const markChatRead     = (data)   => api.post('/chat/read', data).then(r => r.data);
export const getChatUnread    = ()       => api.get('/chat/unread').then(r => r.data);
export const getChatUsers     = ()       => api.get('/chat/users').then(r => r.data);

// ── Chat: partner (cross-org trading-partner DMs) ───────────────────────────
export const getPartnerChatChannels = ()       => api.get('/chat/partner/channels').then(r => r.data);
export const getPartnerChatMessages = (params) => api.get('/chat/partner/messages', { params }).then(r => r.data);
export const sendPartnerChatMessage = (data)   => api.post('/chat/partner/messages', data).then(r => r.data);
export const markPartnerChatRead    = (data)   => api.post('/chat/partner/read', data).then(r => r.data);

// ── Tasks ───────────────────────────────────────────────────────────────────
export const getTasks          = (params) => api.get('/tasks', { params }).then(r => r.data);
export const createTask        = (data)   => api.post('/tasks', data).then(r => r.data);
export const updateTask        = (id, d)  => api.put(`/tasks/${id}`, d).then(r => r.data);
export const deleteTask        = (id)     => api.delete(`/tasks/${id}`).then(r => r.data);
export const getMyTasks        = ()       => api.get('/tasks/my').then(r => r.data);
export const getTaskCounts     = ()       => api.get('/tasks/counts').then(r => r.data);

// ── Audit Logs ──────────────────────────────────────────────────────────────
export const getAuditLogs      = (params) => api.get('/audit', { params }).then(r => r.data);

// ── Delivery Platform Integrations ──────────────────────────────────────────
export const getIntegrationPlatforms   = ()          => api.get('/integrations/platforms').then(r => r.data);
export const connectIntegration        = (data)      => api.post('/integrations/connect', data).then(r => r.data);
export const disconnectIntegration     = (data)      => api.delete('/integrations/disconnect', { data }).then(r => r.data);
export const getIntegrationSettings    = (platform)  => api.get(`/integrations/settings/${platform}`).then(r => r.data);
export const updateIntegrationSettings = (platform, d) => api.put(`/integrations/settings/${platform}`, d).then(r => r.data);
export const syncIntegrationInventory  = (data)      => api.post('/integrations/sync-inventory', data).then(r => r.data);
export const previewIntegrationImpact  = (data)      => api.post('/integrations/preview-impact', data).then(r => r.data);  // S71 dry-run
export const getIntegrationOrders      = (params)    => api.get('/integrations/orders', { params }).then(r => r.data);
export const getIntegrationOrder       = (id)        => api.get(`/integrations/orders/${id}`).then(r => r.data);
export const confirmIntegrationOrder   = (id)        => api.put(`/integrations/orders/${id}/confirm`).then(r => r.data);
export const readyIntegrationOrder     = (id)        => api.put(`/integrations/orders/${id}/ready`).then(r => r.data);
export const cancelIntegrationOrder    = (id, data)  => api.put(`/integrations/orders/${id}/cancel`, data).then(r => r.data);
export const getIntegrationAnalytics   = (params)    => api.get('/integrations/analytics', { params }).then(r => r.data);

// Weather
export const getWeatherRange = (params) => api.get('/weather/range', { params }).then(r => r.data);
export const getCurrentWeather = () => api.get('/weather/current').then(r => r.data);
export const getStoreLocation = () => api.get('/weather/store-location').then(r => r.data);
export const updateStoreLocation = (data) => api.put('/weather/store-location', data).then(r => r.data);

// ── Tenant (Organisation) ─────────────────────────────────────────────────
export const createTenant      = (data) => api.post('/tenants', data).then(r => r.data);
export const getMyTenant       = ()     => api.get('/tenants/me').then(r => r.data);
export const updateMyTenant    = (data) => api.put('/tenants/me', data).then(r => r.data);
export const deleteMyTenant    = (confirmName) => api.delete('/tenants/me', { data: { confirmName } }).then(r => r.data);
export const updateTenantPlan  = (plan) => api.put('/tenants/me/plan', { plan }).then(r => r.data);

// ── Stores ────────────────────────────────────────────────────────────────
export const getStores          = ()           => api.get('/stores').then(r => r.data);
export const getStoreById       = (id)         => api.get(`/stores/${id}`).then(r => r.data);
export const createStore        = (data)       => api.post('/stores', data).then(r => r.data);
export const updateStore        = (id, data)   => api.put(`/stores/${id}`, data).then(r => r.data);
export const deactivateStore    = (id)         => api.delete(`/stores/${id}`).then(r => r.data);
export const getStoreBillingSummary = ()       => api.get('/stores/billing-summary').then(r => r.data);
export const getStoreBranding        = (storeId)       => api.get(`/stores/${storeId}/branding`).then(r => r.data);
export const updateStoreBranding     = (storeId, data) => api.put(`/stores/${storeId}/branding`, data).then(r => r.data);

// ── User Management ───────────────────────────────────────────────────────
export const getTenantUsers  = ()           => api.get('/users').then(r => r.data);
export const inviteUser      = (data)       => api.post('/users/invite', data).then(r => r.data);
export const updateUserRole  = (id, data)   => api.put(`/users/${id}/role`, data).then(r => r.data);
export const removeUser      = (id)         => api.delete(`/users/${id}`).then(r => r.data);
export const setCashierPin    = (userId, pin) => api.put(`/users/${userId}/pin`, { pin }).then(r => r.data);
export const removeCashierPin = (userId)      => api.delete(`/users/${userId}/pin`).then(r => r.data);

// ── Self-service per-store POS PIN ────────────────────────────────────────
// Any authenticated user can set their own register PIN per store they can
// access. Owners can set a PIN at any store in their org (auto-creates the
// UserStore row); others can only set PINs at stores they're a member of.
export const listMyPins   = ()                => api.get ('/users/me/pins').then(r => r.data);
export const setMyPin     = (storeId, pin)    => api.put ('/users/me/pin', { storeId, pin }).then(r => r.data);
export const removeMyPin  = (storeId)         => api.delete(`/users/me/pin/${storeId}`).then(r => r.data);

// ── Self-service profile ──────────────────────────────────────────────────
// Any authenticated user can view + edit their own profile. Email/role
// changes deliberately go through admin flows — these helpers only cover
// name, phone, and password rotation.
export const getMyProfile     = ()                    => api.get ('/users/me').then(r => r.data);
export const updateMyProfile  = (data)                => api.put ('/users/me', data).then(r => r.data);
export const changeMyPassword = (currentPassword, newPassword) =>
  api.put('/users/me/password', { currentPassword, newPassword }).then(r => r.data);

// ── US State catalog (read-only for portal users; superadmin CRUD lives in admin-app) ──
export const listStatesPublic        = ()            => api.get('/states/public').then(r => r.data);
export const getStatePublic          = (code)        => api.get(`/states/${code}`).then(r => r.data);
export const setStoreStateCode       = (storeId, stateCode) => api.put(`/stores/${storeId}/state`, { stateCode }).then(r => r.data);
export const applyStoreStateDefaults = (storeId)     => api.post(`/stores/${storeId}/apply-state-defaults`).then(r => r.data);

// ── Quick Buttons (cashier home-screen tile layout) ────────────────────
export const getQuickButtonLayout    = (storeId)     => api.get('/quick-buttons', { params: { storeId } }).then(r => r.data);
export const saveQuickButtonLayout   = (data)        => api.put('/quick-buttons', data).then(r => r.data);
export const clearQuickButtonLayout  = (storeId)     => api.delete('/quick-buttons', { data: { storeId } }).then(r => r.data);
export const listQuickButtonActions  = ()            => api.get('/quick-buttons/actions').then(r => r.data);
export const uploadQuickButtonImage  = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post('/quick-buttons/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);
};

// ── Invitations ────────────────────────────────────────────────────────────
// Portal endpoints (auth-scoped to active org):
export const getInvitations      = (params)   => api.get('/invitations', { params }).then(r => r.data);
// `headers` lets transfer-ownership callers pin the X-Store-Id header to
// the store being transferred (so the backend derives req.orgId from the
// target, not the user's currently-active store).
export const createInvitation    = (data, headers) =>
  api.post('/invitations', data, headers ? { headers } : undefined).then(r => r.data);
export const resendInvitation    = (id)       => api.post(`/invitations/${id}/resend`).then(r => r.data);
export const revokeInvitation    = (id)       => api.delete(`/invitations/${id}`).then(r => r.data);
// Public endpoints (token is the auth):
export const getInvitationByToken = (token)   => api.get(`/invitations/${token}`).then(r => r.data);
export const acceptInvitation     = (token, body = {}) => api.post(`/invitations/${token}/accept`, body).then(r => r.data);

// ── Catalog — Departments ─────────────────────────────────────────────────
export const getCatalogDepartments  = (params) => api.get('/catalog/departments', { params }).then(r => r.data);
export const createCatalogDepartment= (data)   => api.post('/catalog/departments', data).then(r => r.data);
export const updateCatalogDepartment= (id, d)  => api.put(`/catalog/departments/${id}`, d).then(r => r.data);
// S72 (C7) — force-push dept defaults onto every active product in the dept.
// Body: { fields?: ['ageRequired','ebtEligible','taxClass'] } (default: all).
// Response: { updated: number, fieldsApplied: string[] }
export const applyDepartmentTemplate = (id, fields) =>
  api.post(`/catalog/departments/${id}/apply`, fields ? { fields } : {}).then(r => r.data);

// S73 — Expiry tracking + dead-stock report
export const listExpiry           = (params)         => api.get('/catalog/expiry', { params }).then(r => r.data);
export const getExpirySummary     = (params)         => api.get('/catalog/expiry/summary', { params }).then(r => r.data);
export const setProductExpiry     = (productId, body) => api.put(`/catalog/expiry/${productId}`, body).then(r => r.data);
export const clearProductExpiry   = (productId)      => api.delete(`/catalog/expiry/${productId}`).then(r => r.data);
export const getDeadStock         = (params)         => api.get('/catalog/dead-stock', { params }).then(r => r.data);

// F28 / S74 — AI-driven promo suggestions (review queue)
export const listPromoSuggestions    = (params)       => api.get('/promo-suggestions', { params }).then(r => r.data);
export const getPromoSuggestion      = (id)           => api.get(`/promo-suggestions/${id}`).then(r => r.data);
export const updatePromoSuggestion   = (id, body)     => api.put(`/promo-suggestions/${id}`, body).then(r => r.data);
export const generatePromoSuggestions = ()            => api.post('/promo-suggestions/generate', {}).then(r => r.data);
export const approvePromoSuggestion  = (id, body)     => api.post(`/promo-suggestions/${id}/approve`, body || {}).then(r => r.data);
export const rejectPromoSuggestion   = (id, reason)   => api.post(`/promo-suggestions/${id}/reject`, { reason }).then(r => r.data);
export const dismissPromoSuggestion  = (id)           => api.post(`/promo-suggestions/${id}/dismiss`, {}).then(r => r.data);
// Pass `{ force: true }` to cascade-detach products assigned to this dept.
// Without force, returns 409 `code: 'IN_USE'` + `usageCount` if any products
// still reference it.
export const deleteCatalogDepartment= (id, opts = {}) =>
  api.delete(`/catalog/departments/${id}`, { params: opts.force ? { force: 'true' } : {} }).then(r => r.data);

// ── Catalog — Vendors ─────────────────────────────────────────────────────
export const getCatalogVendors   = (params) => api.get('/catalog/vendors', { params }).then(r => r.data);
export const getCatalogVendor    = (id)     => api.get(`/catalog/vendors/${id}`).then(r => r.data);
export const createCatalogVendor = (data)   => api.post('/catalog/vendors', data).then(r => r.data);
export const updateCatalogVendor = (id, d)  => api.put(`/catalog/vendors/${id}`, d).then(r => r.data);
// Pass `{ force: true }` to cascade-detach products assigned to this vendor.
export const deleteCatalogVendor = (id, opts = {}) =>
  api.delete(`/catalog/vendors/${id}`, { params: opts.force ? { force: 'true' } : {} }).then(r => r.data);
export const getVendorProducts   = (id, params) => api.get(`/catalog/vendors/${id}/products`, { params }).then(r => r.data);

// ── Catalog — Product ↔ Vendor mappings (per-vendor item code + cost) ─────
// One MasterProduct can have N vendors. `isPrimary: true` mapping's
// vendorItemCode mirrors back into MasterProduct.itemCode for legacy readers.
// getProductVendors returns `{ success, data: [{ id, vendorId, vendor, vendorItemCode, priceCost, caseCost, packInCase, isPrimary, lastReceivedAt, ... }] }`.
export const getProductVendors     = (productId)           => api.get(`/catalog/products/${productId}/vendor-mappings`).then(r => r.data);
export const createProductVendor   = (productId, data)     => api.post(`/catalog/products/${productId}/vendor-mappings`, data).then(r => r.data);
export const updateProductVendor   = (productId, id, data) => api.put(`/catalog/products/${productId}/vendor-mappings/${id}`, data).then(r => r.data);
export const deleteProductVendor   = (productId, id)       => api.delete(`/catalog/products/${productId}/vendor-mappings/${id}`).then(r => r.data);
export const makeProductVendorPrimary = (productId, id)    => api.post(`/catalog/products/${productId}/vendor-mappings/${id}/make-primary`).then(r => r.data);
export const getVendorPayouts    = (id, params) => api.get(`/catalog/vendors/${id}/payouts`, { params }).then(r => r.data);
export const getVendorStats      = (id)     => api.get(`/catalog/vendors/${id}/stats`).then(r => r.data);

// ── Catalog — Tax Rules ───────────────────────────────────────────────────
export const getCatalogTaxRules   = (params) => api.get('/catalog/tax-rules', { params }).then(r => r.data);
export const createCatalogTaxRule = (d) => api.post('/catalog/tax-rules', d).then(r => r.data);
export const updateCatalogTaxRule = (id, d) => api.put(`/catalog/tax-rules/${id}`, d).then(r => r.data);
export const deleteCatalogTaxRule = (id) => api.delete(`/catalog/tax-rules/${id}`).then(r => r.data);

// ── Catalog — Deposit Rules ───────────────────────────────────────────────
export const getCatalogDepositRules   = () => api.get('/catalog/deposit-rules').then(r => r.data);
export const createCatalogDepositRule = (d) => api.post('/catalog/deposit-rules', d).then(r => r.data);
export const updateCatalogDepositRule = (id, d) => api.put(`/catalog/deposit-rules/${id}`, d).then(r => r.data);

// ── Catalog — Master Products ─────────────────────────────────────────────
export const getCatalogProducts     = (params) => api.get('/catalog/products', { params }).then(r => r.data);
export const searchCatalogProducts  = (q, params) => api.get('/catalog/products/search', { params: { q, ...params } }).then(r => r.data);
export const getCatalogProduct      = (id)     => api.get(`/catalog/products/${id}`).then(r => r.data);
export const createCatalogProduct   = (data)   => api.post('/catalog/products', data).then(r => r.data);
export const updateCatalogProduct   = (id, d)  => api.put(`/catalog/products/${id}`, d).then(r => r.data);
export const deleteCatalogProduct   = (id)     => api.delete(`/catalog/products/${id}`).then(r => r.data);
export const bulkUpdateCatalogProducts = (updates) => api.post('/catalog/products/bulk-update', { updates }).then(r => r.data);
export const bulkDeleteCatalogProducts = (ids, permanent = false) => api.post('/catalog/products/bulk-delete', { ids, permanent }).then(r => r.data);
export const deleteAllCatalogProducts  = (confirmation, permanent = false) => api.post('/catalog/products/delete-all', { confirmation, permanent }).then(r => r.data);
export const duplicateCatalogProduct   = (id) => api.post(`/catalog/products/${id}/duplicate`).then(r => r.data);

// ── Catalog — Product Groups ──────────────────────────────────────────────
export const listProductGroups    = (params) => api.get('/catalog/groups', { params }).then(r => r.data);
export const getProductGroup      = (id)     => api.get(`/catalog/groups/${id}`).then(r => r.data);
export const createProductGroup   = (data)   => api.post('/catalog/groups', data).then(r => r.data);
export const updateProductGroup   = (id, d)  => api.put(`/catalog/groups/${id}`, d).then(r => r.data);
export const deleteProductGroup   = (id)     => api.delete(`/catalog/groups/${id}`).then(r => r.data);
export const applyGroupTemplate   = (id)     => api.post(`/catalog/groups/${id}/apply`).then(r => r.data);
export const addProductsToGroup   = (id, productIds, applyTemplate = true) =>
  api.post(`/catalog/groups/${id}/add-products`, { productIds, applyTemplate }).then(r => r.data);
export const removeProductsFromGroup = (id, productIds) =>
  api.post(`/catalog/groups/${id}/remove-products`, { productIds }).then(r => r.data);
export const bulkSetDepartment         = (ids, departmentId)      => api.post('/catalog/products/bulk-department', { ids, departmentId }).then(r => r.data);
export const bulkToggleActive          = (ids, active)            => api.post('/catalog/products/bulk-active', { ids, active }).then(r => r.data);

// ── Catalog — Store Products ──────────────────────────────────────────────
export const getStoreInventory      = (params) => api.get('/catalog/store-products', { params }).then(r => r.data);
export const upsertStoreInventory   = (data)   => api.post('/catalog/store-products', data).then(r => r.data);
export const adjustStoreStock       = (data)   => api.put('/catalog/store-products/stock', data).then(r => r.data);

// ── Catalog — Promotions ──────────────────────────────────────────────────
export const getCatalogPromotions    = (params) => api.get('/catalog/promotions', { params }).then(r => r.data);
export const createCatalogPromotion  = (data)   => api.post('/catalog/promotions', data).then(r => r.data);
export const updateCatalogPromotion  = (id, d)  => api.put(`/catalog/promotions/${id}`, d).then(r => r.data);
export const deleteCatalogPromotion  = (id)     => api.delete(`/catalog/promotions/${id}`).then(r => r.data);
export const evaluateCatalogPromotions = (items) => api.post('/catalog/promotions/evaluate', { items }).then(r => r.data);

// ── Catalog — helper aliases ──────────────────────────────────────────────
export const getMasterProducts = (params) => api.get('/catalog/products', { params }).then(r => r.data);
export const getDepartments    = ()        => api.get('/catalog/departments').then(r => r.data);

// ─── Bulk Import ─────────────────────────────────────────────────────────────
export const previewImport = (formData) =>
  api.post('/catalog/import/preview', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);

export const commitImport = (formData) =>
  api.post('/catalog/import/commit', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);

export const downloadImportTemplate = (type) =>
  api.get(`/catalog/import/template/${type}`, { responseType: 'blob' }).then(r => r.data);

// Session 2 — full product catalog export (active store's overrides included)
export const exportProductsCsv = (params = {}) =>
  api.get('/catalog/products/export', { params, responseType: 'blob' });

// Session 5 — vendor templates (retailer pick + preview)
export const listVendorTemplates  = (params = {}) => api.get('/vendor-templates', { params }).then(r => r.data);
export const getVendorTemplate    = (id)          => api.get(`/vendor-templates/${id}`).then(r => r.data);
export const previewVendorTemplate= (id, rows)    => api.post(`/vendor-templates/${id}/preview`, { rows }).then(r => r.data);

// Session 4 — department-scoped attributes
export const getDepartmentAttributes     = (params = {}) => api.get('/catalog/department-attributes', { params }).then(r => r.data);
export const createDepartmentAttribute   = (data)        => api.post('/catalog/department-attributes', data).then(r => r.data);
export const updateDepartmentAttribute   = (id, data)    => api.put(`/catalog/department-attributes/${id}`, data).then(r => r.data);
export const deleteDepartmentAttribute   = (id)          => api.delete(`/catalog/department-attributes/${id}`).then(r => r.data);
export const applyStandardDeptAttributes = (deptId)      => api.post(`/catalog/departments/${deptId}/apply-standard-attributes`).then(r => r.data);

export const getImportHistory = (params) =>
  api.get('/catalog/import/history', { params }).then(r => r.data);

// ── Lottery ───────────────────────────────────────────────────────────────────
// Helper: controllers return either a plain value or { success, data } — unwrap both
const lotteryUnwrap = (r) => r.data?.data ?? r.data;

export const getLotteryGames          = (params) => api.get('/lottery/games', { params }).then(lotteryUnwrap);
export const createLotteryGame        = (data)   => api.post('/lottery/games', data).then(lotteryUnwrap);
export const updateLotteryGame        = (id, d)  => api.put(`/lottery/games/${id}`, d).then(lotteryUnwrap);
export const deleteLotteryGame        = (id)     => api.delete(`/lottery/games/${id}`).then(lotteryUnwrap);

export const getLotteryBoxes          = (params) => api.get('/lottery/boxes', { params }).then(lotteryUnwrap);
export const receiveLotteryBoxOrder   = (data)   => api.post('/lottery/boxes/receive', data).then(lotteryUnwrap);
export const activateLotteryBox       = (id, d)  => api.put(`/lottery/boxes/${id}/activate`, d).then(lotteryUnwrap);
export const updateLotteryBox         = (id, d)  => api.put(`/lottery/boxes/${id}`, d).then(lotteryUnwrap);
export const deleteLotteryBox         = (id)     => api.delete(`/lottery/boxes/${id}`).then(lotteryUnwrap);
export const adjustLotteryBoxTickets  = (id, d)  => api.post(`/lottery/boxes/${id}/adjust`, d).then(lotteryUnwrap);

// Phase 1a: scan + location lifecycle endpoints
export const scanLotteryBarcode       = (data)   => api.post('/lottery/scan', data).then(lotteryUnwrap);
// Parse-only: used by the Receive Books scan flow to decode a barcode
// without running the full scan engine (which rejects books that haven't
// been received yet — the exact state we're in when RECEIVING them).
export const parseLotteryBarcode      = (raw)    => api.post('/lottery/scan/parse', { raw }).then(lotteryUnwrap);
export const moveLotteryBoxToSafe     = (id, d)  => api.post(`/lottery/boxes/${id}/move-to-safe`, d).then(lotteryUnwrap);
export const soldoutLotteryBox        = (id, d)  => api.post(`/lottery/boxes/${id}/soldout`, d).then(lotteryUnwrap);
// Undo a soldout — flips depleted → active, restores currentTicket from
// the prior close_day_snapshot, neutralises the inflated soldout-day sale.
export const restoreLotteryBoxToCounter = (id, d) => api.post(`/lottery/boxes/${id}/restore-to-counter`, d).then(lotteryUnwrap);
export const returnLotteryBoxToLotto  = (id, d)  => api.post(`/lottery/boxes/${id}/return-to-lotto`, d).then(lotteryUnwrap);
export const cancelLotteryPendingMove = (id)     => api.delete(`/lottery/boxes/${id}/pending-move`).then(lotteryUnwrap);
export const runLotteryPendingMoves   = ()       => api.post('/lottery/run-pending-moves').then(lotteryUnwrap);

// Phase 1b: Daily Scan + Online Totals
export const getLotteryOnlineTotal    = (params) => api.get('/lottery/online-total', { params }).then(lotteryUnwrap);
export const upsertLotteryOnlineTotal = (data)   => api.put('/lottery/online-total', data).then(lotteryUnwrap);
export const getDailyLotteryInventory = (params) => api.get('/lottery/daily-inventory', { params }).then(lotteryUnwrap);
// Map of { [boxId]: { ticket, ticketsSold, closedAt } } from the last
// close_day_snapshot before the given date. Drives the "yesterday" column
// on the Daily page's Counter list so day-to-day rollover works.
export const getLotteryYesterdayCloses = (params) =>
  api.get('/lottery/yesterday-closes', { params }).then(lotteryUnwrap);
// Date-scoped Counter view — returns the books that were on the counter
// on the given date, each decorated with openingTicket (= yesterday's
// close) and currentTicket (= that day's close, or live value if today).
// Replaces client-side composition of getLotteryBoxes + yesterdayCloses
// so navigating the calendar strip shows historically correct numbers.
export const getLotteryCounterSnapshot = (params) =>
  api.get('/lottery/counter-snapshot', { params }).then(lotteryUnwrap);
// Edit a historical day's close ticket (manual mode on past Counter rows).
// Body: { boxId, date: 'YYYY-MM-DD', ticket }. Pass `ticket: null` to
// delete the snapshot.
export const upsertLotteryHistoricalClose = (data) =>
  api.put('/lottery/historical-close', data).then(lotteryUnwrap);
// May 2026 — `closeLotteryDay` removed. Pending-move sweep runs every 15
// min via the backend scheduler; per-book snapshots come from the cashier-
// app EoD wizard's `saveLotteryShiftReport`. The button was redundant +
// caused duplicate snapshots when admins clicked it multiple times.

// Phase 2: Weekly Settlement
export const listLotterySettlements      = (params)        => api.get('/lottery/settlements', { params }).then(lotteryUnwrap);
export const getLotterySettlement        = (weekStart)     => api.get(`/lottery/settlements/${weekStart}`).then(lotteryUnwrap);
export const upsertLotterySettlement     = (weekStart, d)  => api.put(`/lottery/settlements/${weekStart}`, d).then(lotteryUnwrap);
export const finalizeLotterySettlement   = (weekStart, d)  => api.post(`/lottery/settlements/${weekStart}/finalize`, d).then(lotteryUnwrap);
export const markLotterySettlementPaid   = (weekStart, d)  => api.post(`/lottery/settlements/${weekStart}/paid`, d).then(lotteryUnwrap);

export const getLotteryTransactions   = (params) => api.get('/lottery/transactions', { params }).then(lotteryUnwrap);

// ── Vendor Payments (back-office) ─────────────────────────────────────────
export const getVendorPayments        = (params) => api.get('/catalog/vendor-payments', { params }).then(r => r.data);
export const createVendorPaymentEntry = (data)   => api.post('/catalog/vendor-payments', data).then(r => r.data);
export const updateVendorPaymentEntry = (id, d)  => api.put(`/catalog/vendor-payments/${id}`, d).then(r => r.data);

// ── Vendor Credits — free-case receipts, mix-and-match, damaged-goods ────
export const getVendorCredits         = (params) => api.get('/catalog/vendor-credits',  { params }).then(r => r.data);
export const createVendorCreditEntry  = (data)   => api.post('/catalog/vendor-credits', data).then(r => r.data);
export const updateVendorCreditEntry  = (id, d)  => api.put(`/catalog/vendor-credits/${id}`,    d).then(r => r.data);
export const deleteVendorCreditEntry  = (id)     => api.delete(`/catalog/vendor-credits/${id}`).then(r => r.data);

// POS Transactions
export const getTransactions = (params) => api.get('/pos-terminal/transactions', { params }).then(r => r.data);

// POS Event Log (No Sale, etc.)
export const getPosEvents = (params) => api.get('/pos-terminal/events', { params }).then(r => r.data);

// POS cash-drawer shifts — list (with ?status=open filter) + close. Used by the
// back-office End of Day page to close out a cashier's shift when they forgot to.
export const listPosShifts   = (params) => api.get('/pos-terminal/shifts', { params }).then(r => r.data);
export const getActivePosShift = (storeId) => api.get('/pos-terminal/shift/active', { params: { storeId } }).then(r => r.data);
export const openPosShift    = (body)      => api.post('/pos-terminal/shift/open', body).then(r => r.data);
export const closePosShift   = (id, body)  => api.post(`/pos-terminal/shift/${id}/close`, body).then(r => r.data);
// Stations for a store (back-office picker in Open Shift modal)
export const listPosStations = (storeId)   => api.get('/pos-terminal/stations', { params: { storeId } }).then(r => r.data);

export const getLotteryShiftReports   = (params) => api.get('/lottery/shift-reports', { params }).then(lotteryUnwrap);
export const getLotteryShiftReport    = (shiftId) => api.get(`/lottery/shift-reports/${shiftId}`).then(lotteryUnwrap);

// These return plain objects (no success/data wrapper) — r.data is the object directly
export const getLotteryDashboard      = (params) => api.get('/lottery/dashboard', { params }).then(r => r.data);
export const getLotteryReport         = (params) => api.get('/lottery/report', { params }).then(r => r.data);
export const getLotteryCommissionReport = (params) => api.get('/lottery/commission', { params }).then(r => r.data);

export const getLotterySettings    = (storeId) => api.get('/lottery/settings', { params: { storeId } }).then(r => r.data?.data ?? r.data);
export const updateLotterySettings = (storeId, data) => api.put('/lottery/settings', data, { params: { storeId } }).then(r => r.data?.data ?? r.data);
// Per-day owner audit view — chronological per-shift breakdown with cumulative-reading deltas + reconcileShift drawer math + day-level rollup. Powers the Shift Reports drill-down (Phase D).
export const getLotteryShiftAudit  = (params) => api.get('/lottery/shift-audit', { params }).then(r => r.data);

// ── Lottery Ticket Catalog ────────────────────────────────────────────────────
export const getLotteryCatalog          = (params) => api.get('/lottery/catalog', { params }).then(lotteryUnwrap);
export const getAllLotteryCatalog       = (params) => api.get('/lottery/catalog/all', { params }).then(lotteryUnwrap);
export const createLotteryCatalogTicket = (data)   => api.post('/lottery/catalog', data).then(lotteryUnwrap);
export const updateLotteryCatalogTicket = (id, d)  => api.put(`/lottery/catalog/${id}`, d).then(lotteryUnwrap);
export const deleteLotteryCatalogTicket = (id)     => api.delete(`/lottery/catalog/${id}`).then(lotteryUnwrap);

// ── Lottery Ticket Requests ───────────────────────────────────────────────────
export const getLotteryTicketRequests   = (params) => api.get('/lottery/ticket-requests', { params }).then(lotteryUnwrap);
export const getLotteryPendingCount     = ()        => api.get('/lottery/ticket-requests/pending-count').then(r => r.data?.count ?? 0);
export const createLotteryTicketRequest = (data)   => api.post('/lottery/ticket-requests', data).then(lotteryUnwrap);
export const reviewLotteryTicketRequest = (id, d)  => api.put(`/lottery/ticket-requests/${id}/review`, d).then(lotteryUnwrap);

// ── Receive from Catalog ──────────────────────────────────────────────────────
export const receiveFromLotteryCatalog  = (data)   => api.post('/lottery/boxes/receive-catalog', data).then(lotteryUnwrap);

// ── Fuel Module ──────────────────────────────────────────────────────────────
const fuelUnwrap = (r) => r.data?.data ?? r.data;
export const getFuelTypes        = (params)    => api.get('/fuel/types',  { params }).then(fuelUnwrap);
export const createFuelType      = (data)      => api.post('/fuel/types', data).then(fuelUnwrap);
export const updateFuelType      = (id, data)  => api.put(`/fuel/types/${id}`, data).then(fuelUnwrap);
export const deleteFuelType      = (id)        => api.delete(`/fuel/types/${id}`).then(fuelUnwrap);
export const getFuelSettings     = (storeId)   => api.get('/fuel/settings', { params: { storeId } }).then(fuelUnwrap);
export const updateFuelSettings  = (data)      => api.put('/fuel/settings', data).then(fuelUnwrap);
export const listFuelTransactions = (params)   => api.get('/fuel/transactions', { params }).then(fuelUnwrap);
export const getFuelReport       = (params)    => api.get('/fuel/report',  { params }).then(fuelUnwrap);
export const getFuelDashboard    = (params)    => api.get('/fuel/dashboard', { params }).then(fuelUnwrap);

// ── Fuel Inventory (Session 42) ─────────────────────────────────────────
// Tanks
export const listFuelTanks       = (params)    => api.get('/fuel/tanks', { params }).then(fuelUnwrap);
export const createFuelTank      = (data)      => api.post('/fuel/tanks', data).then(fuelUnwrap);
export const updateFuelTank      = (id, data)  => api.put(`/fuel/tanks/${id}`, data).then(fuelUnwrap);
export const deleteFuelTank      = (id)        => api.delete(`/fuel/tanks/${id}`).then(fuelUnwrap);
// Manifold groups
export const listManifoldGroups  = (params)    => api.get('/fuel/manifold-groups', { params }).then(fuelUnwrap);
export const createManifoldGroup = (data)      => api.post('/fuel/manifold-groups', data).then(fuelUnwrap);
export const updateManifoldGroup = (id, data)  => api.put(`/fuel/manifold-groups/${id}`, data).then(fuelUnwrap);
export const deleteManifoldGroup = (id)        => api.delete(`/fuel/manifold-groups/${id}`).then(fuelUnwrap);
// Deliveries
export const listFuelDeliveries  = (params)    => api.get('/fuel/deliveries', { params }).then(fuelUnwrap);
export const createFuelDelivery  = (data)      => api.post('/fuel/deliveries', data).then(fuelUnwrap);
export const deleteFuelDelivery  = (id)        => api.delete(`/fuel/deliveries/${id}`).then(fuelUnwrap);
// Stick readings
export const listStickReadings   = (params)    => api.get('/fuel/stick-readings', { params }).then(fuelUnwrap);
export const createStickReading  = (data)      => api.post('/fuel/stick-readings', data).then(fuelUnwrap);
export const deleteStickReading  = (id)        => api.delete(`/fuel/stick-readings/${id}`).then(fuelUnwrap);
// Blend configs
export const listBlendConfigs    = (params)    => api.get('/fuel/blend-configs', { params }).then(fuelUnwrap);
export const upsertBlendConfig   = (data)      => api.post('/fuel/blend-configs', data).then(fuelUnwrap);
export const deleteBlendConfig   = (id)        => api.delete(`/fuel/blend-configs/${id}`).then(fuelUnwrap);
// Inventory status + P&L
export const getFuelInventoryStatus = (params) => api.get('/fuel/inventory-status', { params }).then(fuelUnwrap);
export const getFuelPnlReport       = (params) => api.get('/fuel/pnl-report',       { params }).then(fuelUnwrap);

// Pumps (V1.5)
export const listFuelPumps   = (params)   => api.get('/fuel/pumps', { params }).then(fuelUnwrap);
export const createFuelPump  = (data)     => api.post('/fuel/pumps', data).then(fuelUnwrap);
export const updateFuelPump  = (id, data) => api.put(`/fuel/pumps/${id}`, data).then(fuelUnwrap);
export const deleteFuelPump  = (id)       => api.delete(`/fuel/pumps/${id}`).then(fuelUnwrap);
// Recent fuel sales — powers pump-aware refund picker
export const listRecentFuelSales = (params) => api.get('/fuel/recent-sales', { params }).then(fuelUnwrap);
// Full response access (for delivery variance warnings which live outside `data`)
export const createFuelDeliveryWithMeta = (data) => api.post('/fuel/deliveries', data).then(r => r.data);

// ── POS Terminal Config ───────────────────────────────────────────────────────
export const getPOSConfig    = (storeId) => api.get('/pos-terminal/config', { params: { storeId } }).then(r => r.data);
export const updatePOSConfig = (data)    => api.put('/pos-terminal/config', data).then(r => r.data);

// ── Employee Reports & Clock Management ──────────────────────────────────────
export const getEmployeeReport    = (params)     => api.get('/reports/employees',       { params }).then(r => r.data);
// End-of-Day Report (Payouts / Tenders / Transactions)
// Accepts { shiftId } OR { date, storeId, cashierId, stationId } OR { dateFrom, dateTo, ... }
export const getEndOfDayReport    = (params)     => api.get('/reports/end-of-day',       { params }).then(r => r.data);
export const getStoreEmployees    = (params)     => api.get('/reports/employees/list',  { params }).then(r => r.data);
export const getClockEvents       = (params)     => api.get('/reports/clock-events',    { params }).then(r => r.data);
export const createClockSession   = (data)       => api.post('/reports/clock-events',   data).then(r => r.data);
export const updateClockEventEntry = (id, data)  => api.put(`/reports/clock-events/${id}`, data).then(r => r.data);
export const deleteClockEventEntry = (id)        => api.delete(`/reports/clock-events/${id}`).then(r => r.data);

// ── Scan Data / Tobacco compliance (Session 45) ─────────────────────────────
export const listTobaccoManufacturers   = ()               => api.get('/scan-data/manufacturers').then(r => r.data);
export const listScanDataEnrollments    = (params)         => api.get('/scan-data/enrollments', { params }).then(r => r.data);
export const getScanDataEnrollment      = (id)             => api.get(`/scan-data/enrollments/${id}`).then(r => r.data);
export const upsertScanDataEnrollment   = (data)           => api.post('/scan-data/enrollments', data).then(r => r.data);
export const updateEnrollmentStatus     = (id, status)     => api.put(`/scan-data/enrollments/${id}/status`, { status }).then(r => r.data);
export const deleteScanDataEnrollment   = (id)             => api.delete(`/scan-data/enrollments/${id}`).then(r => r.data);
export const listProductMappings        = (params)         => api.get('/scan-data/product-mappings', { params }).then(r => r.data);
export const upsertProductMapping       = (data)           => api.post('/scan-data/product-mappings', data).then(r => r.data);
export const bulkUpsertProductMappings  = (mappings)       => api.post('/scan-data/product-mappings/bulk', { mappings }).then(r => r.data);
export const deleteProductMapping       = (id)             => api.delete(`/scan-data/product-mappings/${id}`).then(r => r.data);
export const listTobaccoProducts        = (params)         => api.get('/scan-data/tobacco-products', { params }).then(r => r.data);
export const listScanDataSubmissions    = (params)         => api.get('/scan-data/submissions', { params }).then(r => r.data);
export const getScanDataSubmissionStats = (params)         => api.get('/scan-data/submissions/stats', { params }).then(r => r.data);
// Session 48 — ack reconciliation
export const getSubmissionAckLines      = (id)             => api.get(`/scan-data/submissions/${id}/ack-lines`).then(r => r.data);
export const processSubmissionAck       = (id, body)       => api.post(`/scan-data/submissions/${id}/process-ack`, body).then(r => r.data);
export const regenerateScanDataSubmission = (body)         => api.post('/scan-data/submissions/regenerate', body).then(r => r.data);
// Session 49 — cert harness
export const generateCertSampleFile       = (body)         => api.post('/scan-data/cert/sample-file', body).then(r => r.data);
export const getEnrollmentCertChecklist   = (enrollmentId) => api.get('/scan-data/cert/checklist', { params: { enrollmentId } }).then(r => r.data);
export const getCertScenarios             = ()             => api.get('/scan-data/cert/scenarios').then(r => r.data);
export const getCertPlaybookByMfr         = (mfrCode)      => api.get(`/scan-data/cert/playbook/${mfrCode}`).then(r => r.data);

// ── Manufacturer Coupons (Session 45) ───────────────────────────────────────
export const listManufacturerCoupons    = (params)         => api.get('/coupons', { params }).then(r => r.data);
export const getManufacturerCoupon      = (id)             => api.get(`/coupons/${id}`).then(r => r.data);
export const createManufacturerCoupon   = (data)           => api.post('/coupons', data).then(r => r.data);
export const updateManufacturerCoupon   = (id, data)       => api.put(`/coupons/${id}`, data).then(r => r.data);
export const deleteManufacturerCoupon   = (id)             => api.delete(`/coupons/${id}`).then(r => r.data);
export const importCouponsCsvData       = (rows)           => api.post('/coupons/import', { rows }).then(r => r.data);
export const listCouponRedemptions      = (params)         => api.get('/coupons/redemptions/list', { params }).then(r => r.data);
export const getCouponRedemptionStats   = (params)         => api.get('/coupons/redemptions/stats', { params }).then(r => r.data);

// ── Public API (no auth) ─────────────────────────────────────────────────────
export const getPublishedCareers        = ()               => api.get('/public/careers').then(r => r.data);
export const getPublishedCmsPage        = (slug)           => api.get(`/public/cms/${slug}`).then(r => r.data);
export const createPublicTicket         = (data)           => api.post('/public/tickets', data).then(r => r.data);

// ── Product UPCs ──────────────────────────────────────────────────────────
export const getProductUpcs    = (id)       => api.get(`/catalog/products/${id}/upcs`).then(r => r.data);
export const addProductUpc     = (id, data) => api.post(`/catalog/products/${id}/upcs`, data).then(r => r.data);
export const deleteProductUpc  = (id, upcId)=> api.delete(`/catalog/products/${id}/upcs/${upcId}`).then(r => r.data);

// ── Product Image Upload ─────────────────────────────────────────────────
export const uploadProductImage = (id, file) => {
  const fd = new FormData();
  fd.append('image', file);
  return api.post(`/catalog/products/${id}/image`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
};

// ── Product Pack Sizes ────────────────────────────────────────────────────
export const getProductPackSizes       = (id)           => api.get(`/catalog/products/${id}/pack-sizes`).then(r => r.data);
export const addProductPackSize        = (id, data)     => api.post(`/catalog/products/${id}/pack-sizes`, data).then(r => r.data);
export const updateProductPackSize     = (id, sid, data)=> api.put(`/catalog/products/${id}/pack-sizes/${sid}`, data).then(r => r.data);
export const deleteProductPackSize     = (id, sid)      => api.delete(`/catalog/products/${id}/pack-sizes/${sid}`).then(r => r.data);
export const bulkReplaceProductPackSizes = (id, sizes)  => api.put(`/catalog/products/${id}/pack-sizes/bulk-replace`, { sizes }).then(r => r.data);

// ── Store Support Tickets ─────────────────────────────────────────────────
export const getOrgTickets      = (params)    => api.get('/tickets',            { params }).then(r => r.data);
export const createOrgTicket    = (data)      => api.post('/tickets',           data).then(r => r.data);
export const getOrgTicket       = (id)        => api.get(`/tickets/${id}`).then(r => r.data);
export const addOrgTicketReply  = (id, data)  => api.post(`/tickets/${id}/reply`, data).then(r => r.data);

// ── Loyalty ───────────────────────────────────────────────────────────────
export const getLoyaltyProgram    = (storeId)    => api.get('/loyalty/program', { params: { storeId } }).then(r => r.data);
export const upsertLoyaltyProgram = (data)       => api.put('/loyalty/program', data).then(r => r.data);

export const getLoyaltyEarnRules   = (storeId)   => api.get('/loyalty/earn-rules', { params: { storeId } }).then(r => r.data);
export const createLoyaltyEarnRule = (data)      => api.post('/loyalty/earn-rules', data).then(r => r.data);
export const updateLoyaltyEarnRule = (id, data)  => api.put(`/loyalty/earn-rules/${id}`, data).then(r => r.data);
export const deleteLoyaltyEarnRule = (id)        => api.delete(`/loyalty/earn-rules/${id}`).then(r => r.data);

export const getLoyaltyRewards    = (storeId)    => api.get('/loyalty/rewards', { params: { storeId } }).then(r => r.data);
export const createLoyaltyReward  = (data)       => api.post('/loyalty/rewards', data).then(r => r.data);
export const updateLoyaltyReward  = (id, data)   => api.put(`/loyalty/rewards/${id}`, data).then(r => r.data);
export const deleteLoyaltyReward  = (id)         => api.delete(`/loyalty/rewards/${id}`).then(r => r.data);

// ── RBAC — Roles & Permissions ───────────────────────────────────────────────
export const getPermissions     = (scope)              => api.get('/roles/permissions', { params: scope ? { scope } : undefined }).then(r => r.data);
export const listRoles          = (params)             => api.get('/roles', { params }).then(r => r.data);
export const getRole            = (id)                 => api.get(`/roles/${id}`).then(r => r.data);
export const createRole         = (data)               => api.post('/roles', data).then(r => r.data);
export const updateRole         = (id, data)           => api.put(`/roles/${id}`, data).then(r => r.data);
export const deleteRole         = (id)                 => api.delete(`/roles/${id}`).then(r => r.data);
export const getUserRolesApi    = (userId)             => api.get(`/roles/users/${userId}/roles`).then(r => r.data);
export const setUserRolesApi    = (userId, roleIds)    => api.put(`/roles/users/${userId}/roles`, { roleIds }).then(r => r.data);
export const getMyPermissions   = ()                   => api.get('/roles/me/permissions').then(r => r.data);

// ─── StoreVeu Exchange ──────────────────────────────────────────────────────────
const exchangeUnwrap = (r) => r.data?.data ?? r.data;
const exchangeFull   = (r) => r.data;

// Store Code
export const getMyStoreCode        = ()          => api.get('/exchange/store-code').then(exchangeUnwrap);
export const checkStoreCode        = (code)      => api.get('/exchange/store-code/check', { params: { code } }).then(exchangeUnwrap);
export const setMyStoreCode        = (code)      => api.put('/exchange/store-code', { code }).then(exchangeUnwrap);
export const lookupStoreByCode     = (code)      => api.get(`/exchange/lookup/${encodeURIComponent(code)}`).then(exchangeUnwrap);

// Trading Partners
export const listTradingPartners        = ()                 => api.get('/exchange/partners').then(exchangeUnwrap);
export const listAcceptedPartners       = ()                 => api.get('/exchange/partners/accepted').then(exchangeUnwrap);
export const listPendingPartnerRequests = ()                 => api.get('/exchange/partners/pending-incoming').then(exchangeFull);
export const sendPartnerRequest         = (data)             => api.post('/exchange/partners', data).then(exchangeUnwrap);
export const acceptPartnerRequest       = (id)               => api.post(`/exchange/partners/${id}/accept`).then(exchangeUnwrap);
export const rejectPartnerRequest       = (id, reason)       => api.post(`/exchange/partners/${id}/reject`, { reason }).then(exchangeUnwrap);
export const revokePartnership          = (id, reason)       => api.post(`/exchange/partners/${id}/revoke`, { reason }).then(exchangeUnwrap);

// Wholesale Orders
export const listWholesaleOrders  = (params)          => api.get('/exchange/orders', { params }).then(exchangeFull);
export const getWholesaleOrder    = (id)              => api.get(`/exchange/orders/${id}`).then(exchangeUnwrap);
export const createWholesaleOrder = (data)            => api.post('/exchange/orders', data).then(exchangeUnwrap);
export const updateWholesaleOrder = (id, data)        => api.put(`/exchange/orders/${id}`, data).then(exchangeUnwrap);
export const deleteWholesaleDraft = (id)              => api.delete(`/exchange/orders/${id}`).then(exchangeUnwrap);
export const sendWholesaleOrder   = (id)              => api.post(`/exchange/orders/${id}/send`).then(exchangeUnwrap);
export const cancelWholesaleOrder = (id, reason)      => api.post(`/exchange/orders/${id}/cancel`, { reason }).then(exchangeUnwrap);
export const rejectWholesaleOrder = (id, reason)      => api.post(`/exchange/orders/${id}/reject`, { reason }).then(exchangeUnwrap);
export const confirmWholesaleOrder= (id, lines)       => api.post(`/exchange/orders/${id}/confirm`, { lines }).then(exchangeUnwrap);
// Session 39 — archive + multi-round dispute
export const archiveWholesaleOrder       = (id)                => api.post(`/exchange/orders/${id}/archive`).then(exchangeUnwrap);
export const unarchiveWholesaleOrder     = (id)                => api.post(`/exchange/orders/${id}/unarchive`).then(exchangeUnwrap);
export const addWholesaleDisputeMessage  = (id, body)          => api.post(`/exchange/orders/${id}/dispute-message`, body).then(exchangeUnwrap);

// Partner Ledger / Balances
export const listPartnerBalances = ()                   => api.get('/exchange/balances').then(exchangeFull);
export const getPartnerLedger    = (partnerStoreId)     => api.get(`/exchange/balances/${partnerStoreId}/ledger`).then(exchangeUnwrap);
export const recordSettlement    = (data)               => api.post('/exchange/settlements', data).then(exchangeUnwrap);
export const confirmSettlement   = (id)                 => api.post(`/exchange/settlements/${id}/confirm`).then(exchangeUnwrap);
export const listSettlements     = (params)             => api.get('/exchange/settlements', { params }).then(exchangeUnwrap);
export const disputeSettlement   = (id, reason)         => api.post(`/exchange/settlements/${id}/dispute`, { reason }).then(exchangeUnwrap);
export const resolveSettlement   = (id)                 => api.post(`/exchange/settlements/${id}/resolve`).then(exchangeUnwrap);

// Unified Report
export const getExchangeReport = (params) => api.get('/exchange/report', { params }).then(exchangeFull);

// ── AI ASSISTANT ──────────────────────────────────────────────────────────
export const listAiConversations   = ()            => api.get('/ai-assistant/conversations').then(r => r.data);
export const getAiConversation     = (id)          => api.get(`/ai-assistant/conversations/${id}`).then(r => r.data);
export const createAiConversation  = ()            => api.post('/ai-assistant/conversations').then(r => r.data);
export const sendAiMessage         = (id, content) => api.post(`/ai-assistant/conversations/${id}/messages`, { content }).then(r => r.data);
export const deleteAiConversation  = (id)          => api.delete(`/ai-assistant/conversations/${id}`).then(r => r.data);
export const submitAiFeedback      = (msgId, feedback, note = null) =>
  api.post(`/ai-assistant/messages/${msgId}/feedback`, { feedback, note }).then(r => r.data);
export const escalateAiConversation = (id, subject, priority = 'normal') =>
  api.post(`/ai-assistant/conversations/${id}/escalate`, { subject, priority }).then(r => r.data);
export const getAiTourBySlug   = (slug) => api.get(`/ai-assistant/tours/${slug}`).then(r => r.data);
export const listPublicAiTours = ()     => api.get('/ai-assistant/tours').then(r => r.data);

// ── NOTIFICATIONS (current user's bell) ───────────────────────────────────
export const listMyNotifications  = (params) => api.get('/notifications', { params }).then(r => r.data);
export const getUnreadNotifCount  = ()       => api.get('/notifications/count').then(r => r.data);
export const markNotifRead        = (id)     => api.put(`/notifications/${id}/read`).then(r => r.data);
export const markAllNotifsRead    = ()       => api.put('/notifications/read-all').then(r => r.data);
export const dismissNotif         = (id)     => api.delete(`/notifications/${id}`).then(r => r.data);

export default api;
