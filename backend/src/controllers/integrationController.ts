/**
 * Integration Controller — Platform integration management endpoints
 *
 * Handles connecting/disconnecting delivery platforms (DoorDash, UberEats, etc.),
 * inventory sync, order management, and analytics for all platform orders.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/postgres.js';
import { getPlatformAdapter, PLATFORMS, type PlatformCredentials } from '../services/platforms/index.js';
import { pushInventory, previewMarketplaceImpact } from '../services/inventorySyncService.js';
import { logAudit } from '../services/auditService.js';
import {
  normalizeConfig as normalizePricingConfig,
  type MarketplacePricingConfig,
  type RoundingMode,
  type SyncMode,
  type UnknownStockBehavior,
} from '../services/marketplaceMarkup.js';

// ── Pricing config validation ────────────────────────────────────────────────

const VALID_ROUNDING: RoundingMode[] = [
  'none', 'nearest_dollar', 'nearest_half', 'charm_99', 'charm_95', 'psych_smart',
];
const VALID_SYNC_MODES: SyncMode[] = ['all', 'in_stock_only', 'active_promos_only'];
const VALID_UNKNOWN_STOCK: UnknownStockBehavior[] = [
  'send_zero', 'send_default', 'estimate_from_velocity',
];

/**
 * Validate + sanitize incoming pricingConfig before persisting.
 * Throws { status, message } on invalid input.
 */
