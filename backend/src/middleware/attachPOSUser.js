/**
 * attachPOSUser middleware
 *
 * Runs after `protect` + `scopeToTenant` on all /api/pos/* routes.
 * Loads the active store's POS credentials and attaches req.posUser
 * so every POS controller can simply pass req.posUser to
 * marktPOSRequest() without knowing about credential location.
 *
 * Credential resolution order:
 *   1. Active store's pos.username / pos.password  (normal production path)
 *   2. MARKTPOS_USERNAME / MARKTPOS_PASSWORD env   (dev / fallback)
 *   3. req.user fields                             (legacy)
 */

import prisma from '../config/postgres.js';

export const attachPOSUser = async (req, res, next) => {
  try {
    const base = { ...req.user };

    let username = base.marktPOSUsername;
    let password = base.marktPOSPassword;

    if (req.storeId) {
      try {
        const store = await prisma.store.findUnique({
          where: { id: req.storeId },
          select: { pos: true },
        });
        const pos = store?.pos;
        if (pos?.type === 'itretail' && pos.username && pos.password) {
          username = pos.username;
          password = pos.password;
        }
      } catch (storeErr) {
        console.warn('⚠️ attachPOSUser: could not load store:', storeErr.message);
      }
    }

    if (!username) username = process.env.MARKTPOS_USERNAME;
    if (!password) password = process.env.MARKTPOS_PASSWORD;

    req.posUser = {
      ...base,
      marktPOSUsername: username || '',
      marktPOSPassword: password || '',
    };

    next();
  } catch (err) {
    console.warn('⚠️ attachPOSUser error (non-fatal):', err.message);
    req.posUser = req.user;
    next();
  }
};
