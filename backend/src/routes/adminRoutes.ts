/**
 * Admin Routes  —  /api/admin
 *
 * All routes require superadmin role.
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  listPaymentMerchants,
  getPaymentMerchant,
  createPaymentMerchant,
  updatePaymentMerchant,
  deletePaymentMerchant,
  testPaymentMerchant,
  activatePaymentMerchant,
  disablePaymentMerchant,
  getPaymentMerchantAudit,
} from '../controllers/adminPaymentMerchantController.js';
import {
  listTerminals,
  createTerminal,
  updateTerminal,
  deleteTerminal,
  pingTerminal,
  listStationsForStore,
} from '../controllers/adminPaymentTerminalController.js';
import {
  regenerateHppWebhookSecret,
  getHppWebhookUrl,
} from '../controllers/dejavooHppController.js';
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
  assignTicket,
  getAssignableUsers,
  getSystemConfig,
  updateSystemConfig,
  getAnalyticsDashboard,
  getOrgAnalytics,
  getStorePerformance,
  getUserActivity,
  getJobApplications,
  updateJobApplication,
  adminListPaymentHistory,
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
  adminDeleteEquipmentProduct,
  adminUploadEquipmentImage,
  equipmentImageUploadMiddleware,
  adminListEquipmentOrders,
  adminUpdateEquipmentOrder,
} from '../controllers/adminController.js';

import { downloadBackup } from '../controllers/backupController.js';
import { rehostBatch, getRehostStatus } from '../services/imageRehostService.js';
import { getSaasMarginReport } from '../controllers/saasMarginController.js';
import {
  adminBroadcastNotification,
  adminListBroadcasts,
  adminRecallBroadcast,
} from '../controllers/notificationController.js';

const router = Router();

// All admin routes require auth + superadmin role
router.use(protect);
router.use(authorize('superadmin'));

// Dashboard
router.get('/dashboard', getDashboardStats);

// Session 52 — SaaS margin report (per-org dual-pricing rev share)
router.get('/saas-margin', getSaasMarginReport);

// Analytics
router.get('/analytics/dashboard',     getAnalyticsDashboard);
router.get('/analytics/organizations', getOrgAnalytics);
router.get('/analytics/stores',        getStorePerformance);
router.get('/analytics/users',         getUserActivity);

// User management (cross-org)
router.get('/users',                   getAllUsers);
router.get('/users/assignable',        getAssignableUsers);
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
router.put('/tickets/:id/assign',   assignTicket);

// Notifications — superadmin broadcast (audience: platform / org / store / user)
router.get(   '/notifications',     adminListBroadcasts);
router.post(  '/notifications',     adminBroadcastNotification);
router.delete('/notifications/:id', adminRecallBroadcast);

// System config
router.get('/config',             getSystemConfig);
router.put('/config',             updateSystemConfig);

// ── Payment transaction history (cross-org superadmin) ────────────────────
router.get('/payment/history', adminListPaymentHistory);

// ── Dejavoo Payment Merchants (per-store credentials, superadmin-only) ──
router.get(   '/payment-merchants',               listPaymentMerchants);
router.get(   '/payment-merchants/:id',           getPaymentMerchant);
router.post(  '/payment-merchants',               createPaymentMerchant);
router.put(   '/payment-merchants/:id',           updatePaymentMerchant);
router.delete('/payment-merchants/:id',           deletePaymentMerchant);
router.post(  '/payment-merchants/:id/test',      testPaymentMerchant);
router.post(  '/payment-merchants/:id/activate',  activatePaymentMerchant);
router.post(  '/payment-merchants/:id/disable',   disablePaymentMerchant);
router.get(   '/payment-merchants/:id/audit',     getPaymentMerchantAudit);

// ── Dejavoo HPP webhook secret (per-store opaque token) ─────────────────
// regenerate-hpp-secret returns plaintext ONCE so admin can paste the
// resulting URL into iPOSpays. Hpp-webhook-url returns the current full
// URL for display.
router.post(  '/payment-merchants/:id/regenerate-hpp-secret', regenerateHppWebhookSecret);
router.get(   '/payment-merchants/:id/hpp-webhook-url',       getHppWebhookUrl);

// ── Dejavoo Payment Terminals (per-device, one per station) ───────────
router.get(   '/payment-terminals',                listTerminals);
// Station picker for the Add Terminal modal — scoped by ?storeId=... and
// returns each station's pairing status so the UI can disable already-paired ones.
router.get(   '/payment-terminals/stations',       listStationsForStore);
router.post(  '/payment-terminals',                createTerminal);
router.put(   '/payment-terminals/:id',            updateTerminal);
router.delete('/payment-terminals/:id',            deleteTerminal);
router.post(  '/payment-terminals/:id/ping',       pingTerminal);

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
router.delete('/billing/equipment/products/:id',  adminDeleteEquipmentProduct);
router.post('/billing/equipment/upload',          equipmentImageUploadMiddleware, adminUploadEquipmentImage);

// ── Admin Billing — Equipment Orders ───────────────────────────────────────
router.get('/billing/equipment/orders',           adminListEquipmentOrders);
router.put('/billing/equipment/orders/:id',       adminUpdateEquipmentOrder);

// ── Database Backup ───────────────────────────────────────────────────────
router.get('/backup/:target',                    downloadBackup);

// ── Image Re-hosting ──────────────────────────────────────────────────────
router.get('/images/rehost-status', async (_req, res) => {
  try { res.json(await getRehostStatus()); }
  catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

router.post('/images/rehost', async (req, res) => {
  try {
    const batchSize = parseInt(req.body?.batchSize) || 100;
    const result = await rehostBatch(batchSize);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

export default router;
