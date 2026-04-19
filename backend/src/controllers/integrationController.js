/**
 * Integration Controller — Platform integration management endpoints
 *
 * Handles connecting/disconnecting delivery platforms (DoorDash, UberEats, etc.),
 * inventory sync, order management, and analytics for all platform orders.
 */

import prisma from '../config/postgres.js';
import { getPlatformAdapter, PLATFORMS } from '../services/platforms/index.js';
import { pushInventory } from '../services/inventorySyncService.js';
import { logAudit } from '../services/auditService.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const dec = (v) => Number(v) || 0;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PLATFORM MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET /api/integrations/platforms
 * Returns the list of all known platforms, each annotated with its connection
 * status for the current store.
 */
export const listPlatforms = async (req, res, next) => {
  try {
    const { orgId, storeId } = req;

    const integrations = await prisma.storeIntegration.findMany({
      where: { orgId, storeId },
      select: { platform: true, status: true, storeName: true, lastSyncAt: true, lastError: true },
    });

    const connectedMap = Object.fromEntries(
      integrations.map((i) => [i.platform, i]),
    );

    // PLATFORMS is an object keyed by platform slug (doordash/ubereats/etc.)
    // — convert to array with the slug attached as `key` for the frontend.
    // Previously called `.map()` directly on the object which threw
    // `TypeError: PLATFORMS.map is not a function` on every Integrations
    // page load.
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

/**
 * POST /api/integrations/connect
 * Body: { platform, storeId, credentials }
 * Tests the connection via the platform adapter, then upserts StoreIntegration.
 */
export const connectPlatform = async (req, res, next) => {
  try {
    const { orgId } = req;
    const { platform, storeId, credentials } = req.body;

    if (!platform || !storeId || !credentials) {
      return res.status(400).json({ error: 'platform, storeId, and credentials are required' });
    }

    const adapter = getPlatformAdapter(platform);
    if (!adapter) {
      return res.status(400).json({ error: `Unsupported platform: ${platform}` });
    }

    // Test the connection before saving
    let testResult;
    try {
      testResult = await adapter.testConnection(credentials);
    } catch (testErr) {
      return res.status(422).json({
        error: 'Connection test failed',
        detail: testErr.message,
      });
    }

    const integration = await prisma.storeIntegration.upsert({
      where: { storeId_platform: { storeId, platform } },
      create: {
        orgId,
        storeId,
        platform,
        credentials,
        status: 'active',
        storeName: testResult?.storeName || null,
        config: testResult?.defaultConfig || {},
        inventoryConfig: {},
      },
      update: {
        credentials,
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

/**
 * DELETE /api/integrations/disconnect
 * Body: { platform, storeId }
 */
export const disconnectPlatform = async (req, res, next) => {
  try {
    const { orgId } = req;
    const { platform, storeId } = req.body;

    if (!platform || !storeId) {
      return res.status(400).json({ error: 'platform and storeId are required' });
    }

    const existing = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId, platform } },
    });

    if (!existing || existing.orgId !== orgId) {
      return res.status(404).json({ error: 'Integration not found' });
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
 * Returns inventoryConfig and config for a platform+store.
 */
export const getSettings = async (req, res, next) => {
  try {
    const { orgId, storeId } = req;
    const { platform } = req.params;

    const integration = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId, platform } },
      select: { id: true, config: true, inventoryConfig: true, status: true, storeName: true },
    });

    if (!integration) {
      return res.status(404).json({ error: 'Integration not found' });
    }

    res.json(integration);
  } catch (err) { next(err); }
};

/**
 * PUT /api/integrations/settings/:platform
 * Body: { config?, inventoryConfig? }
 */
export const updateSettings = async (req, res, next) => {
  try {
    const { orgId, storeId } = req;
    const { platform } = req.params;
    const { config, inventoryConfig } = req.body;

    const existing = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId, platform } },
    });

    if (!existing || existing.orgId !== orgId) {
      return res.status(404).json({ error: 'Integration not found' });
    }

    const data = {};
    if (config !== undefined) data.config = config;
    if (inventoryConfig !== undefined) data.inventoryConfig = inventoryConfig;

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
 * Body: { platform, storeId }
 * Triggers an immediate inventory push for a given platform+store.
 */
export const syncInventory = async (req, res, next) => {
  try {
    const { orgId } = req;
    const { platform, storeId } = req.body;

    if (!platform || !storeId) {
      return res.status(400).json({ error: 'platform and storeId are required' });
    }

    const integration = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId, platform } },
    });

    if (!integration || integration.orgId !== orgId) {
      return res.status(404).json({ error: 'Integration not found' });
    }

    if (integration.status !== 'active') {
      return res.status(422).json({ error: 'Integration is not active' });
    }

    const result = await pushInventory(integration);

    // Update lastSyncAt
    await prisma.storeIntegration.update({
      where: { id: integration.id },
      data: { lastSyncAt: new Date(), lastError: null },
    });

    res.json({ success: true, ...result });
  } catch (err) {
    // Record sync error on the integration
    if (req.body?.platform && req.body?.storeId) {
      await prisma.storeIntegration.updateMany({
        where: { storeId: req.body.storeId, platform: req.body.platform },
        data: { lastError: err.message },
      }).catch(() => {});
    }
    next(err);
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ORDERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET /api/integrations/orders
 * Query: platform?, status?, dateFrom?, dateTo?, limit?, skip?
 */
export const listOrders = async (req, res, next) => {
  try {
    const { orgId, storeId } = req;
    const { platform, status, dateFrom, dateTo, limit, skip } = req.query;

    const where = { orgId };
    if (storeId) where.storeId = storeId;
    if (platform) where.platform = platform;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [orders, total] = await Promise.all([
      prisma.platformOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(parseInt(limit) || 50, 200),
        skip: parseInt(skip) || 0,
      }),
      prisma.platformOrder.count({ where }),
    ]);

    res.json({ orders, total });
  } catch (err) { next(err); }
};

