import express from 'express';
import { getCustomers, getCustomerById, checkPoints } from '../controllers/customerController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);
router.use(authorize('admin', 'store'));

router.get('/', getCustomers);
router.get('/:id', getCustomerById);
router.post('/check-points', checkPoints);

export default router;
