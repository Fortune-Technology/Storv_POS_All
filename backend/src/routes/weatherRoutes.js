/**
 * Weather Routes — /api/weather/*
 */

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  getWeatherRange,
  getWeatherCurrent,
  updateStoreLocation,
  getStoreLocation,
} from '../controllers/weatherController.js';

const router = Router();

// All routes require JWT auth
router.use(protect);

// Weather data
router.get('/range', getWeatherRange);
router.get('/current', getWeatherCurrent);

// Store location
router.get('/store-location', getStoreLocation);
router.put('/store-location', updateStoreLocation);

export default router;
