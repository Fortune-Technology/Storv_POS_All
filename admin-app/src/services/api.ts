import axios, { AxiosRequestConfig } from 'axios';
import type {
  PaginatedResponse, MetaPaginatedResponse, SuccessResponse,
  AdminUser, Organization, AdminStore,
  LoginResponse, ImpersonateResponse,
  PaymentMerchant, PaymentTerminal, PaymentMerchantAuditEntry,
  SupportTicket, CmsPage, CareerPosting, CareerApplication,
  Permission, Role, UsStateRecord,
  LotteryCatalogRow, LotteryRequest,
  KbArticle, AiReview, AiTour,
  BillingPlan, BillingAddon, Subscription, BillingInvoice,
  EquipmentOrder, EquipmentProduct,
  VendorImportTemplate, VendorTemplateTransform,
  PriceScenario, SystemConfig,
  ImageRehostStatus, ImageRehostResult,
  RoleSurface,
} from '@storeveu/types';

/**
 * Admin-app API client.
 *
 * Return types are narrowed via `@storeveu/types` envelopes + entity shapes.
 * Fields that vary per-endpoint still use `unknown` or `Record<string, unknown>`
 * at the input-side (POST/PUT bodies) — the server validates shapes anyway.
 */

interface StoredAdminUser {
  token?: string;
  [key: string]: unknown;
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

// Request interceptor — attach Bearer token
api.interceptors.request.use(
  (config) => {
    const raw = localStorage.getItem('admin_user');
    const user: StoredAdminUser | null = raw ? JSON.parse(raw) : null;
    if (user && user.token) {
      config.headers.Authorization = `Bearer ${user.token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — when the server says 401 (token expired or
// invalid), wipe the superadmin session and redirect to /login. Without
// this, an expired JWT keeps the user "logged in" in localStorage but
// every API call silently fails — pages render empty with no clue why.
//
// Skip the redirect when the failing request IS /auth/login itself (so
// the login page can show "Wrong password" without an immediate refresh)
// or /auth/verify-password (the InactivityLock unlock check).
api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    const status   = error?.response?.status;
    const url      = error?.config?.url || '';
    const isAuthEp = url.includes('/auth/login') || url.includes('/auth/verify-password');
    if (status === 401 && !isAuthEp) {
      try {
        localStorage.removeItem('admin_user');
        // Also wipe the inactivity-lock keys so the login page renders
        // cleanly. (These are portal-side keys but if the user was using
        // both apps in the same browser they'll get cleared together.)
        localStorage.removeItem('storv:il:locked');
        localStorage.removeItem('storv:il:lastActive');
      } catch { /* ignore */ }
      // Avoid redirect loops if we're already on /login
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?session=expired&returnTo=${returnTo}`;
      }
    }
    return Promise.reject(error);
  }
);

type Params = Record<string, unknown>;
type Headers = Record<string, string>;

// ── Auth ─────────────────────────────────────────────────────────────────────
export const login = (credentials: { email: string; password: string }) =>
  api.post<LoginResponse>('/auth/login', credentials);

// ── Admin Dashboard ──────────────────────────────────────────────────────────
// Response is `{ data: { totalUsers, chartData[], recentTickets[], ... } }` —
// the inner shape is free-form so pages destructure what they need. Pages
// read `.data` on the resolved value, so we preserve the envelope.
export const getAdminDashboard = (): Promise<{ data: Record<string, unknown> }> =>
  api.get('/admin/dashboard').then(r => r.data);

// ── Admin Users ──────────────────────────────────────────────────────────────
export const getAdminUsers       = (params?: Params):                       Promise<PaginatedResponse<AdminUser>> => api.get('/admin/users', { params }).then(r => r.data);
export const createAdminUser     = (data: unknown):                          Promise<{ user: AdminUser; tempPassword?: string; notice?: string }> => api.post('/admin/users', data).then(r => r.data);
export const updateAdminUser     = (id: string | number, d: unknown):         Promise<{ user: AdminUser }> => api.put(`/admin/users/${id}`, d).then(r => r.data);
export const deleteAdminUser     = (id: string | number):                    Promise<SuccessResponse> => api.delete(`/admin/users/${id}`).then(r => r.data);
export const approveAdminUser    = (id: string | number):                    Promise<{ user: AdminUser }> => api.put(`/admin/users/${id}/approve`).then(r => r.data);
export const suspendAdminUser    = (id: string | number):                    Promise<{ user: AdminUser }> => api.put(`/admin/users/${id}/suspend`).then(r => r.data);
export const rejectAdminUser     = (id: string | number):                    Promise<{ user: AdminUser }> => api.put(`/admin/users/${id}/reject`).then(r => r.data);
// Callers read `res.data || res` defensively — the `data` wrapper varies by deploy.
export const impersonateUser     = (id: string | number):                    Promise<ImpersonateResponse & { data?: ImpersonateResponse }> => api.post(`/admin/users/${id}/impersonate`).then(r => r.data);

