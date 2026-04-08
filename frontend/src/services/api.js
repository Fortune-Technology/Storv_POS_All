import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
});

// NEW Auth & Portal Routes
// Add a request interceptor to include the Bearer token + active store header
api.interceptors.request.use(
  (config) => {
    const user = JSON.parse(localStorage.getItem('user'));
    if (user && user.token) {
      config.headers.Authorization = `Bearer ${user.token}`;
    }
    // Attach active store so the backend scopes data correctly
    const activeStoreId = localStorage.getItem('activeStoreId');
    if (activeStoreId) {
      config.headers['X-Store-Id'] = activeStoreId;
    }
    return config;
  },
  (error) => {
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

// Phone Lookup
export const phoneLookup = (phone) => api.post('/auth/phone-lookup', { phone });

// Customers
export const getCustomers = (params) => api.get('/customers', { params });
export const getCustomerById = (id) => api.get(`/customers/${id}`);
export const checkPoints = (phone) => api.post('/customers/check-points', { phone });

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
export const getSalesPredictionsDaily = (params) => api.get('/sales/predictions/daily', { params }).then(r => r.data);
export const getSalesPredictionsWeekly = (params) => api.get('/sales/predictions/weekly', { params }).then(r => r.data);
export const getSalesPredictionsResiduals = (params) => api.get('/sales/predictions/residuals', { params }).then(r => r.data);
export const getVendorOrders = () => api.get('/sales/vendor-orders').then(r => r.data);

// Sales + Weather Combined
export const getSalesDailyWithWeather = (params) => api.get('/sales/daily-with-weather', { params }).then(r => r.data);
export const getSalesWeeklyWithWeather = (params) => api.get('/sales/weekly-with-weather', { params }).then(r => r.data);
export const getSalesMonthlyWithWeather = (params) => api.get('/sales/monthly-with-weather', { params }).then(r => r.data);
export const getSalesYearlyWithWeather = (params) => api.get('/sales/yearly-with-weather', { params }).then(r => r.data);
export const getRealtimeSales = () => api.get('/sales/realtime').then(r => r.data);

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

// ── Catalog — Departments ─────────────────────────────────────────────────
export const getCatalogDepartments  = (params) => api.get('/catalog/departments', { params }).then(r => r.data);
export const createCatalogDepartment= (data)   => api.post('/catalog/departments', data).then(r => r.data);
export const updateCatalogDepartment= (id, d)  => api.put(`/catalog/departments/${id}`, d).then(r => r.data);
export const deleteCatalogDepartment= (id)     => api.delete(`/catalog/departments/${id}`).then(r => r.data);

// ── Catalog — Vendors ─────────────────────────────────────────────────────
export const getCatalogVendors   = (params) => api.get('/catalog/vendors', { params }).then(r => r.data);
export const getCatalogVendor    = (id)     => api.get(`/catalog/vendors/${id}`).then(r => r.data);
export const createCatalogVendor = (data)   => api.post('/catalog/vendors', data).then(r => r.data);
export const updateCatalogVendor = (id, d)  => api.put(`/catalog/vendors/${id}`, d).then(r => r.data);
export const deleteCatalogVendor = (id)     => api.delete(`/catalog/vendors/${id}`).then(r => r.data);
export const getVendorProducts   = (id, params) => api.get(`/catalog/vendors/${id}/products`, { params }).then(r => r.data);
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

export const getLotteryTransactions   = (params) => api.get('/lottery/transactions', { params }).then(lotteryUnwrap);

// ── Vendor Payments (back-office) ─────────────────────────────────────────
export const getVendorPayments        = (params) => api.get('/catalog/vendor-payments', { params }).then(r => r.data);
export const createVendorPaymentEntry = (data)   => api.post('/catalog/vendor-payments', data).then(r => r.data);
export const updateVendorPaymentEntry = (id, d)  => api.put(`/catalog/vendor-payments/${id}`, d).then(r => r.data);

// POS Transactions
export const getTransactions = (params) => api.get('/pos-terminal/transactions', { params }).then(r => r.data);

export const getLotteryShiftReports   = (params) => api.get('/lottery/shift-reports', { params }).then(lotteryUnwrap);
export const getLotteryShiftReport    = (shiftId) => api.get(`/lottery/shift-reports/${shiftId}`).then(lotteryUnwrap);

// These return plain objects (no success/data wrapper) — r.data is the object directly
export const getLotteryDashboard      = (params) => api.get('/lottery/dashboard', { params }).then(r => r.data);
export const getLotteryReport         = (params) => api.get('/lottery/report', { params }).then(r => r.data);
export const getLotteryCommissionReport = (params) => api.get('/lottery/commission', { params }).then(r => r.data);

export const getLotterySettings    = (storeId) => api.get('/lottery/settings', { params: { storeId } }).then(r => r.data?.data ?? r.data);
export const updateLotterySettings = (storeId, data) => api.put('/lottery/settings', data, { params: { storeId } }).then(r => r.data?.data ?? r.data);

// ── POS Terminal Config ───────────────────────────────────────────────────────
export const getPOSConfig    = (storeId) => api.get('/pos-terminal/config', { params: { storeId } }).then(r => r.data);
export const updatePOSConfig = (data)    => api.put('/pos-terminal/config', data).then(r => r.data);

// ── Employee Reports & Clock Management ──────────────────────────────────────
export const getEmployeeReport    = (params)     => api.get('/reports/employees',       { params }).then(r => r.data);
export const getStoreEmployees    = (params)     => api.get('/reports/employees/list',  { params }).then(r => r.data);
export const getClockEvents       = (params)     => api.get('/reports/clock-events',    { params }).then(r => r.data);
export const createClockSession   = (data)       => api.post('/reports/clock-events',   data).then(r => r.data);
export const updateClockEventEntry = (id, data)  => api.put(`/reports/clock-events/${id}`, data).then(r => r.data);
export const deleteClockEventEntry = (id)        => api.delete(`/reports/clock-events/${id}`).then(r => r.data);

// ── Public API (no auth) ─────────────────────────────────────────────────────
export const getPublishedCareers        = ()               => api.get('/public/careers').then(r => r.data);
export const getPublishedCmsPage        = (slug)           => api.get(`/public/cms/${slug}`).then(r => r.data);
export const createPublicTicket         = (data)           => api.post('/public/tickets', data).then(r => r.data);

// ── Product UPCs ──────────────────────────────────────────────────────────
export const getProductUpcs    = (id)       => api.get(`/catalog/products/${id}/upcs`).then(r => r.data);
export const addProductUpc     = (id, data) => api.post(`/catalog/products/${id}/upcs`, data).then(r => r.data);
export const deleteProductUpc  = (id, upcId)=> api.delete(`/catalog/products/${id}/upcs/${upcId}`).then(r => r.data);

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

export default api;
