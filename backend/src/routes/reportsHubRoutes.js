/**
 * Reports Hub Routes — /api/reports/hub/*
 */
import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  getSummaryReport,
  getTaxReport,
  getInventoryReport,
  getCompareReport,
  getNotesReport,
  getEventsReport,
  getReceiveReport,
  getHouseAccountReport,
} from '../controllers/reportsHubController.js';

const router = Router();
router.use(protect);
router.use(scopeToTenant);

router.get('/summary',        getSummaryReport);
router.get('/tax',            getTaxReport);
router.get('/inventory',      getInventoryReport);
router.get('/compare',        getCompareReport);
router.get('/notes',          getNotesReport);
router.get('/events',         getEventsReport);
router.get('/receive',        getReceiveReport);
router.get('/house-accounts', getHouseAccountReport);

export default router;