// ── Admin Organizations ──────────────────────────────────────────────────────
// Some callers (AdminMerchants, AIAssistantWidget) defensively check `.organizations`
// in addition to `.data` — union types it to match both shapes.
export type AdminOrgsListResponse = PaginatedResponse<Organization> & { organizations?: Organization[] };
export const getAdminOrganizations     = (params?: Params):                         Promise<AdminOrgsListResponse> => api.get('/admin/organizations', { params }).then(r => r.data);
export const createAdminOrganization   = (data: unknown):                           Promise<{ organization: Organization }> => api.post('/admin/organizations', data).then(r => r.data);
// Wipe a target org's product catalog. Uses the X-Tenant-Id superadmin
// override so the call hits the right tenant via scopeToTenant. The
// confirmation literal must equal "DELETE ALL" — backend rejects anything
// else with 400. `permanent: true` deletes rows hard; the default soft
// delete just sets `deleted: true` so the catalog can be restored by
// re-importing or via the Prisma console.
export const deleteAllOrgProducts = (
  orgId: string | number,
  confirmation: string,
  permanent: boolean,
): Promise<{ success: boolean; deleted: number; type: 'soft' | 'permanent'; message?: string }> =>
  api.post(
    '/catalog/products/delete-all',
    { confirmation, permanent },
    { headers: { 'X-Tenant-Id': String(orgId) } },
  ).then(r => r.data);
export const updateAdminOrganization   = (id: string | number, data: unknown):       Promise<{ organization: Organization }> => api.put(`/admin/organizations/${id}`, data).then(r => r.data);
export const deleteAdminOrganization   = (id: string | number):                     Promise<SuccessResponse> => api.delete(`/admin/organizations/${id}`).then(r => r.data);

// ── Admin Stores ─────────────────────────────────────────────────────────────
export type AdminStoresListResponse = PaginatedResponse<AdminStore> & { stores?: AdminStore[] };
export const getAdminStores      = (params?: Params):                               Promise<AdminStoresListResponse> => api.get('/admin/stores', { params }).then(r => r.data);
export const createAdminStore    = (data: unknown):                                  Promise<{ store: AdminStore }> => api.post('/admin/stores', data).then(r => r.data);
export const updateAdminStore    = (id: string | number, data: unknown):             Promise<{ store: AdminStore }> => api.put(`/admin/stores/${id}`, data).then(r => r.data);
export const deleteAdminStore    = (id: string | number):                           Promise<SuccessResponse> => api.delete(`/admin/stores/${id}`).then(r => r.data);

// ── Dejavoo Payment Merchants (superadmin-only, per-store) ──────────────────
export const listPaymentMerchants     = (params?: Params):                                 Promise<{ merchants: PaymentMerchant[] }> => api.get('/admin/payment-merchants', { params }).then(r => r.data);
export const getPaymentMerchant       = (id: string | number):                              Promise<{ merchant: PaymentMerchant }> => api.get(`/admin/payment-merchants/${id}`).then(r => r.data);
export const createPaymentMerchant    = (data: unknown):                                    Promise<{ merchant: PaymentMerchant }> => api.post('/admin/payment-merchants', data).then(r => r.data);
export const updatePaymentMerchant    = (id: string | number, data: unknown):                Promise<{ merchant: PaymentMerchant }> => api.put(`/admin/payment-merchants/${id}`, data).then(r => r.data);
export const deletePaymentMerchant    = (id: string | number):                              Promise<SuccessResponse> => api.delete(`/admin/payment-merchants/${id}`).then(r => r.data);
export const testPaymentMerchant      = (id: string | number):                              Promise<{ success: boolean; result?: string }> => api.post(`/admin/payment-merchants/${id}/test`).then(r => r.data);
export const activatePaymentMerchant  = (id: string | number):                              Promise<{ merchant: PaymentMerchant }> => api.post(`/admin/payment-merchants/${id}/activate`).then(r => r.data);
export const disablePaymentMerchant   = (id: string | number, reason?: string):              Promise<{ merchant: PaymentMerchant }> => api.post(`/admin/payment-merchants/${id}/disable`, { reason }).then(r => r.data);
export const getPaymentMerchantAudit  = (id: string | number):                              Promise<{ entries?: PaymentMerchantAuditEntry[]; audit?: PaymentMerchantAuditEntry[] }> => api.get(`/admin/payment-merchants/${id}/audit`).then(r => r.data);

