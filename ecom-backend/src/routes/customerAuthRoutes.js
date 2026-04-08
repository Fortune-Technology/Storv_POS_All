/**
 * Customer auth routes — mounted under /api/store/:slug/auth
 */

import { Router } from 'express';
import { resolveStoreBySlug } from '../middleware/storeResolver.js';
import { protectCustomer } from '../middleware/customerAuth.js';
import { signup, login, getProfile, updateProfile, getMyOrders } from '../controllers/customerAuthController.js';

const router = Router();

router.post('/store/:slug/auth/signup', resolveStoreBySlug, signup);
router.post('/store/:slug/auth/login', resolveStoreBySlug, login);
router.get('/store/:slug/auth/me', resolveStoreBySlug, protectCustomer, getProfile);
router.put('/store/:slug/auth/me', resolveStoreBySlug, protectCustomer, updateProfile);
router.get('/store/:slug/auth/orders', resolveStoreBySlug, protectCustomer, getMyOrders);

export default router;
