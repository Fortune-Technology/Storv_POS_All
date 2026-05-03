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
import { pushInventory } from '../services/inventorySyncService.js';
import { logAudit } from '../services/auditService.js';

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
 */
export const getSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.storeId as string;
    const { platform } = req.params;

    const integration = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId, platform } },
      select: { id: true, config: true, inventoryConfig: true, status: true, storeName: true },
    });

    if (!integration) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    res.json(integration);
  } catch (err) { next(err); }
};

interface UpdateSettingsBody {
  config?: Record<string, unknown>;
  inventoryConfig?: Record<string, unknown>;
}

/**
 * PUT /api/integrations/settings/:platform
 */
export const updateSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId;
    const storeId = req.storeId as string;
    const { platform } = req.params;
    const { config, inventoryConfig } = req.body as UpdateSettingsBody;

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

    const updated = await prisma.storeIntegration.update({
      where: { storeId_platform: { storeId, platform } },
      data,
    });

    await logAudit(req, 'update', 'store_integration', updated.id, {
      platform,
      fields: Object.keys(data),
    });

    res.json(updated);
  } catch (err) { next(err); }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INVENTORY SYNC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * POST /api/integrations/sync-inventory
 */
export const syncInventory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orgId = req.orgId;
    const { platform, storeId } = req.body as { platform?: string; storeId?: string };

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

    res.json({ totals, byPlatform: platformSummary, dailyBreakdown });
  } catch (err) { next(err); }
};
