/**
 * attachPOSUser middleware
 *
 * Runs after `protect` + `scopeToTenant` on all /api/pos/* routes.
 * Loads the active store's POS credentials and attaches req.posUser
 * so every POS controller can simply pass req.posUser to
 * the POS request helper without knowing about credential location.
 *
 * Credential resolution order:
 *   1. Active store's pos.username / pos.password  (normal production path)
 *   2. MARKTPOS_USERNAME / MARKTPOS_PASSWORD env   (dev / fallback)
 */

import type { RequestHandler } from 'express';
import prisma from '../config/postgres.js';

interface StorePosConfig {
  username?: string;
  password?: string;
  baseURL?: string;
  securityCode?: string;
  accessLevel?: string;
}

export const attachPOSUser: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      // Should not happen — `protect` runs before us. Be defensive anyway.
      next();
      return;
    }

    const base = { ...req.user };

    let username: string | null = null;
    let password: string | null = null;
    const config = {
      baseURL:      'https://app.marktpos.com',
      securityCode: '',
      accessLevel:  '0',
    };

    if (req.storeId) {
      try {
        const store = await prisma.store.findUnique({
          where: { id: req.storeId },
          select: { pos: true },
        });
        const pos = store?.pos as StorePosConfig | null | undefined;
        if (pos) {
          username = pos.username || username;
          password = pos.password || password;
          if (pos.baseURL)      config.baseURL      = pos.baseURL;
          if (pos.securityCode) config.securityCode = pos.securityCode;
          if (pos.accessLevel)  config.accessLevel  = pos.accessLevel;
        }
      } catch (storeErr) {
        const message = storeErr instanceof Error ? storeErr.message : String(storeErr);
        console.warn('⚠️ attachPOSUser: could not load store:', message);
      }
    }

    req.posUser = {
      ...base,
      posUsername: username || '',
      posPassword: password || '',
      posConfig:   config,
    };

    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('⚠️ attachPOSUser error (non-fatal):', message);
    // Fall back to bare user — older code paths tolerate the missing pos creds.
    if (req.user) {
      req.posUser = {
        ...req.user,
        posUsername: '',
        posPassword: '',
        posConfig: { baseURL: 'https://app.marktpos.com', securityCode: '', accessLevel: '0' },
      };
    }
    next();
  }
};
