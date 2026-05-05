/**
 * Storefront Pricing — internal endpoint for ecom-backend (F32).
 *
 * Returns the storefront's `StoreIntegration.pricingConfig` for a given store
 * along with a velocity map computed from Transaction history. The ecom-backend
 * sync pipeline calls this once per sync request, applies the pure-function
 * pipeline (markupMarkup.js port) to incoming product payloads, and writes the
 * marked-up `retailPrice` to `EcomProduct`.
 *
 * Auth: X-Internal-Api-Key (server-to-server only).
 *
 * GET /api/internal/storefront-pricing/:storeId
 *   ?windowDays=N (optional override; defaults to maxVelocityWindowDays of config)
 *
 * Response shape:
 *   {
 *     pricingConfig: { ...normalized },
 *     velocityMap:   { [productId]: avgDaily },   // empty when not in estimate mode
 *     windowDays:    number,                       // window used for velocity
 *     fetchedAt:     ISO timestamp,
 *   }
 *
 * Performance notes:
 * - One Prisma query for the StoreIntegration row.
 * - One Prisma query for Transaction history (only when estimate mode is on).
 * - ecom-backend caches the response per-store in memory for ~60s to avoid
 *   re-fetching on every product upsert during a full sync (which can iterate
 *   thousands of products).
 */

import type { Request, Response, NextFunction } from 'express';
import prisma from '../config/postgres.js';
import {
  normalizeConfig,
  type MarketplacePricingConfig,
} from '../services/marketplaceMarkup.js';
import {
  computeVelocityMap,
  maxVelocityWindowDays,
} from '../services/inventorySyncService.js';

export const getStorefrontPricing = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { storeId } = req.params;

    if (!storeId) {
      res.status(400).json({ error: 'storeId param is required' });
      return;
    }

    // Fetch the storefront's StoreIntegration row + the store's orgId
    const integration = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId, platform: 'storefront' } },
      select: { orgId: true, pricingConfig: true },
    });

    // No row yet = storefront pricing not configured. Return defaults so the
    // caller can still apply the no-op pipeline (zero markup, no rounding) and
    // write raw prices. This makes the F32 wiring backwards-compatible.
    if (!integration) {
      const defaultConfig = normalizeConfig({});
      res.json({
        pricingConfig: defaultConfig,
        velocityMap:   {},
        windowDays:    0,
        fetchedAt:     new Date().toISOString(),
      });
      return;
    }

    const pricingConfig = normalizeConfig(
      (integration.pricingConfig as unknown as MarketplacePricingConfig) ?? {},
    );

    // Velocity is only computed when the marketplace policy actually needs it.
    // For send_zero / send_default modes we skip the Transaction query entirely.
    const needsVelocity = pricingConfig.unknownStockBehavior === 'estimate_from_velocity';
    const overrideWin = req.query.windowDays != null ? Number(req.query.windowDays) : null;
    const windowDays = needsVelocity
      ? (overrideWin && overrideWin > 0 ? Math.round(overrideWin) : maxVelocityWindowDays(pricingConfig))
      : 0;

    let velocityMap: Record<string, number> = {};
    if (windowDays > 0) {
      const computed = await computeVelocityMap(integration.orgId, storeId, windowDays);
      // Convert Map<number, number> → plain object for JSON transport
      for (const [productId, avgDaily] of computed.entries()) {
        velocityMap[String(productId)] = avgDaily;
      }
    }

    res.json({
      pricingConfig,
      velocityMap,
      windowDays,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) { next(err); }
};
