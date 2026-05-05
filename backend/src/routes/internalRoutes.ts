/**
 * Internal Routes — service-to-service endpoints (F32).
 *
 * All routes here are auth'd via `X-Internal-Api-Key` (shared secret pinned by
 * env var). NOT exposed to end-user JWTs. Mounted at `/api/internal/*`.
 *
 * Currently hosts:
 *   GET /api/internal/storefront-pricing/:storeId
 *     Called by ecom-backend's syncRoutes during product upserts to apply the
 *     storefront's markup/rounding/exclusion pipeline before writing
 *     EcomProduct.retailPrice.
 */

import { Router } from 'express';
import { requireInternalApiKey } from '../middleware/internalApiKey.js';
import { getStorefrontPricing } from '../controllers/storefrontPricingController.js';

const router = Router();

router.use(requireInternalApiKey);

router.get('/storefront-pricing/:storeId', getStorefrontPricing);

export default router;