function validatePricingConfig(raw: unknown): MarketplacePricingConfig {
  if (raw == null || typeof raw !== 'object') {
    throw { status: 400, message: 'pricingConfig must be an object' };
  }
  const c = raw as Record<string, unknown>;
  const out: MarketplacePricingConfig = {};

  // markupPercent: number, -100 to 1000 (allow large markups + small discounts)
  if (c.markupPercent !== undefined) {
    const n = Number(c.markupPercent);
    if (!Number.isFinite(n) || n < -100 || n > 1000) {
      throw { status: 400, message: 'markupPercent must be a number between -100 and 1000' };
    }
    out.markupPercent = Math.round(n * 100) / 100; // 2dp precision
  }

  // categoryMarkups: Record<string, number>
  if (c.categoryMarkups !== undefined) {
    if (typeof c.categoryMarkups !== 'object' || Array.isArray(c.categoryMarkups)) {
      throw { status: 400, message: 'categoryMarkups must be an object' };
    }
    const map: Record<string, number> = {};
    for (const [key, val] of Object.entries(c.categoryMarkups as Record<string, unknown>)) {
      const n = Number(val);
      if (!Number.isFinite(n) || n < -100 || n > 1000) {
        throw { status: 400, message: `categoryMarkups[${key}] must be a number between -100 and 1000` };
      }
      map[String(key)] = Math.round(n * 100) / 100;
    }
    out.categoryMarkups = map;
  }

  // roundingMode: enum
  if (c.roundingMode !== undefined) {
    if (typeof c.roundingMode !== 'string' || !VALID_ROUNDING.includes(c.roundingMode as RoundingMode)) {
      throw { status: 400, message: `roundingMode must be one of: ${VALID_ROUNDING.join(', ')}` };
    }
    out.roundingMode = c.roundingMode as RoundingMode;
  }

  // inventorySyncEnabled: boolean
  if (c.inventorySyncEnabled !== undefined) {
    if (typeof c.inventorySyncEnabled !== 'boolean') {
      throw { status: 400, message: 'inventorySyncEnabled must be a boolean' };
    }
    out.inventorySyncEnabled = c.inventorySyncEnabled;
  }

  // syncMode: enum
  if (c.syncMode !== undefined) {
    if (typeof c.syncMode !== 'string' || !VALID_SYNC_MODES.includes(c.syncMode as SyncMode)) {
      throw { status: 400, message: `syncMode must be one of: ${VALID_SYNC_MODES.join(', ')}` };
    }
    out.syncMode = c.syncMode as SyncMode;
  }

  // excludedDepartmentIds / excludedProductIds: arrays of (string | number)
  for (const field of ['excludedDepartmentIds', 'excludedProductIds'] as const) {
    if (c[field] !== undefined) {
      if (!Array.isArray(c[field])) {
        throw { status: 400, message: `${field} must be an array` };
      }
      const arr = (c[field] as unknown[]).map((v) => {
        if (typeof v === 'string' || typeof v === 'number') return v;
        throw { status: 400, message: `${field} entries must be strings or numbers` };
      });
      out[field] = arr as (string | number)[];
    }
  }

  // minMarginPercent: 0 to 100
  if (c.minMarginPercent !== undefined) {
    const n = Number(c.minMarginPercent);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw { status: 400, message: 'minMarginPercent must be a number between 0 and 100' };
    }
    out.minMarginPercent = Math.round(n * 100) / 100;
  }

  // taxInclusive: boolean
  if (c.taxInclusive !== undefined) {
    if (typeof c.taxInclusive !== 'boolean') {
      throw { status: 400, message: 'taxInclusive must be a boolean' };
    }
    out.taxInclusive = c.taxInclusive;
  }

  // prepTimeMinutes: 0 to 240 (4 hours max — sanity)
  if (c.prepTimeMinutes !== undefined) {
    const n = Number(c.prepTimeMinutes);
    if (!Number.isFinite(n) || n < 0 || n > 240) {
      throw { status: 400, message: 'prepTimeMinutes must be a number between 0 and 240' };
    }
    out.prepTimeMinutes = Math.round(n);
  }

  // S71c — velocityWindowDays: 1 to 365 (one year max)
  if (c.velocityWindowDays !== undefined) {
    const n = Number(c.velocityWindowDays);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      throw { status: 400, message: 'velocityWindowDays must be a number between 1 and 365' };
    }
    out.velocityWindowDays = Math.round(n);
  }

  // velocityWindowByDepartment: Record<string, number>
  if (c.velocityWindowByDepartment !== undefined) {
    if (typeof c.velocityWindowByDepartment !== 'object' || Array.isArray(c.velocityWindowByDepartment)) {
      throw { status: 400, message: 'velocityWindowByDepartment must be an object' };
    }
    const map: Record<string, number> = {};
    for (const [key, val] of Object.entries(c.velocityWindowByDepartment as Record<string, unknown>)) {
      const n = Number(val);
      if (!Number.isFinite(n) || n < 1 || n > 365) {
        throw { status: 400, message: `velocityWindowByDepartment[${key}] must be a number between 1 and 365` };
      }
      map[String(key)] = Math.round(n);
    }
    out.velocityWindowByDepartment = map;
  }

  // unknownStockBehavior: enum
  if (c.unknownStockBehavior !== undefined) {
    if (typeof c.unknownStockBehavior !== 'string' || !VALID_UNKNOWN_STOCK.includes(c.unknownStockBehavior as UnknownStockBehavior)) {
      throw { status: 400, message: `unknownStockBehavior must be one of: ${VALID_UNKNOWN_STOCK.join(', ')}` };
    }
    out.unknownStockBehavior = c.unknownStockBehavior as UnknownStockBehavior;
  }

  // unknownStockDefaultQty: 0 to 99999 (sanity ceiling)
  if (c.unknownStockDefaultQty !== undefined) {
    const n = Number(c.unknownStockDefaultQty);
    if (!Number.isFinite(n) || n < 0 || n > 99999) {
      throw { status: 400, message: 'unknownStockDefaultQty must be a number between 0 and 99999' };
    }
    out.unknownStockDefaultQty = Math.round(n);
  }

  // unknownStockDaysOfCover: 0 to 90 (3 months max — past that estimates are noise)
  if (c.unknownStockDaysOfCover !== undefined) {
    const n = Number(c.unknownStockDaysOfCover);
    if (!Number.isFinite(n) || n < 0 || n > 90) {
      throw { status: 400, message: 'unknownStockDaysOfCover must be a number between 0 and 90' };
    }
    out.unknownStockDaysOfCover = Math.round(n * 100) / 100;  // allow .5 days
  }

  return out;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const dec = (v: unknown): number => Number(v) || 0;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PLATFORM MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET /api/integrations/platforms
 */
export const listPlatforms = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const storeId = req.storeId as string;

    const integrations = await prisma.storeIntegration.findMany({
      where: { orgId, storeId },
      select: { platform: true, status: true, storeName: true, lastSyncAt: true, lastError: true },
    });

    type IntegrationLite = (typeof integrations)[number];
    const connectedMap: Record<string, IntegrationLite> = Object.fromEntries(
      integrations.map((i: IntegrationLite) => [i.platform, i]),
    );

    const platforms = Object.entries(PLATFORMS).map(([key, p]) => ({
      key,
      ...p,
      connected: !!connectedMap[key],
      status: connectedMap[key]?.status || null,
      storeName: connectedMap[key]?.storeName || null,
      lastSyncAt: connectedMap[key]?.lastSyncAt || null,
      lastError: connectedMap[key]?.lastError || null,
    }));

    res.json(platforms);
  } catch (err) { next(err); }
};

