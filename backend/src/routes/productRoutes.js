import express from 'express';
import { getProducts, bulkUpdatePrices } from '../controllers/productController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);
router.use(authorize('admin', 'store'));

router.get('/', getProducts);
router.put('/bulk-update', bulkUpdatePrices);

export default router;
