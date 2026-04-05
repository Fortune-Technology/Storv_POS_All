import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  paxSale,
  paxVoid,
  paxRefund,
  paxTest,
  saveHardwareConfig,
  getHardwareConfig,
} from '../controllers/paymentController.js';

const router = express.Router();

// PAX payment operations — cashier+
router.post('/pax/sale',   protect, scopeToTenant, paxSale);
router.post('/pax/void',   protect, scopeToTenant, paxVoid);
router.post('/pax/refund', protect, scopeToTenant, paxRefund);
router.post('/pax/test',   protect, scopeToTenant, paxTest);

// Hardware config — manager+
router.get('/hardware/:stationId',  protect, scopeToTenant, getHardwareConfig);
router.post('/hardware',            protect, scopeToTenant, saveHardwareConfig);

export default router;