interface ConnectBody {
  platform?: string;
  storeId?: string;
  credentials?: PlatformCredentials;
}

/**
 * POST /api/integrations/connect
 */
export const connectPlatform = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const { platform, storeId, credentials } = req.body as ConnectBody;

    if (!platform || !storeId || !credentials) {
      res.status(400).json({ error: 'platform, storeId, and credentials are required' });
      return;
    }

    const adapter = getPlatformAdapter(platform);
    if (!adapter) {
      res.status(400).json({ error: `Unsupported platform: ${platform}` });
      return;
    }

    // Test the connection before saving
    let testResult: Awaited<ReturnType<typeof adapter.testConnection>> | undefined;
    try {
      testResult = await adapter.testConnection(credentials);
    } catch (testErr) {
      const message = testErr instanceof Error ? testErr.message : String(testErr);
      res.status(422).json({
        error: 'Connection test failed',
        detail: message,
      });
      return;
    }

    type TestResultExt = typeof testResult & { defaultConfig?: Record<string, unknown> };
    const ext = testResult as TestResultExt;

    const integration = await prisma.storeIntegration.upsert({
      where: { storeId_platform: { storeId, platform } },
      create: {
        orgId,
        storeId,
        platform,
        credentials: credentials as Prisma.InputJsonValue,
        status: 'active',
        storeName: testResult?.storeName || null,
        config: (ext?.defaultConfig || {}) as Prisma.InputJsonValue,
        inventoryConfig: {} as Prisma.InputJsonValue,
      },
      update: {
        credentials: credentials as Prisma.InputJsonValue,
        status: 'active',
        storeName: testResult?.storeName || null,
        lastError: null,
      },
    });

    await logAudit(req, 'create', 'store_integration', integration.id, {
      platform,
      storeId,
    });

    res.json({ success: true, integration });
  } catch (err) { next(err); }
};

interface DisconnectBody {
  platform?: string;
  storeId?: string;
}

/**
 * DELETE /api/integrations/disconnect
 */
export const disconnectPlatform = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId;
    const { platform, storeId } = req.body as DisconnectBody;

    if (!platform || !storeId) {
      res.status(400).json({ error: 'platform and storeId are required' });
      return;
    }

    const existing = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId, platform } },
    });

    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    await prisma.storeIntegration.delete({
      where: { storeId_platform: { storeId, platform } },
    });

    await logAudit(req, 'delete', 'store_integration', existing.id, {
      platform,
      storeId,
    });

    res.json({ success: true });
  } catch (err) { next(err); }
};

/**
 * GET /api/integrations/settings/:platform
 *
 * Returns the integration's three config blobs. `pricingConfig` is normalized
 * (defaults filled in) so the frontend always sees a complete shape.
 *
 * S71d — When platform === 'storefront' (self-hosted website) and the row
 * doesn't exist yet, auto-create it with empty config. The storefront has no
 * Connect/Disconnect flow because it has no third-party credentials — it's
 * the store's own site, always present once ecom is enabled. The Pricing tab
 * in EcomSetup is the only entry point for managing it.
 */
export const getSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const storeId = req.storeId as string;
    const { platform } = req.params;

    let integration = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId, platform } },
      select: {
        id: true, config: true, inventoryConfig: true, pricingConfig: true,
        status: true, storeName: true,
      },
    });

    // S71d / Option B — lazy init for ANY live platform (storefront or
    // marketplace) so admins can configure pricing BEFORE connecting credentials.
    // Status starts as 'inactive' for marketplaces (only flips to 'active' once
    // connectPlatform succeeds with valid creds); 'storefront' is always active
    // since it has no third-party credentials.
    if (!integration) {
      const meta = PLATFORMS[platform];
      if (meta && meta.status === 'live') {
        const isStorefront = platform === 'storefront';
        const created = await prisma.storeIntegration.create({
          data: {
            orgId, storeId, platform,
            credentials: {} as Prisma.InputJsonValue,
            config: {} as Prisma.InputJsonValue,
            inventoryConfig: {} as Prisma.InputJsonValue,
            pricingConfig: {} as Prisma.InputJsonValue,
            status: isStorefront ? 'active' : 'inactive',
            storeName: isStorefront ? 'Self-hosted storefront' : null,
          },
          select: {
            id: true, config: true, inventoryConfig: true, pricingConfig: true,
            status: true, storeName: true,
          },
        });
        integration = created;
      }
    }

    if (!integration) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    // Normalize pricingConfig so callers see the full shape with defaults
    const pricingConfig = normalizePricingConfig(
      (integration.pricingConfig as unknown as MarketplacePricingConfig) ?? {},
    );

    res.json({ ...integration, pricingConfig });
  } catch (err) { next(err); }
};