// ── Dejavoo HPP webhook (per-store opaque token in URL) ─────────────────────
// `regenerate` returns the plaintext secret + full URL ONCE — admin must
// paste the URL into iPOSpays before navigating away.
export const getHppWebhookUrl           = (id: string | number): Promise<{ success: boolean; configured: boolean; webhookUrl: string | null; preview?: string }> => api.get(`/admin/payment-merchants/${id}/hpp-webhook-url`).then(r => r.data);
export const regenerateHppWebhookSecret = (id: string | number): Promise<{ success: boolean; webhookSecret: string; webhookUrl: string; preview: string }> => api.post(`/admin/payment-merchants/${id}/regenerate-hpp-secret`).then(r => r.data);

// ── Dejavoo Payment Terminals (per-device, one per station) ─────────────────
export const listPaymentTerminals    = (params?: Params):                                Promise<{ terminals: PaymentTerminal[] }> => api.get('/admin/payment-terminals', { params }).then(r => r.data);
export const createPaymentTerminal   = (data: unknown):                                   Promise<{ terminal: PaymentTerminal }> => api.post('/admin/payment-terminals', data).then(r => r.data);
export const updatePaymentTerminal   = (id: string | number, data: unknown):               Promise<{ terminal: PaymentTerminal }> => api.put(`/admin/payment-terminals/${id}`, data).then(r => r.data);
export const deletePaymentTerminal   = (id: string | number):                             Promise<SuccessResponse> => api.delete(`/admin/payment-terminals/${id}`).then(r => r.data);
export const pingPaymentTerminal     = (id: string | number):                             Promise<{ success: boolean; message?: string }> => api.post(`/admin/payment-terminals/${id}/ping`).then(r => r.data);
export const listStationsForStore    = (storeId: string):                                  Promise<{
  success: boolean;
  scope?: { storeId: string; storeName: string; orgId: string };
  stations: Array<{
    id: string;
    name: string;
    orgId?: string;
    lastSeenAt?: string | null;
    paired: boolean;
    pairedTerminalId: string | null;
    pairedTerminalNickname: string | null;
    pairedTerminalModel: string | null;
  }>;
}> => api.get('/admin/payment-terminals/stations', { params: { storeId } }).then(r => r.data);

// ── Admin CMS Pages ──────────────────────────────────────────────────────────
export const getAdminCmsPages    = ():                                Promise<{ data: CmsPage[] }> => api.get('/admin/cms').then(r => r.data);
export const createAdminCmsPage  = (data: unknown):                    Promise<{ page: CmsPage }> => api.post('/admin/cms', data).then(r => r.data);
export const updateAdminCmsPage  = (id: string | number, data: unknown): Promise<{ page: CmsPage }> => api.put(`/admin/cms/${id}`, data).then(r => r.data);
export const deleteAdminCmsPage  = (id: string | number):              Promise<SuccessResponse> => api.delete(`/admin/cms/${id}`).then(r => r.data);

// ── Admin Careers ────────────────────────────────────────────────────────────
export const getAdminCareers     = ():                                Promise<{ data: CareerPosting[] }> => api.get('/admin/careers').then(r => r.data);
export const createAdminCareer   = (data: unknown):                    Promise<{ career: CareerPosting }> => api.post('/admin/careers', data).then(r => r.data);
export const updateAdminCareer   = (id: string | number, data: unknown): Promise<{ career: CareerPosting }> => api.put(`/admin/careers/${id}`, data).then(r => r.data);
export const deleteAdminCareer   = (id: string | number):              Promise<SuccessResponse> => api.delete(`/admin/careers/${id}`).then(r => r.data);

// ── Admin Career Applications ────────────────────────────────────────────────
export const getAdminCareerApplications = (careerPostingId: string | number): Promise<{ data?: CareerApplication[]; posting?: { title: string; department?: string } }> => api.get(`/admin/careers/${careerPostingId}/applications`).then(r => r.data);
export const updateAdminJobApplication  = (id: string | number, data: unknown): Promise<{ application: CareerApplication }> => api.put(`/admin/applications/${id}`, data).then(r => r.data);

