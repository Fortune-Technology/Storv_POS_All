import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

// Request interceptor — attach Bearer token
api.interceptors.request.use(
  (config) => {
    const user = JSON.parse(localStorage.getItem('admin_user'));
    if (user && user.token) {
      config.headers.Authorization = `Bearer ${user.token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Auth ─────────────────────────────────────────────────────────────────────
export const login = (credentials) => api.post('/auth/login', credentials);

// ── Admin Dashboard ──────────────────────────────────────────────────────────
export const getAdminDashboard = () => api.get('/admin/dashboard').then(r => r.data);

// ── Admin Users ──────────────────────────────────────────────────────────────
export const getAdminUsers       = (params) => api.get('/admin/users', { params }).then(r => r.data);
export const createAdminUser     = (data)   => api.post('/admin/users', data).then(r => r.data);
export const updateAdminUser     = (id, d)  => api.put(`/admin/users/${id}`, d).then(r => r.data);
export const deleteAdminUser     = (id)     => api.delete(`/admin/users/${id}`).then(r => r.data);
export const approveAdminUser    = (id)     => api.put(`/admin/users/${id}/approve`).then(r => r.data);
export const suspendAdminUser    = (id)     => api.put(`/admin/users/${id}/suspend`).then(r => r.data);
export const rejectAdminUser     = (id)     => api.put(`/admin/users/${id}/reject`).then(r => r.data);
export const impersonateUser     = (id)     => api.post(`/admin/users/${id}/impersonate`).then(r => r.data);

// ── Admin Organizations ──────────────────────────────────────────────────────
export const getAdminOrganizations     = (params)    => api.get('/admin/organizations', { params }).then(r => r.data);
export const createAdminOrganization   = (data)      => api.post('/admin/organizations', data).then(r => r.data);
export const updateAdminOrganization   = (id, data)  => api.put(`/admin/organizations/${id}`, data).then(r => r.data);
export const deleteAdminOrganization   = (id)        => api.delete(`/admin/organizations/${id}`).then(r => r.data);

// ── Admin Stores ─────────────────────────────────────────────────────────────
export const getAdminStores      = (params)    => api.get('/admin/stores', { params }).then(r => r.data);
export const createAdminStore    = (data)      => api.post('/admin/stores', data).then(r => r.data);
export const updateAdminStore    = (id, data)  => api.put(`/admin/stores/${id}`, data).then(r => r.data);
export const deleteAdminStore    = (id)        => api.delete(`/admin/stores/${id}`).then(r => r.data);

// ── Dejavoo Payment Merchants (superadmin-only, per-store) ──────────────────
export const listPaymentMerchants     = (params)   => api.get('/admin/payment-merchants', { params }).then(r => r.data);
export const getPaymentMerchant       = (id)       => api.get(`/admin/payment-merchants/${id}`).then(r => r.data);
export const createPaymentMerchant    = (data)     => api.post('/admin/payment-merchants', data).then(r => r.data);
export const updatePaymentMerchant    = (id, data) => api.put(`/admin/payment-merchants/${id}`, data).then(r => r.data);
export const deletePaymentMerchant    = (id)       => api.delete(`/admin/payment-merchants/${id}`).then(r => r.data);
export const testPaymentMerchant      = (id)       => api.post(`/admin/payment-merchants/${id}/test`).then(r => r.data);
export const activatePaymentMerchant  = (id)       => api.post(`/admin/payment-merchants/${id}/activate`).then(r => r.data);
export const disablePaymentMerchant   = (id, reason) => api.post(`/admin/payment-merchants/${id}/disable`, { reason }).then(r => r.data);
export const getPaymentMerchantAudit  = (id)       => api.get(`/admin/payment-merchants/${id}/audit`).then(r => r.data);

// ── Dejavoo Payment Terminals (per-device, one per station) ─────────────────
export const listPaymentTerminals    = (params)   => api.get('/admin/payment-terminals', { params }).then(r => r.data);
export const createPaymentTerminal   = (data)     => api.post('/admin/payment-terminals', data).then(r => r.data);
export const updatePaymentTerminal   = (id, data) => api.put(`/admin/payment-terminals/${id}`, data).then(r => r.data);
export const deletePaymentTerminal   = (id)       => api.delete(`/admin/payment-terminals/${id}`).then(r => r.data);
export const pingPaymentTerminal     = (id)       => api.post(`/admin/payment-terminals/${id}/ping`).then(r => r.data);

// ── Admin CMS Pages ──────────────────────────────────────────────────────────
export const getAdminCmsPages    = ()          => api.get('/admin/cms').then(r => r.data);
export const createAdminCmsPage  = (data)      => api.post('/admin/cms', data).then(r => r.data);
export const updateAdminCmsPage  = (id, data)  => api.put(`/admin/cms/${id}`, data).then(r => r.data);
export const deleteAdminCmsPage  = (id)        => api.delete(`/admin/cms/${id}`).then(r => r.data);

// ── Admin Careers ────────────────────────────────────────────────────────────
export const getAdminCareers     = ()          => api.get('/admin/careers').then(r => r.data);
export const createAdminCareer   = (data)      => api.post('/admin/careers', data).then(r => r.data);
export const updateAdminCareer   = (id, data)  => api.put(`/admin/careers/${id}`, data).then(r => r.data);
export const deleteAdminCareer   = (id)        => api.delete(`/admin/careers/${id}`).then(r => r.data);

// ── Admin Career Applications ────────────────────────────────────────────────
export const getAdminCareerApplications = (careerPostingId) => api.get(`/admin/careers/${careerPostingId}/applications`).then(r => r.data);
export const updateAdminJobApplication  = (id, data)        => api.put(`/admin/applications/${id}`, data).then(r => r.data);

// ── Admin Tickets ────────────────────────────────────────────────────────────
export const getAdminTickets       = (params)    => api.get('/admin/tickets', { params }).then(r => r.data);
export const createAdminTicket     = (data)      => api.post('/admin/tickets', data).then(r => r.data);
export const updateAdminTicket     = (id, data)  => api.put(`/admin/tickets/${id}`, data).then(r => r.data);
export const deleteAdminTicket     = (id)        => api.delete(`/admin/tickets/${id}`).then(r => r.data);
export const addAdminTicketReply   = (id, data)  => api.post(`/admin/tickets/${id}/reply`, data).then(r => r.data);

// ── Admin System Config ──────────────────────────────────────────────────────
export const getAdminSystemConfig    = ()      => api.get('/admin/config').then(r => r.data);
export const updateAdminSystemConfig = (data)  => api.put('/admin/config', data).then(r => r.data);

// ── Admin Analytics ──────────────────────────────────────────────────────────
export const getAdminAnalyticsDashboard = () => api.get('/admin/analytics/dashboard').then(r => r.data);
export const getAdminOrgAnalytics       = () => api.get('/admin/analytics/organizations').then(r => r.data);
export const getAdminStorePerformance   = () => api.get('/admin/analytics/stores').then(r => r.data);
export const getAdminUserActivity       = () => api.get('/admin/analytics/users').then(r => r.data);

// ── Admin Payment Management ─────────────────────────────────────────────────
export const getAdminPaymentMerchant    = (orgId)          => api.get('/admin/payment/merchant', { params: { orgId } }).then(r => r.data);
export const saveAdminPaymentMerchant   = (data)           => api.put('/admin/payment/merchant', data).then(r => r.data);
export const getAdminPaymentTerminals   = (params)         => api.get('/admin/payment/terminals', { params }).then(r => r.data);
export const pingAdminTerminal          = (id)             => api.post(`/admin/payment/terminals/${id}/ping`).then(r => r.data);
export const createAdminTerminal        = (data)           => api.post('/admin/payment/terminals', data).then(r => r.data);
export const updateAdminTerminal        = (id, data)       => api.put(`/admin/payment/terminals/${id}`, data).then(r => r.data);
export const deleteAdminTerminal        = (id)             => api.delete(`/admin/payment/terminals/${id}`).then(r => r.data);
export const getAdminPaymentSettings    = (storeId)        => api.get(`/admin/payment/settings/${storeId}`).then(r => r.data);
export const saveAdminPaymentSettings   = (storeId, data)  => api.put(`/admin/payment/settings/${storeId}`, data).then(r => r.data);
export const getAdminPaymentHistory     = (params)         => api.get('/admin/payment/history', { params }).then(r => r.data);

// ── Admin Billing — Plans & Add-ons ──────────────────────────────────────────
export const adminListPlans              = ()         => api.get('/admin/billing/plans').then(r => r.data);
export const adminCreatePlan             = (data)     => api.post('/admin/billing/plans', data).then(r => r.data);
export const adminUpdatePlan             = (id, data) => api.put(`/admin/billing/plans/${id}`, data).then(r => r.data);
export const adminDeletePlan             = (id)       => api.delete(`/admin/billing/plans/${id}`).then(r => r.data);
export const adminCreateAddon            = (data)     => api.post('/admin/billing/addons', data).then(r => r.data);
export const adminUpdateAddon            = (id, data) => api.put(`/admin/billing/addons/${id}`, data).then(r => r.data);

// ── Admin Billing — Subscriptions ────────────────────────────────────────────
export const adminListSubscriptions      = (params)      => api.get('/admin/billing/subscriptions', { params }).then(r => r.data);
export const adminGetSubscription        = (orgId)       => api.get(`/admin/billing/subscriptions/${orgId}`).then(r => r.data);
export const adminUpsertSubscription     = (orgId, data) => api.put(`/admin/billing/subscriptions/${orgId}`, data).then(r => r.data);

// ── Admin Billing — Invoices ──────────────────────────────────────────────────
export const adminListInvoices           = (params) => api.get('/admin/billing/invoices', { params }).then(r => r.data);
export const adminWriteOffInvoice        = (id)     => api.post(`/admin/billing/invoices/${id}/write-off`).then(r => r.data);
export const adminRetryInvoice           = (id)     => api.post(`/admin/billing/invoices/${id}/retry`).then(r => r.data);

// ── Admin Billing — Equipment ─────────────────────────────────────────────────
export const adminListEquipmentProducts  = ()         => api.get('/admin/billing/equipment/products').then(r => r.data);
export const adminCreateEquipmentProduct = (data)     => api.post('/admin/billing/equipment/products', data).then(r => r.data);
export const adminUpdateEquipmentProduct = (id, data) => api.put(`/admin/billing/equipment/products/${id}`, data).then(r => r.data);
export const adminListEquipmentOrders    = (params)   => api.get('/admin/billing/equipment/orders', { params }).then(r => r.data);
export const adminUpdateEquipmentOrder   = (id, data) => api.put(`/admin/billing/equipment/orders/${id}`, data).then(r => r.data);

// ── Database Backup ──────────────────────────────────────────────────────────
export const downloadDatabaseBackup = (target, format = 'sql') =>
  api.get(`/admin/backup/${target}`, { params: { format }, responseType: 'blob' });

// ── Image Re-hosting ─────────────────────────────────────────────────────────
export const getImageRehostStatus = ()           => api.get('/admin/images/rehost-status').then(r => r.data);
export const triggerImageRehost   = (batchSize)  => api.post('/admin/images/rehost', { batchSize }).then(r => r.data);

// ── RBAC — Roles & Permissions ───────────────────────────────────────────────
export const getPermissions       = (scope)           => api.get('/roles/permissions', { params: scope ? { scope } : undefined }).then(r => r.data);
export const listRoles            = (params)          => api.get('/roles', { params }).then(r => r.data);
export const getRole              = (id)              => api.get(`/roles/${id}`).then(r => r.data);
export const createRole           = (data, params)    => api.post('/roles', data, { params }).then(r => r.data);
export const updateRole           = (id, data)        => api.put(`/roles/${id}`, data).then(r => r.data);
export const deleteRole           = (id)              => api.delete(`/roles/${id}`).then(r => r.data);
export const getUserRoles         = (userId)          => api.get(`/roles/users/${userId}/roles`).then(r => r.data);
export const setUserRoles         = (userId, roleIds) => api.put(`/roles/users/${userId}/roles`, { roleIds }).then(r => r.data);

// ── Price Scenarios (Interchange-plus calculator, superadmin-only) ──────────
export const listPriceScenarios   = (params)          => api.get('/price-scenarios', { params }).then(r => r.data);
export const getPriceScenario     = (id)              => api.get(`/price-scenarios/${id}`).then(r => r.data);
export const createPriceScenario  = (data)            => api.post('/price-scenarios', data).then(r => r.data);
export const updatePriceScenario  = (id, data)        => api.put(`/price-scenarios/${id}`, data).then(r => r.data);
export const deletePriceScenario  = (id)              => api.delete(`/price-scenarios/${id}`).then(r => r.data);

// ── State catalog (US states with per-state defaults) ───────────────────
export const listAdminStates     = (params)           => api.get('/states', { params }).then(r => r.data);
export const getAdminState       = (code)             => api.get(`/states/${code}`).then(r => r.data);
export const createAdminState    = (data)             => api.post('/states', data).then(r => r.data);
export const updateAdminState    = (code, data)       => api.put(`/states/${code}`, data).then(r => r.data);
export const deleteAdminState    = (code)             => api.delete(`/states/${code}`).then(r => r.data);

// ── Vendor Import Templates (Session 5) ──────────────────────────────────────
export const getVendorTemplates      = (params = {}) => api.get('/vendor-templates', { params }).then(r => r.data);
export const getVendorTemplate       = (id)          => api.get(`/vendor-templates/${id}`).then(r => r.data);
export const createVendorTemplate    = (data)        => api.post('/vendor-templates', data).then(r => r.data);
export const updateVendorTemplate    = (id, data)    => api.put(`/vendor-templates/${id}`, data).then(r => r.data);
export const deleteVendorTemplate    = (id)          => api.delete(`/vendor-templates/${id}`).then(r => r.data);
export const getVendorTemplateTransforms = ()        => api.get('/vendor-templates/transforms').then(r => r.data);
export const previewVendorTemplate   = (id, rows)    => api.post(`/vendor-templates/${id}/preview`, { rows }).then(r => r.data);

export default api;
