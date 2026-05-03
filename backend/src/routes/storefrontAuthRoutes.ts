/**
 * Storefront Auth Routes
 * Server-to-server endpoints called by ecom-backend.
 * No POS JWT middleware — follows same pattern as ecom-stock-check.
 */

import { Router } from 'express';
import {
  signup,
  login,
  getProfile,
  updateProfile,
  changePassword,
  listCustomers,
  countCustomers,
} from '../controllers/storefrontAuthController.js';

const router = Router();

// Auth
router.post('/auth/signup', signup);
router.post('/auth/login', login);

// Profile
router.get('/auth/profile/:customerId', getProfile);
router.put('/auth/profile/:customerId', updateProfile);
router.put('/auth/password/:customerId', changePassword);

// Management (called by ecom-backend portal endpoints)
router.get('/customers', listCustomers);
router.get('/customers/count', countCustomers);

export default router;
