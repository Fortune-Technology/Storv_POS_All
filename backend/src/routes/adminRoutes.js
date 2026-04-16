/**
 * Admin Routes  —  /api/admin
 *
 * All routes require superadmin role.
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  getDashboardStats,
  getAllUsers,
  approveUser,
  suspendUser,
  rejectUser,
  createUser,
  updateUser,
  softDeleteUser,
  impersonateUser,
  getAllOrganizations,
  updateOrganization,
  createOrganization,
  softDeleteOrganization,
  getAllStores,
  createStore,
  updateStore,
  softDeleteStore,
  getCmsPages,
  createCmsPage,
  updateCmsPage,
  deleteCmsPage,
  getCareerPostings,
  createCareerPosting,
  updateCareerPosting,
  deleteCareerPosting,
  getSupportTickets,
  updateSupportTicket,
  createSupportTicket,
  deleteSupportTicket,
  addAdminTicketReply,
  getSystemConfig,
  updateSystemConfig,
  getAnalyticsDashboard,
  getOrgAnalytics,
  getStorePerformance,
  getUserActivity,
  getJobApplications,
  updateJobApplication,
  adminListPaymentTerminals,
  adminPingTerminal,
  adminGetPaymentMerchant,
  adminSavePaymentMerchant,
  adminGetPaymentSettings,
  adminSavePaymentSettings,
  adminListPaymentHistory,
  adminCreateTerminal,
  adminUpdateTerminal,
  adminDeleteTerminal,
  adminListPlans,
  adminCreatePlan,
  adminUpdatePlan,
  adminDeletePlan,
  adminCreateAddon,
  adminUpdateAddon,
  adminListSubscriptions,
  adminGetSubscription,
  adminUpsertSubscription,
  adminListInvoices,
  adminWriteOffInvoice,
  adminRetryInvoiceNow,
  adminListEquipmentProducts,
  adminCreateEquipmentProduct,
  adminUpdateEquipmentProduct,
  adminListEquipmentOrders,
  adminUpdateEquipmentOrder,
} from '../controllers/adminController.js';

import { downloadBackup } from '../controllers/backupController.js';

const router = Router();

// All admin routes require auth + superadmin role
router.use(protect);
router.use(authorize('superadmin'));

// Dashboard
router.get('/dashboard', getDashboardStats);

// Analytics
router.get('/analytics/dashboard',     getAnalyticsDashboard);
router.get('/analytics/organizations', getOrgAnalytics);
router.get('/analytics/stores',        getStorePerformance);
router.get('/analytics/users',         getUserActivity);

// User management (cross-org)
router.get('/users',                   getAllUsers);
router.post('/users',                  createUser);
router.put('/users/:id',               updateUser);
router.delete('/users/:id',            softDeleteUser);
router.put('/users/:id/approve',       approveUser);
router.put('/users/:id/suspend',       suspendUser);
router.put('/users/:id/reject',        rejectUser);
router.post('/users/:id/impersonate',  impersonateUser);

// Organization management
router.get('/organizations',           getAllOrganizations);
router.post('/organizations',          createOrganization);
router.put('/organizations/:id',       updateOrganization);
router.delete('/organizations/:id',    softDeleteOrganization);

// Store management (cross-org)
router.get('/stores',                  getAllStores);
router.post('/stores',                 createStore);
router.put('/stores/:id',              updateStore);
router.delete('/stores/:id',           softDeleteStore);

// CMS pages
router.get('/cms',                getCmsPages);
router.post('/cms',               createCmsPage);
router.put('/cms/:id',            updateCmsPage);
router.delete('/cms/:id',         deleteCmsPage);

// Career postings + applications
router.get('/careers',                    getCareerPostings);
router.post('/careers',                   createCareerPosting);
router.put('/careers/:id',                updateCareerPosting);
router.delete('/careers/:id',             deleteCareerPosting);
router.get('/careers/:id/applications',   getJobApplications);
router.put('/applications/:id',           updateJobApplication);

// Support tickets
router.get('/tickets',              getSupportTickets);
router.post('/tickets',             createSupportTicket);
router.put('/tickets/:id',          updateSupportTicket);
router.delete('/tickets/:id',       deleteSupportTicket);
router.post('/tickets/:id/reply',   addAdminTicketReply);

// System config
router.get('/config',             getSystemConfig);
router.put('/config',             updateSystemConfig);

// Payment terminals (cross-org superadmin view)
router.get('/payment/terminals',            adminListPaymentTerminals);
router.post('/payment/terminals/:id/ping',  adminPingTerminal);

// ── Payment management (cross-org superadmin) ─────────────────────────────
router.get( '/payment/merchant',             adminGetPaymentMerchant);
router.put( '/payment/merchant',             adminSavePaymentMerchant);
router.get( '/payment/settings/:storeId',    adminGetPaymentSettings);
router.put( '/payment/settings/:storeId',    adminSavePaymentSettings);
router.get( '/payment/history',              adminListPaymentHistory);
router.post('/payment/terminals',            adminCreateTerminal);
router.put( '/payment/terminals/:id',        adminUpdateTerminal);
router.delete('/payment/terminals/:id',      adminDeleteTerminal);

// ── Admin Billing — Plans ──────────────────────────────────────────────────
router.get('/billing/plans',                adminListPlans);
router.post('/billing/plans',               adminCreatePlan);
router.put('/billing/plans/:id',            adminUpdatePlan);
router.delete('/billing/plans/:id',         adminDeletePlan);
router.post('/billing/addons',              adminCreateAddon);
router.put('/billing/addons/:id',           adminUpdateAddon);

// ── Admin Billing — Subscriptions ──────────────────────────────────────────
router.get('/billing/subscriptions',              adminListSubscriptions);
router.get('/billing/subscriptions/:orgId',       adminGetSubscription);
router.put('/billing/subscriptions/:orgId',       adminUpsertSubscription);

// ── Admin Billing — Invoices ────────────────────────────────────────────────
router.get('/billing/invoices',                   adminListInvoices);
router.post('/billing/invoices/:id/write-off',    adminWriteOffInvoice);
router.post('/billing/invoices/:id/retry',        adminRetryInvoiceNow);

// ── Admin Billing — Equipment Products ─────────────────────────────────────
router.get('/billing/equipment/products',         adminListEquipmentProducts);
router.post('/billing/equipment/products',        adminCreateEquipmentProduct);
router.put('/billing/equipment/products/:id',     adminUpdateEquipmentProduct);

// ── Admin Billing — Equipment Orders ───────────────────────────────────────
router.get('/billing/equipment/orders',           adminListEquipmentOrders);
router.put('/billing/equipment/orders/:id',       adminUpdateEquipmentOrder);

// ── Database Backup ───────────────────────────────────────────────────────
router.get('/backup/:target',                    downloadBackup);

export default router;
