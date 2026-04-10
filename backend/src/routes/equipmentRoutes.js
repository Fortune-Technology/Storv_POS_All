/**
 * Equipment Routes — /api/equipment
 * All public — no authentication required.
 */

import { Router } from 'express';
import {
  listProducts,
  getProduct,
  createOrder,
  getOrderStatus,
} from '../controllers/equipmentController.js';

const router = Router();

router.get('/products',       listProducts);
router.get('/products/:slug', getProduct);
router.post('/orders',        createOrder);
router.get('/orders/:id',     getOrderStatus);

export default router;