interface UpdateSettingsBody {
  config?: Record<string, unknown>;
  inventoryConfig?: Record<string, unknown>;
  pricingConfig?: Record<string, unknown>;
}

/**
 * PUT /api/integrations/settings/:platform
 *
 * Accepts partial updates to any of the three config blobs. `pricingConfig`
 * is validated against `marketplaceMarkup` schema; bad input → 400.
 */
export const updateSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId;
    const storeId = req.storeId as string;
    const { platform } = req.params;
    const { config, inventoryConfig, pricingConfig } = req.body as UpdateSettingsBody;

    const existing = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId, platform } },
    });

    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    const data: Prisma.StoreIntegrationUpdateInput = {};
    if (config !== undefined) data.config = config as Prisma.InputJsonValue;
    if (inventoryConfig !== undefined) data.inventoryConfig = inventoryConfig as Prisma.InputJsonValue;

    // S71 — pricingConfig validation
    if (pricingConfig !== undefined) {
      try {
        const validated = validatePricingConfig(pricingConfig);
        // Merge with existing so partial updates don't wipe other fields
        const existingPricing = (existing.pricingConfig as unknown as MarketplacePricingConfig) ?? {};
        const merged: MarketplacePricingConfig = { ...existingPricing, ...validated };
        data.pricingConfig = merged as Prisma.InputJsonValue;
      } catch (err) {
        const e = err as { status?: number; message?: string };
        res.status(e.status || 400).json({ error: e.message || 'Invalid pricingConfig' });
        return;
      }
    }

    const updated = await prisma.storeIntegration.update({
      where: { storeId_platform: { storeId, platform } },
      data,
    });

    await logAudit(req, 'update', 'store_integration', updated.id, {
      platform,
      fields: Object.keys(data),
    });

    // F32 — when admin saves the storefront's pricingConfig, bust the
    // ecom-backend's in-memory cache so the next sync picks up the change
    // immediately (vs waiting up to 60s TTL). Fire-and-forget — failures
    // don't block the save.
    if (platform === 'storefront' && pricingConfig !== undefined) {
      void invalidateEcomStorefrontCache(storeId).catch((err) => {
        console.warn('[updateSettings] failed to bust ecom cache:', err instanceof Error ? err.message : err);
      });
    }

    // Return with normalized pricingConfig for UI consistency
    const responsePricing = normalizePricingConfig(
      (updated.pricingConfig as unknown as MarketplacePricingConfig) ?? {},
    );
    res.json({ ...updated, pricingConfig: responsePricing });
  } catch (err) { next(err); }
};

/**
 * F32 — POST a cache-invalidation request to ecom-backend so it drops its
 * cached storefront pricingConfig for the given store. Best-effort: if
 * ECOM_BACKEND_URL or INTERNAL_API_KEY isn't configured (e.g. dev without
 * ecom-backend running), we no-op silently.
 */
async function invalidateEcomStorefrontCache(storeId: string): Promise<void> {
  const ecomUrl = process.env.ECOM_BACKEND_URL;
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!ecomUrl || !internalKey) return;
  await fetch(`${ecomUrl.replace(/\/$/, '')}/api/internal/sync/invalidate-pricing`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Api-Key': internalKey,
    },
    body: JSON.stringify({ storeId }),
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INVENTORY SYNC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * POST /api/integrations/sync-inventory
 */