// ── Admin Tickets ────────────────────────────────────────────────────────────
export const getAdminTickets       = (params?: Params):                        Promise<PaginatedResponse<SupportTicket>> => api.get('/admin/tickets', { params }).then(r => r.data);
export const createAdminTicket     = (data: unknown):                           Promise<{ data: SupportTicket }> => api.post('/admin/tickets', data).then(r => r.data);
export const updateAdminTicket     = (id: string | number, data: unknown):       Promise<{ data: SupportTicket }> => api.put(`/admin/tickets/${id}`, data).then(r => r.data);
export const deleteAdminTicket     = (id: string | number):                     Promise<SuccessResponse> => api.delete(`/admin/tickets/${id}`).then(r => r.data);
export const addAdminTicketReply   = (id: string | number, data: unknown):       Promise<{ data: SupportTicket }> => api.post(`/admin/tickets/${id}/reply`, data).then(r => r.data);

// ── Admin System Config ──────────────────────────────────────────────────────
export const getAdminSystemConfig    = ():              Promise<{ data: SystemConfig[] }> => api.get('/admin/config').then(r => r.data);
export const updateAdminSystemConfig = (data: unknown): Promise<{ config: SystemConfig }> => api.put('/admin/config', data).then(r => r.data);

// ── Admin Analytics ──────────────────────────────────────────────────────────
// Analytics responses are `{ data: {...} }` envelopes around free-form stats.
export const getAdminAnalyticsDashboard = (): Promise<{ data: Record<string, unknown> }> => api.get('/admin/analytics/dashboard').then(r => r.data);
export const getAdminOrgAnalytics       = (): Promise<{ data: Record<string, unknown> }> => api.get('/admin/analytics/organizations').then(r => r.data);
export const getAdminStorePerformance   = (): Promise<{ data: Record<string, unknown> }> => api.get('/admin/analytics/stores').then(r => r.data);
export const getAdminUserActivity       = (): Promise<{ data: Record<string, unknown> }> => api.get('/admin/analytics/users').then(r => r.data);

// ── Admin Payment Management ─────────────────────────────────────────────────
// Kept as Promise<any> — legacy Payment Settings page uses these with varied shapes.
export const getAdminPaymentMerchant    = (orgId: string | number): Promise<any> => api.get('/admin/payment/merchant', { params: { orgId } }).then(r => r.data);
export const saveAdminPaymentMerchant   = (data: unknown):          Promise<any> => api.put('/admin/payment/merchant', data).then(r => r.data);
export const getAdminPaymentTerminals   = (params?: Params):        Promise<any> => api.get('/admin/payment/terminals', { params }).then(r => r.data);
export const pingAdminTerminal          = (id: string | number):    Promise<any> => api.post(`/admin/payment/terminals/${id}/ping`).then(r => r.data);
export const createAdminTerminal        = (data: unknown):          Promise<any> => api.post('/admin/payment/terminals', data).then(r => r.data);
export const updateAdminTerminal        = (id: string | number, data: unknown): Promise<any> => api.put(`/admin/payment/terminals/${id}`, data).then(r => r.data);
export const deleteAdminTerminal        = (id: string | number):    Promise<any> => api.delete(`/admin/payment/terminals/${id}`).then(r => r.data);
export const getAdminPaymentSettings    = (storeId: string | number): Promise<any> => api.get(`/admin/payment/settings/${storeId}`).then(r => r.data);
export const saveAdminPaymentSettings   = (storeId: string | number, data: unknown): Promise<any> => api.put(`/admin/payment/settings/${storeId}`, data).then(r => r.data);
export const getAdminPaymentHistory     = (params?: Params):        Promise<any> => api.get('/admin/payment/history', { params }).then(r => r.data);

// ── Admin Billing — Plans & Add-ons ──────────────────────────────────────────
export const adminListPlans              = ():           Promise<{ plans?: BillingPlan[]; addons?: BillingAddon[] }> => api.get('/admin/billing/plans').then(r => r.data);
export const adminCreatePlan             = (data: unknown): Promise<{ plan: BillingPlan }> => api.post('/admin/billing/plans', data).then(r => r.data);
export const adminUpdatePlan             = (id: string | number, data: unknown): Promise<{ plan: BillingPlan }> => api.put(`/admin/billing/plans/${id}`, data).then(r => r.data);
export const adminDeletePlan             = (id: string | number): Promise<SuccessResponse> => api.delete(`/admin/billing/plans/${id}`).then(r => r.data);
export const adminCreateAddon            = (data: unknown): Promise<{ addon: BillingAddon }> => api.post('/admin/billing/addons', data).then(r => r.data);
export const adminUpdateAddon            = (id: string | number, data: unknown): Promise<{ addon: BillingAddon }> => api.put(`/admin/billing/addons/${id}`, data).then(r => r.data);

