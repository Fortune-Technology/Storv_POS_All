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
  getSystemConfig,
  updateSystemConfig,
  getAnalyticsDashboard,
  getOrgAnalytics,
  getStorePerformance,
  getUserActivity,
  getJobApplications,
  updateJobApplication,
} from '../controllers/adminController.js';

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
router.get('/tickets',            getSupportTickets);
router.put('/tickets/:id',        updateSupportTicket);

// System config
router.get('/config',             getSystemConfig);
router.put('/config',             updateSystemConfig);

export default router;