export const syncInventory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId;
    const body = req.body as { platform?: string; storeId?: string };
    const platform = body.platform;
    // S71e fix — accept storeId from body OR from the X-Store-Id header (set
    // by scopeToTenant middleware). The drawer's "Save & Sync Now" button
    // doesn't have storeId in its props; it relies on the header.
    const storeId = body.storeId || (req.storeId as string | undefined);

    if (!platform || !storeId) {
      res.status(400).json({ error: 'platform and storeId are required' });
      return;
    }

    const integration = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId, platform } },
    });

    if (!integration || integration.orgId !== orgId) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    if (integration.status !== 'active') {
      res.status(422).json({ error: 'Integration is not active' });
      return;
    }

    const result = await pushInventory(integration.orgId, integration.storeId, integration.platform);

    // Update lastSyncAt
    await prisma.storeIntegration.update({
      where: { id: integration.id },
      data: { lastSyncAt: new Date(), lastError: null },
    });

    res.json({ success: true, ...result });
  } catch (err) {
    // Record sync error on the integration
    const body = req.body as { platform?: string; storeId?: string } | undefined;
    if (body?.platform && body?.storeId) {
      await prisma.storeIntegration.updateMany({
        where: { storeId: body.storeId, platform: body.platform },
        data: { lastError: err instanceof Error ? err.message : String(err) },
      }).catch(() => { /* non-blocking */ });
    }
    next(err);
  }
};

/**
 * POST /api/integrations/preview-impact
 *
 * Dry-run the pricingConfig pipeline against all of a store's products without
 * actually pushing to the marketplace. Used by the drawer's "Preview impact"
 * button so the user sees exactly what the next sync would do BEFORE saving.
 *
 * Body:
 *   { platform, storeId, pricingConfig? }
 *     pricingConfig is optional — when supplied, the dry-run uses it instead of
 *     the saved config (lets the user preview unsaved edits).
 */
export const previewSyncImpact = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const body = req.body as {
      platform?: string;
      storeId?: string;
      pricingConfig?: unknown;
    };
    const platform = body.platform;
    // S71e fix — accept storeId from body OR from the X-Store-Id header (set
    // by scopeToTenant middleware). The drawer mounted in EcomSetup doesn't
    // know the storeId — it relies on the header set by every API call. Same
    // pattern as the existing getSettings / updateSettings endpoints.
    const storeId = body.storeId || (req.storeId as string | undefined);
    const pricingConfig = body.pricingConfig;

    if (!platform || !storeId) {
      res.status(400).json({ error: 'platform and storeId are required' });
      return;
    }

    const integration = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId, platform } },
    });

    if (!integration || integration.orgId !== orgId) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    // If a pricingConfig override was supplied, validate it before previewing
    let overrideConfig: MarketplacePricingConfig | undefined;
    if (pricingConfig !== undefined) {
      try {
        overrideConfig = validatePricingConfig(pricingConfig);
      } catch (err) {
        const e = err as { status?: number; message?: string };
        res.status(e.status || 400).json({ error: e.message || 'Invalid pricingConfig' });
        return;
      }
    }

    try {
      const result = await previewMarketplaceImpact(orgId, storeId, platform, overrideConfig);
      res.json(result);
    } catch (innerErr) {
      // Surface the real error to the response in dev for debugging
      const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
      console.error('[previewSyncImpact] failure:', msg);
      res.status(500).json({ error: msg });
      return;
    }
  } catch (err) { next(err); }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ORDERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET /api/integrations/orders
 */
export const listOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const storeId = req.storeId;
    const { platform, status, dateFrom, dateTo, limit, skip } = req.query as {
      platform?: string;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
      limit?: string | number;
      skip?: string | number;
    };

    const where: Prisma.PlatformOrderWhereInput = { orgId };
    if (storeId) where.storeId = storeId;
    if (platform) where.platform = platform;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      const range: Prisma.DateTimeFilter = {};
      if (dateFrom) range.gte = new Date(dateFrom);
      if (dateTo) range.lte = new Date(dateTo);
      where.createdAt = range;
    }

    const [orders, total] = await Promise.all([
      prisma.platformOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(parseInt(String(limit)) || 50, 200),
        skip: parseInt(String(skip)) || 0,
      }),
      prisma.platformOrder.count({ where }),
    ]);

    res.json({ orders, total });
  } catch (err) { next(err); }
};

/**
 * GET /api/integrations/orders/:id
 */
export const getOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const { id } = req.params;

    const order = await prisma.platformOrder.findFirst({
      where: { id, orgId },
    });

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    res.json(order);
  } catch (err) { next(err); }
};

/**
 * PUT /api/integrations/orders/:id/confirm
 */