// ── Admin Billing — Subscriptions ────────────────────────────────────────────
export const adminListSubscriptions      = (params?: Params): Promise<MetaPaginatedResponse<Subscription>> => api.get('/admin/billing/subscriptions', { params }).then(r => r.data);
export const adminGetSubscription        = (orgId: string | number): Promise<{ subscription: Subscription }> => api.get(`/admin/billing/subscriptions/${orgId}`).then(r => r.data);
export const adminUpsertSubscription     = (orgId: string | number, data: unknown): Promise<{ subscription: Subscription }> => api.put(`/admin/billing/subscriptions/${orgId}`, data).then(r => r.data);

// ── Admin Billing — Invoices ──────────────────────────────────────────────────
export const adminListInvoices           = (params?: Params): Promise<MetaPaginatedResponse<BillingInvoice>> => api.get('/admin/billing/invoices', { params }).then(r => r.data);
export const adminWriteOffInvoice        = (id: string | number): Promise<{ invoice: BillingInvoice }> => api.post(`/admin/billing/invoices/${id}/write-off`).then(r => r.data);
export const adminRetryInvoice           = (id: string | number): Promise<{ invoice: BillingInvoice }> => api.post(`/admin/billing/invoices/${id}/retry`).then(r => r.data);

// ── Admin Billing — Equipment ─────────────────────────────────────────────────
export const adminListEquipmentProducts  = ():           Promise<{ data: EquipmentProduct[] }> => api.get('/admin/billing/equipment/products').then(r => r.data);
export const adminCreateEquipmentProduct = (data: unknown): Promise<{ product: EquipmentProduct }> => api.post('/admin/billing/equipment/products', data).then(r => r.data);
export const adminUpdateEquipmentProduct = (id: string | number, data: unknown): Promise<{ product: EquipmentProduct }> => api.put(`/admin/billing/equipment/products/${id}`, data).then(r => r.data);
export const adminListEquipmentOrders    = (params?: Params): Promise<MetaPaginatedResponse<EquipmentOrder>> => api.get('/admin/billing/equipment/orders', { params }).then(r => r.data);
export const adminUpdateEquipmentOrder   = (id: string | number, data: unknown): Promise<{ order: EquipmentOrder }> => api.put(`/admin/billing/equipment/orders/${id}`, data).then(r => r.data);

// ── Database Backup ──────────────────────────────────────────────────────────
export const downloadDatabaseBackup = (target: string, format: string = 'sql') => {
  const config: AxiosRequestConfig = { params: { format }, responseType: 'blob' };
  return api.get<Blob>(`/admin/backup/${target}`, config);
};

// ── Image Re-hosting ─────────────────────────────────────────────────────────
export const getImageRehostStatus = ():                  Promise<ImageRehostStatus> => api.get('/admin/images/rehost-status').then(r => r.data);
export const triggerImageRehost   = (batchSize?: number): Promise<ImageRehostResult> => api.post('/admin/images/rehost', { batchSize }).then(r => r.data);

// ── RBAC — Roles & Permissions ───────────────────────────────────────────────
export const getPermissions       = (scope?: string):                              Promise<{ permissions?: Permission[]; grouped?: Record<string, Permission[]> }> => api.get('/roles/permissions', { params: scope ? { scope } : undefined }).then(r => r.data);
export const listRoles            = (params?: { scope?: string; includeSystem?: boolean }): Promise<{ roles?: Role[] }> => api.get('/roles', { params }).then(r => r.data);
export const getRole              = (id: string | number):                         Promise<{ role: Role }> => api.get(`/roles/${id}`).then(r => r.data);
export const createRole           = (data: unknown, params?: Params):               Promise<{ role: Role }> => api.post('/roles', data, { params }).then(r => r.data);
export const updateRole           = (id: string | number, data: unknown):            Promise<{ role: Role }> => api.put(`/roles/${id}`, data).then(r => r.data);
export const deleteRole           = (id: string | number):                         Promise<SuccessResponse> => api.delete(`/roles/${id}`).then(r => r.data);
export const getUserRoles         = (userId: string | number):                     Promise<{ roles: Role[] }> => api.get(`/roles/users/${userId}/roles`).then(r => r.data);
export const setUserRoles         = (userId: string | number, roleIds: Array<string | number>): Promise<{ roles: Role[] }> => api.put(`/roles/users/${userId}/roles`, { roleIds }).then(r => r.data);

