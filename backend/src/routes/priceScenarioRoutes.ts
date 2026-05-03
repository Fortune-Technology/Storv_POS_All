/**
 * Price Scenario routes — /api/price-scenarios
 * Superadmin-only (sales team tool).
 */

import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  listPriceScenarios,
  getPriceScenario,
  createPriceScenario,
  updatePriceScenario,
  deletePriceScenario,
} from '../controllers/priceScenarioController.js';

const router = Router();

router.use(protect, authorize('superadmin'));

router.get   ('/',     listPriceScenarios);
router.post  ('/',     createPriceScenario);
router.get   ('/:id',  getPriceScenario);
router.put   ('/:id',  updatePriceScenario);
router.delete('/:id',  deletePriceScenario);

export default router;