export const confirmOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const { id } = req.params;

    const order = await prisma.platformOrder.findFirst({ where: { id, orgId } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    if (order.status !== 'new') {
      res.status(422).json({ error: `Cannot confirm order in "${order.status}" status` });
      return;
    }

    const integration = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId: order.storeId, platform: order.platform } },
    });

    if (!integration) {
      res.status(422).json({ error: 'No active integration for this platform' });
      return;
    }

    const adapter = getPlatformAdapter(order.platform);
    if (!adapter) { res.status(422).json({ error: `Unsupported platform: ${order.platform}` }); return; }
    await adapter.confirmOrder(integration.credentials as PlatformCredentials, order.platformOrderId);

    const updated = await prisma.platformOrder.update({
      where: { id },
      data: { status: 'confirmed', confirmedAt: new Date() },
    });

    await logAudit(req, 'update', 'platform_order', id, {
      action: 'confirm',
      platform: order.platform,
      platformOrderId: order.platformOrderId,
    });

    res.json(updated);
  } catch (err) { next(err); }
};

/**
 * PUT /api/integrations/orders/:id/ready
 */
export const markReady = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const { id } = req.params;

    const order = await prisma.platformOrder.findFirst({ where: { id, orgId } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    if (!['confirmed', 'preparing'].includes(order.status)) {
      res.status(422).json({ error: `Cannot mark ready from "${order.status}" status` });
      return;
    }

    const integration = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId: order.storeId, platform: order.platform } },
    });

    if (!integration) {
      res.status(422).json({ error: 'No active integration for this platform' });
      return;
    }

    const adapter = getPlatformAdapter(order.platform);
    if (!adapter) { res.status(422).json({ error: `Unsupported platform: ${order.platform}` }); return; }
    await adapter.markReady(integration.credentials as PlatformCredentials, order.platformOrderId);

    const updated = await prisma.platformOrder.update({
      where: { id },
      data: { status: 'ready', readyAt: new Date() },
    });

    await logAudit(req, 'update', 'platform_order', id, {
      action: 'ready',
      platform: order.platform,
      platformOrderId: order.platformOrderId,
    });

    res.json(updated);
  } catch (err) { next(err); }
};

/**
 * PUT /api/integrations/orders/:id/cancel
 */
export const cancelOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const { id } = req.params;
    const { reason } = (req.body || {}) as { reason?: string };

    const order = await prisma.platformOrder.findFirst({ where: { id, orgId } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    if (['cancelled', 'delivered', 'picked_up'].includes(order.status)) {
      res.status(422).json({ error: `Cannot cancel order in "${order.status}" status` });
      return;
    }

    const integration = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId: order.storeId, platform: order.platform } },
    });

    if (!integration) {
      res.status(422).json({ error: 'No active integration for this platform' });
      return;
    }

    const adapter = getPlatformAdapter(order.platform);
    if (!adapter) { res.status(422).json({ error: `Unsupported platform: ${order.platform}` }); return; }
    await adapter.cancelOrder(integration.credentials as PlatformCredentials, order.platformOrderId, reason);

    const updated = await prisma.platformOrder.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason || null },
    });

    await logAudit(req, 'update', 'platform_order', id, {
      action: 'cancel',
      platform: order.platform,
      platformOrderId: order.platformOrderId,
      reason,
    });

    res.json(updated);
  } catch (err) { next(err); }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ANALYTICS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface PlatformAggregate {
  platform: string;
  revenue: number;
  orderCount: number;
  subtotal: number;
  tax: number;
  deliveryFee: number;
  tip: number;
}

interface DayAggregate {
  date: string;
  revenue: number;
  orderCount: number;
}

/**
 * GET /api/integrations/analytics
 */