// ── Price Scenarios (Interchange-plus calculator, superadmin-only) ──────────
export const listPriceScenarios   = (params?: Params):      Promise<{ scenarios?: PriceScenario[] }> => api.get('/price-scenarios', { params }).then(r => r.data);
export const getPriceScenario     = (id: string | number):  Promise<PriceScenario> => api.get(`/price-scenarios/${id}`).then(r => r.data);
export const createPriceScenario  = (data: unknown):        Promise<PriceScenario> => api.post('/price-scenarios', data).then(r => r.data);
export const updatePriceScenario  = (id: string | number, data: unknown): Promise<PriceScenario> => api.put(`/price-scenarios/${id}`, data).then(r => r.data);
export const deletePriceScenario  = (id: string | number):  Promise<SuccessResponse> => api.delete(`/price-scenarios/${id}`).then(r => r.data);

// ── State catalog (US states with per-state defaults) ───────────────────
export const listAdminStates     = (params?: Params):               Promise<{ states?: UsStateRecord[] }> => api.get('/states', { params }).then(r => r.data);
export const getAdminState       = (code: string):                  Promise<{ state: UsStateRecord }> => api.get(`/states/${code}`).then(r => r.data);
export const createAdminState    = (data: unknown):                 Promise<{ state: UsStateRecord }> => api.post('/states', data).then(r => r.data);
export const updateAdminState    = (code: string, data: unknown):    Promise<{ state: UsStateRecord }> => api.put(`/states/${code}`, data).then(r => r.data);
export const deleteAdminState    = (code: string):                  Promise<SuccessResponse> => api.delete(`/states/${code}`).then(r => r.data);

// ── Pricing Model / Dual Pricing (Session 50) ───────────────────────────
// PricingTier catalog — surcharge rate presets keyed to SaaS billing tiers.
export const listPricingTiers     = (): Promise<{ tiers: PricingTier[] }> => api.get('/pricing/tiers').then(r => r.data);
export const createPricingTier    = (data: unknown): Promise<PricingTier> => api.post('/pricing/tiers', data).then(r => r.data);
export const updatePricingTier    = (id: string, data: unknown): Promise<PricingTier> => api.put(`/pricing/tiers/${id}`, data).then(r => r.data);
export const deletePricingTier    = (id: string): Promise<SuccessResponse> => api.delete(`/pricing/tiers/${id}`).then(r => r.data);

// Per-store config — superadmin only on PUT.
export const listStorePricingConfigs = (): Promise<{ stores: StorePricingSummary[] }> =>
  api.get('/pricing/stores').then(r => r.data);
export const getStorePricingConfig   = (storeId: string): Promise<StorePricingDetail> =>
  api.get(`/pricing/stores/${storeId}`).then(r => r.data);
export const updateStorePricingConfig = (storeId: string, data: unknown): Promise<{
  success: boolean;
  store: StorePricingDetail['storeName'] extends string ? StorePricingDetail : StorePricingDetail;
  effectiveRate: { percent: number; fixedFee: number; source: string; tierKey: string | null };
  auditWritten: boolean;
}> => api.put(`/pricing/stores/${storeId}`, data).then(r => r.data);
export const listStorePricingChanges = (storeId: string, limit?: number): Promise<{ changes: PricingModelChange[] }> =>
  api.get(`/pricing/stores/${storeId}/changes`, { params: { limit } }).then(r => r.data);

