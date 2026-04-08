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

export default api;