export const getAnalytics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId as string;
    const storeId = req.storeId;
    const { dateFrom, dateTo, platform } = req.query as {
      dateFrom?: string;
      dateTo?: string;
      platform?: string;
    };

    const where: Prisma.PlatformOrderWhereInput = { orgId };
    if (storeId) where.storeId = storeId;
    if (platform) where.platform = platform;
    // Exclude cancelled/failed from revenue analytics
    where.status = { notIn: ['cancelled', 'failed'] };

    if (dateFrom || dateTo) {
      const range: Prisma.DateTimeFilter = {};
      if (dateFrom) range.gte = new Date(dateFrom);
      if (dateTo) range.lte = new Date(dateTo);
      where.createdAt = range;
    }

    const orders = await prisma.platformOrder.findMany({
      where,
      select: {
        platform: true,
        grandTotal: true,
        subtotal: true,
        tax: true,
        deliveryFee: true,
        tip: true,
        createdAt: true,
      },
    });

    // S71 — load pricingConfig snapshot per active platform so the analytics
    // tab can show what markup/rounding/exclusions are currently in effect
    // alongside revenue.
    const integrationsForSnapshot = storeId
      ? await prisma.storeIntegration.findMany({
          where: { orgId, storeId },
          select: { platform: true, pricingConfig: true, lastSyncAt: true, status: true },
        })
      : [];
    const pricingByPlatform: Record<string, {
      markupPercent:        number;
      roundingMode:         string;
      categoryOverrideCount: number;
      excludedDepartmentCount: number;
      excludedProductCount:    number;
      inventorySyncEnabled: boolean;
      syncMode:             string;
      minMarginPercent:     number;
      lastSyncAt:           Date | null;
      status:               string;
    }> = {};
    for (const itg of integrationsForSnapshot) {
      const pc = normalizePricingConfig(
        (itg.pricingConfig as unknown as MarketplacePricingConfig) ?? {},
      );
      pricingByPlatform[itg.platform] = {
        markupPercent:           pc.markupPercent,
        roundingMode:            pc.roundingMode,
        categoryOverrideCount:   Object.keys(pc.categoryMarkups || {}).filter(
          (k) => pc.categoryMarkups[k] !== 0,
        ).length,
        excludedDepartmentCount: pc.excludedDepartmentIds.length,
        excludedProductCount:    pc.excludedProductIds.length,
        inventorySyncEnabled:    pc.inventorySyncEnabled,
        syncMode:                pc.syncMode,
        minMarginPercent:        pc.minMarginPercent,
        lastSyncAt:              itg.lastSyncAt,
        status:                  itg.status,
      };
    }

    type OrderRow = (typeof orders)[number];

    // Per-platform aggregation
    const byPlatform: Record<string, PlatformAggregate> = {};
    const byDay: Record<string, DayAggregate> = {};

    for (const o of orders as OrderRow[]) {
      const total = dec(o.grandTotal);
      const day = o.createdAt.toISOString().slice(0, 10);

      // Platform aggregate
      if (!byPlatform[o.platform]) {
        byPlatform[o.platform] = { platform: o.platform, revenue: 0, orderCount: 0, subtotal: 0, tax: 0, deliveryFee: 0, tip: 0 };
      }
      const p = byPlatform[o.platform];
      p.revenue += total;
      p.orderCount += 1;
      p.subtotal += dec(o.subtotal);
      p.tax += dec(o.tax);
      p.deliveryFee += dec(o.deliveryFee);
      p.tip += dec(o.tip);

      // Daily aggregate
      if (!byDay[day]) {
        byDay[day] = { date: day, revenue: 0, orderCount: 0 };
      }
      byDay[day].revenue += total;
      byDay[day].orderCount += 1;
    }

    // Compute averages and round
    const platformSummary = Object.values(byPlatform).map((p: PlatformAggregate) => ({
      ...p,
      revenue: Math.round(p.revenue * 100) / 100,
      subtotal: Math.round(p.subtotal * 100) / 100,
      tax: Math.round(p.tax * 100) / 100,
      deliveryFee: Math.round(p.deliveryFee * 100) / 100,
      tip: Math.round(p.tip * 100) / 100,
      avgOrderValue: p.orderCount > 0 ? Math.round((p.revenue / p.orderCount) * 100) / 100 : 0,
    }));

    const dailyBreakdown = Object.values(byDay)
      .sort((a: DayAggregate, b: DayAggregate) => a.date.localeCompare(b.date))
      .map((d: DayAggregate) => ({
        ...d,
        revenue: Math.round(d.revenue * 100) / 100,
      }));

    type PlatformSummaryRow = (typeof platformSummary)[number];
    const totals = {
      revenue: platformSummary.reduce((s: number, p: PlatformSummaryRow) => s + p.revenue, 0),
      orderCount: platformSummary.reduce((s: number, p: PlatformSummaryRow) => s + p.orderCount, 0),
      avgOrderValue: 0,
    };
    totals.avgOrderValue = totals.orderCount > 0
      ? Math.round((totals.revenue / totals.orderCount) * 100) / 100
      : 0;

    res.json({
      totals,
      byPlatform: platformSummary,
      dailyBreakdown,
      pricingByPlatform,  // S71 — current pricingConfig snapshot per platform
    });
  } catch (err) { next(err); }
};
