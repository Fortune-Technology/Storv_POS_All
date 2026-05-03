/**
 * internalApiKey.ts
 *
 * Reusable middleware for service-to-service calls using a shared secret
 * passed in the `X-Internal-Api-Key` header.
 *
 * Used by endpoints that other Storeveu services (ecom-backend, future
 * worker processes) call directly, NOT via end-user JWT. The shared key
 * lives in `process.env.INTERNAL_API_KEY` on both ends.
 *
 * Why not JWT here?
 *   Service-to-service calls don't have a logged-in user. A long-lived
 *   shared secret pinned by Nginx/firewall is the right model for trust
 *   between backend services on the same private network.
 *
 * Use:
 *   import { requireInternalApiKey } from '../middleware/internalApiKey.js';
 *   router.post('/internal-only-endpoint', requireInternalApiKey, handler);
 *
 * Generate a key:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   Then set INTERNAL_API_KEY=<that hex> in BOTH backend/.env and
 *   ecom-backend/.env (must match).
 */

import crypto from 'crypto';
import type { RequestHandler } from 'express';

export const requireInternalApiKey: RequestHandler = (req, res, next) => {
  const provided = req.get('x-internal-api-key') || req.get('X-Internal-Api-Key');
  const expected = process.env.INTERNAL_API_KEY;

  if (!expected) {
    console.error('[internalApiKey] INTERNAL_API_KEY is not set in env — refusing all internal calls');
    res.status(500).json({ success: false, error: 'Internal API not configured' });
    return;
  }
  if (!provided) {
    res.status(401).json({ success: false, error: 'Missing X-Internal-Api-Key header' });
    return;
  }

  // Constant-time compare to defeat timing attacks.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ success: false, error: 'Invalid internal API key' });
    return;
  }

  next();
};
