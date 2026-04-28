/**
 * Sales Analytics Routes — /api/sales/*
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { attachPOSUser } from '../middleware/attachPOSUser.js';
import { requirePermission } from '../rbac/permissionService.js';
import {
  daily,
  weekly,
  monthly,
  monthlyComparison,
  departments,
  departmentComparison,
  topProducts,
  productsGrouped,
  productMovement,
  dailyProductMovement,
  product52WeekStats,
  predictionsDaily,
  predictionsWeekly,
  predictionsResiduals,
  predictionsHourly,
  predictionsMonthly,
  predictionsFactors,
  vendorOrders,
  dailyWithWeather,
  weeklyWithWeather,
  monthlyWithWeather,
  yearlyWithWeather,
  realtimeSales,
} from '../controllers/salesController.js';
import { getDualPricingReport, getSurchargeReconciliation } from '../controllers/dualPricingReportController.js';

const router = Router();

// All routes require JWT auth
router.use(protect);
router.use(scopeToTenant);   // sets req.storeId from X-Store-Id header or first store
router.use(attachPOSUser);   // gets store.pos JSON → req.posUser.marktPOSConfig

// All sales analytics endpoints require analytics.view — except /realtime
// which feeds the Live Dashboard and needs dashboard.view.
router.get('/realtime', requirePermission('dashboard.view', 'analytics.view'), realtimeSales);
router.use(requirePermission('analytics.view', 'predictions.view'));

// Session 52 — Dual Pricing report + on-demand reconciliation
router.get('/dual-pricing-report',  getDualPricingReport);
router.get('/dual-pricing-reconcile', getSurchargeReconciliation);

// Sales summaries
router.get('/daily', daily);
router.get('/weekly', weekly);
router.get('/monthly', monthly);
router.get('/monthly-comparison', monthlyComparison);

// Sales + Weather combined
router.get('/daily-with-weather', dailyWithWeather);
router.get('/weekly-with-weather', weeklyWithWeather);
router.get('/monthly-with-weather', monthlyWithWeather);
router.get('/yearly-with-weather', yearlyWithWeather);

// Departments
router.get('/departments', departments);
router.get('/departments/comparison', departmentComparison);

// Products
router.get('/products/top', topProducts);
router.get('/products/grouped', productsGrouped);
router.get('/products/movement', productMovement);
router.get('/products/daily-movement', dailyProductMovement);
router.get('/products/52week-stats', product52WeekStats);

// Predictions
router.get('/predictions/daily', predictionsDaily);
router.get('/predictions/weekly', predictionsWeekly);
router.get('/predictions/hourly', predictionsHourly);
router.get('/predictions/monthly', predictionsMonthly);
router.get('/predictions/factors', predictionsFactors);
router.get('/predictions/residuals', predictionsResiduals);

// Vendor orders
router.get('/vendor-orders', vendorOrders);

export default router;