// Local types until @storeveu/types is regenerated for Session 50 schema.
// The shared package will pick these up on next prisma client regen.
export interface PricingTier {
  id: string;
  key: string;
  name: string;
  description: string | null;
  surchargePercent: number | string;
  surchargeFixedFee: number | string;
  active: boolean;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface StorePricingSummary {
  storeId: string;
  storeName: string;
  orgId: string;
  orgName: string | null;
  stateCode: string | null;
  stateName: string | null;
  pricingModel: string;
  pricingTierKey: string | null;
  pricingTierName: string | null;
  effectivePercent: number;
  effectiveFixedFee: number;
  effectiveSource: 'custom' | 'tier' | 'none';
  dualPricingActivatedAt: string | null;
}

export interface PricingModelChange {
  id: string;
  storeId: string;
  changedById: string;
  changedByName: string | null;
  fromModel: string;
  toModel: string;
  fromTierId: string | null;
  toTierId: string | null;
  fromPercent: number | string | null;
  toPercent: number | string | null;
  fromFixedFee: number | string | null;
  toFixedFee: number | string | null;
  reason: string | null;
  createdAt: string;
}

export interface StorePricingDetail {
  storeId: string;
  storeName: string;
  orgId: string;
  stateCode: string | null;
  pricingModel: string;
  pricingTierId: string | null;
  pricingTier: PricingTier | null;
  customSurchargePercent: number | string | null;
  customSurchargeFixedFee: number | string | null;
  dualPricingDisclosure: string | null;
  dualPricingActivatedAt: string | null;
  dualPricingActivatedBy: string | null;
  effectiveRate: { percent: number; fixedFee: number; source: 'custom' | 'tier' | 'none'; tierKey: string | null };
  effectiveDisclosure: string;
  stateConstraints: {
    surchargeTaxable: boolean;
    maxSurchargePercent: number | null;
    dualPricingAllowed: boolean;
    pricingFraming: string;
  } | null;
  recentChanges: PricingModelChange[];
}

// ── Vendor Import Templates (Session 5) ──────────────────────────────────────
export const getVendorTemplates      = (params: Params = {}):                         Promise<{ data?: VendorImportTemplate[] }> => api.get('/vendor-templates', { params }).then(r => r.data);
export const getVendorTemplate       = (id: string | number):                          Promise<{ data: VendorImportTemplate }> => api.get(`/vendor-templates/${id}`).then(r => r.data);
export const createVendorTemplate    = (data: unknown):                                 Promise<{ data: VendorImportTemplate }> => api.post('/vendor-templates', data).then(r => r.data);
export const updateVendorTemplate    = (id: string | number, data: unknown):             Promise<{ data: VendorImportTemplate }> => api.put(`/vendor-templates/${id}`, data).then(r => r.data);
export const deleteVendorTemplate    = (id: string | number):                           Promise<SuccessResponse> => api.delete(`/vendor-templates/${id}`).then(r => r.data);
export const getVendorTemplateTransforms = ():                                         Promise<{ data?: VendorTemplateTransform[] }> => api.get('/vendor-templates/transforms').then(r => r.data);
export const previewVendorTemplate   = (id: string | number, rows: unknown[]):           Promise<{ preview?: unknown[] }> => api.post(`/vendor-templates/${id}/preview`, { rows }).then(r => r.data);

// ── AI Assistant — admin review queue + KB curation ──────────────────────────
export const listAiReviews           = (status: string = 'pending'):                     Promise<{ reviews?: AiReview[] }> => api.get('/ai-assistant/admin/reviews', { params: { status } }).then(r => r.data);
export const getAiReviewConversation = (id: string | number):                             Promise<{ messages?: Array<{ id: string | number; role: string; content: string }> }> => api.get(`/ai-assistant/admin/reviews/${id}/conversation`).then(r => r.data);
export const promoteAiReview         = (id: string | number, data: unknown):               Promise<{ review: AiReview; article: KbArticle }> => api.post(`/ai-assistant/admin/reviews/${id}/promote`, data).then(r => r.data);
export const dismissAiReview         = (id: string | number):                             Promise<{ review: AiReview }> => api.post(`/ai-assistant/admin/reviews/${id}/dismiss`).then(r => r.data);

// ── AI Product Tours — list + edit (admin-only) ─────────────────────────────
export const listAiTours             = (params: Params = {}):                             Promise<{ tours?: AiTour[] }> => api.get('/ai-assistant/admin/tours', { params }).then(r => r.data);
export const getAiTour               = (id: string | number):                             Promise<{ tour: AiTour }> => api.get(`/ai-assistant/admin/tours/${id}`).then(r => r.data);
export const createAiTour            = (data: unknown):                                    Promise<{ tour: AiTour }> => api.post('/ai-assistant/admin/tours', data).then(r => r.data);
export const updateAiTour            = (id: string | number, data: unknown):                Promise<{ tour: AiTour }> => api.put(`/ai-assistant/admin/tours/${id}`, data).then(r => r.data);
export const deleteAiTour            = (id: string | number):                             Promise<SuccessResponse> => api.delete(`/ai-assistant/admin/tours/${id}`).then(r => r.data);

// ── AI Knowledge Base article management ─────────────────────────────────────
export const listKbArticles          = (params: Params = {}):                             Promise<{ articles?: KbArticle[] }> => api.get('/ai-assistant/admin/articles', { params }).then(r => r.data);
export const getKbArticle            = (id: string | number):                             Promise<{ article: KbArticle }> => api.get(`/ai-assistant/admin/articles/${id}`).then(r => r.data);
export const createKbArticle         = (data: unknown):                                   Promise<{ article: KbArticle }> => api.post('/ai-assistant/admin/articles', data).then(r => r.data);
export const updateKbArticle         = (id: string | number, data: unknown):               Promise<{ article: KbArticle }> => api.put(`/ai-assistant/admin/articles/${id}`, data).then(r => r.data);
export const deleteKbArticle         = (id: string | number):                             Promise<SuccessResponse> => api.delete(`/ai-assistant/admin/articles/${id}`).then(r => r.data);

// ── AI Assistant — chat widget (superadmin uses cross-tenant) ────────────────
// Chat response shapes are free-form because conversations / messages vary
// significantly per session and tool-call state.
export const listAiConversations  = (headers: Headers = {}):                                Promise<any> => api.get('/ai-assistant/conversations', { headers }).then(r => r.data);
export const createAiConversation = (headers: Headers = {}):                                Promise<any> => api.post('/ai-assistant/conversations', null, { headers }).then(r => r.data);
export const getAiConversation    = (id: string | number, headers: Headers = {}):            Promise<any> => api.get(`/ai-assistant/conversations/${id}`, { headers }).then(r => r.data);
export const sendAiMessage        = (id: string | number, content: string, headers: Headers = {}): Promise<any> =>
  api.post(`/ai-assistant/conversations/${id}/messages`, { content }, { headers }).then(r => r.data);
export const deleteAiConversation = (id: string | number, headers: Headers = {}):            Promise<any> => api.delete(`/ai-assistant/conversations/${id}`, { headers }).then(r => r.data);
export const submitAiFeedback     = (msgId: string | number, feedback: string, note: string | null = null, headers: Headers = {}): Promise<any> =>
  api.post(`/ai-assistant/messages/${msgId}/feedback`, { feedback, note }, { headers }).then(r => r.data);

// ── Admin Lottery Catalog (global, state-scoped ticket catalog) ──────────────
// Ticket Catalog CRUD — visible to all stores of the matching state.
// Some endpoints return Array directly, others wrap in { data } or { tickets } —
// response type is a loose union to match the backend's legacy shapes.
type LotteryCatalogListResponse = LotteryCatalogRow[] | { data?: LotteryCatalogRow[]; tickets?: LotteryCatalogRow[] };
type LotteryRequestsListResponse = LotteryRequest[] | { data?: LotteryRequest[]; requests?: LotteryRequest[] };

export const listAdminLotteryCatalog    = (params?: Params): Promise<LotteryCatalogListResponse> => api.get('/lottery/catalog/all', { params }).then(r => r.data);
export const createAdminLotteryCatalog  = (data: unknown):  Promise<{ catalog: LotteryCatalogRow }> => api.post('/lottery/catalog', data).then(r => r.data);
export const updateAdminLotteryCatalog  = (id: string | number, d: unknown): Promise<{ catalog: LotteryCatalogRow }> => api.put(`/lottery/catalog/${id}`, d).then(r => r.data);
export const deleteAdminLotteryCatalog  = (id: string | number): Promise<SuccessResponse> => api.delete(`/lottery/catalog/${id}`).then(r => r.data);

// Ticket Requests — store-submitted requests to add a game to the catalog.
export const listAdminLotteryRequests   = (params?: Params): Promise<LotteryRequestsListResponse> => api.get('/lottery/ticket-requests', { params }).then(r => r.data);
export const reviewAdminLotteryRequest  = (id: string | number, d: unknown): Promise<{ request: LotteryRequest }> => api.put(`/lottery/ticket-requests/${id}/review`, d).then(r => r.data);

// Supported states — backs the state dropdown in the Admin UI.
// Returns an array OR { states: [] } depending on route.
export const listAdminLotterySupportedStates = (): Promise<{ code: string; name: string }[] | { states?: { code: string; name: string }[] }> =>
  api.get('/states/public').then(r => r.data);

// Pull the latest games from the state lottery's public feed.
export const syncAdminLotteryCatalog = (state: string): Promise<{
  result?: { state: string; fetched: number; created: number; updated: number; nowInactive: number; error?: string; unsupported?: boolean };
  results?: Array<{ state: string; fetched?: number; created?: number; updated?: number; nowInactive?: number; error?: string }>;
}> =>
  api.post('/lottery/catalog/sync', { state }).then(r => r.data);

export default api;

// Re-export types for consumers — makes `import { AdminUser } from '../services/api'` work too.
export type {
  PaginatedResponse, MetaPaginatedResponse, SuccessResponse,
  AdminUser, Organization, AdminStore,
  PaymentMerchant, PaymentTerminal, PaymentMerchantAuditEntry,
  SupportTicket, CmsPage, CareerPosting, CareerApplication,
  Permission, Role, RoleSurface, UsStateRecord,
  LotteryCatalogRow, LotteryRequest,
  KbArticle, AiReview, AiTour,
  BillingPlan, BillingAddon, Subscription, BillingInvoice,
  EquipmentOrder, EquipmentProduct,
  VendorImportTemplate, VendorTemplateTransform,
  PriceScenario, SystemConfig,
  ImageRehostStatus, ImageRehostResult,
};