/**
 * GET /api/integrations/orders/:id
 */
export const getOrder = async (req, res, next) => {
  try {
    const { orgId } = req;
    const { id } = req.params;

    const order = await prisma.platformOrder.findFirst({
      where: { id, orgId },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (err) { next(err); }
};

/**
 * PUT /api/integrations/orders/:id/confirm
 * Confirms an order via the platform adapter and updates the local record.
 */
export const confirmOrder = async (req, res, next) => {
  try {
    const { orgId } = req;
    const { id } = req.params;

    const order = await prisma.platformOrder.findFirst({ where: { id, orgId } });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.status !== 'new') {
      return res.status(422).json({ error: `Cannot confirm order in "${order.status}" status` });
    }

    const integration = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId: order.storeId, platform: order.platform } },
    });

    if (!integration) {
      return res.status(422).json({ error: 'No active integration for this platform' });
    }

    const adapter = getPlatformAdapter(order.platform);
    await adapter.confirmOrder(integration.credentials, order.platformOrderId);

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
 * Marks an order ready for pickup via the platform adapter.
 */
export const markReady = async (req, res, next) => {
  try {
    const { orgId } = req;
    const { id } = req.params;

    const order = await prisma.platformOrder.findFirst({ where: { id, orgId } });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (!['confirmed', 'preparing'].includes(order.status)) {
      return res.status(422).json({ error: `Cannot mark ready from "${order.status}" status` });
    }

    const integration = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId: order.storeId, platform: order.platform } },
    });

    if (!integration) {
      return res.status(422).json({ error: 'No active integration for this platform' });
    }

    const adapter = getPlatformAdapter(order.platform);
    await adapter.markReady(integration.credentials, order.platformOrderId);

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
 * Body: { reason? }
 * Cancels an order via the platform adapter.
 */
export const cancelOrder = async (req, res, next) => {
  try {
    const { orgId } = req;
    const { id } = req.params;
    const { reason } = req.body || {};

    const order = await prisma.platformOrder.findFirst({ where: { id, orgId } });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (['cancelled', 'delivered', 'picked_up'].includes(order.status)) {
      return res.status(422).json({ error: `Cannot cancel order in "${order.status}" status` });
    }

    const integration = await prisma.storeIntegration.findUnique({
      where: { storeId_platform: { storeId: order.storeId, platform: order.platform } },
    });

    if (!integration) {
      return res.status(422).json({ error: 'No active integration for this platform' });
    }

    const adapter = getPlatformAdapter(order.platform);
    await adapter.cancelOrder(integration.credentials, order.platformOrderId, reason);

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

/**
 * GET /api/integrations/analytics
 * Query: dateFrom?, dateTo?, platform?
 * Returns aggregated analytics: total revenue, order count, avg order value per
 * platform plus a daily breakdown.
 */
export const getAnalytics = async (req, res, next) => {
  try {
    const { orgId, storeId } = req;
    const { dateFrom, dateTo, platform } = req.query;

    const where = { orgId };
    if (storeId) where.storeId = storeId;
    if (platform) where.platform = platform;
    // Exclude cancelled/failed from revenue analytics
    where.status = { notIn: ['cancelled', 'failed'] };

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
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

    // Per-platform aggregation
    const byPlatform = {};
    const byDay = {};

    for (const o of orders) {
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
    const platformSummary = Object.values(byPlatform).map((p) => ({
      ...p,
      revenue: Math.round(p.revenue * 100) / 100,
      subtotal: Math.round(p.subtotal * 100) / 100,
      tax: Math.round(p.tax * 100) / 100,
      deliveryFee: Math.round(p.deliveryFee * 100) / 100,
      tip: Math.round(p.tip * 100) / 100,
      avgOrderValue: p.orderCount > 0 ? Math.round((p.revenue / p.orderCount) * 100) / 100 : 0,
    }));

    const dailyBreakdown = Object.values(byDay)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        ...d,
        revenue: Math.round(d.revenue * 100) / 100,
      }));

    const totals = {
      revenue: platformSummary.reduce((s, p) => s + p.revenue, 0),
      orderCount: platformSummary.reduce((s, p) => s + p.orderCount, 0),
    };
    totals.avgOrderValue = totals.orderCount > 0
      ? Math.round((totals.revenue / totals.orderCount) * 100) / 100
      : 0;

    res.json({ totals, byPlatform: platformSummary, dailyBreakdown });
  } catch (err) { next(err); }
};
