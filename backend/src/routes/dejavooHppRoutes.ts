/**
 * Dejavoo HPP routes — /api/payment/dejavoo/hpp/*
 *
 * Mixed-auth router:
 *   POST /create-session    — internal-API-key (service-to-service from ecom-backend)
 *   POST /webhook/:secret   — PUBLIC (Dejavoo posts here; trust = URL secret + HMAC)
 *
 * Admin endpoints for managing the HPP webhook secret live in adminRoutes.js
 * under /api/admin/payment-merchants/:id/...
 */

import { Router } from 'express';
import { requireInternalApiKey } from '../middleware/internalApiKey.js';
import {
  dejavooHppCreateSession,
  dejavooHppWebhook,
} from '../controllers/dejavooHppController.js';

const router = Router();

// Service-to-service: ecom-backend asks us to start a hosted checkout session.
router.post('/create-session', requireInternalApiKey, dejavooHppCreateSession);

// Public: Dejavoo posts payment-status notifications here.
// Trust comes from (a) per-store opaque secret in URL, (b) HMAC-SHA256 header.
// This route relies on `req.rawBody` being populated — see server.js where
// express.json() is configured with a `verify` callback to capture it.
router.post('/webhook/:secret', dejavooHppWebhook);

export default router;
