/**
 * Webhook Routes — /webhook
 *
 * PUBLIC routes — NO authentication middleware.
 * Called by external platforms (DoorDash, UberEats, Instacart) to push
 * order and status updates into the system.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import prisma from '../config/postgres.js';
import { getPlatformAdapter } from '../services/platforms/index.js';
import { errMsg } from '../utils/typeHelpers.js';

const router = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

const dec = (v: unknown): number => Number(v) || 0;

/**
 * Simple rate-limit guard — tracks recent webhook calls per IP.
 * Prevents runaway retry storms from hammering the database.
 */
interface RateLimitEntry { windowStart: number; count: number }
const webhookHits = new Map<string, RateLimitEntry>();
const WEBHOOK_WINDOW_MS = 60_000;
const WEBHOOK_MAX_PER_WINDOW = 120;

function webhookRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip || 'unknown';
  const now = Date.now();

  let entry = webhookHits.get(key);
  if (!entry || now - entry.windowStart > WEBHOOK_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    webhookHits.set(key, entry);
  }
  entry.count += 1;

  if (entry.count > WEBHOOK_MAX_PER_WINDOW) {
    res.status(429).json({ error: 'Too many webhook requests' });
    return;
  }
  next();
}

router.use(webhookRateLimit);

// Periodic cleanup of the rate-limit map (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of webhookHits) {
    if (now - entry.windowStart > WEBHOOK_WINDOW_MS * 2) webhookHits.delete(key);
  }
}, 5 * 60_000);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DOORDASH WEBHOOKS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * POST /webhook/doordash/order
 * Receives a new order from DoorDash.
 *
 * Expected payload shape (DoorDash Drive / Marketplace):
 *   { store_location_id, order_id, short_code, fulfillment_type,
 *     items: [{ name, quantity, price, merchant_supplied_id, special_instructions }],
 *     customer: { first_name, last_name, phone },
 *     subtotal, tax, delivery_fee, tip, order_total,
 *     estimated_pickup_time, ... }
 */
router.post('/doordash/order', async (req, res) => {
  try {
    const payload = req.body;
    const storeLocationId = payload.store_location_id;

    if (!storeLocationId) {
      return res.status(400).json({ error: 'Missing store_location_id' });
    }

    // Find the matching integration by storeLocationId in credentials JSON
    const integrations = await prisma.storeIntegration.findMany({
      where: { platform: 'doordash', status: 'active' },
    });

    const integration = integrations.find((i: { credentials: unknown }) => {
      const creds = i.credentials as { storeLocationId?: string } | null;
      return creds && creds.storeLocationId === storeLocationId;
    });

    if (!integration) {
      console.warn(`[webhook/doordash] No integration found for storeLocationId: ${storeLocationId}`);
      return res.status(404).json({ error: 'No matching integration' });
    }

    // Build items array
    interface DoordashItem {
      name?: string;
      quantity?: number;
      price?: number | string;
      merchant_supplied_id?: string | null;
      special_instructions?: string | null;
    }
    const items = ((payload.items || []) as DoordashItem[]).map((item) => ({
      name: item.name,
      qty: item.quantity || 1,
      price: dec(item.price),
      merchantItemId: item.merchant_supplied_id || null,
      specialInstructions: item.special_instructions || null,
    }));

    // Build customer name
    const customerName = [payload.customer?.first_name, payload.customer?.last_name]
      .filter(Boolean)
      .join(' ') || null;

    // Create the PlatformOrder record
    const order = await prisma.platformOrder.create({
      data: {
        orgId: integration.orgId,
        storeId: integration.storeId,
        platform: 'doordash',
        platformOrderId: String(payload.order_id),
        shortCode: payload.short_code || null,
        status: 'new',
        fulfillmentType: payload.fulfillment_type || 'delivery',
        items,
        customerName,
        customerPhone: payload.customer?.phone || null,
        subtotal: dec(payload.subtotal),
        tax: dec(payload.tax),
        deliveryFee: dec(payload.delivery_fee),
        tip: dec(payload.tip),
        grandTotal: dec(payload.order_total),
        estimatedPickup: payload.estimated_pickup_time
          ? new Date(payload.estimated_pickup_time)
          : null,
        webhookData: payload,
        notes: payload.special_instructions || null,
      },
    });

    // Auto-confirm if the integration config says so
    const config = (integration.config as { autoConfirm?: boolean } | null) || {};
    if (config.autoConfirm) {
      try {
        const adapter = getPlatformAdapter('doordash');
        if (adapter) {
          await adapter.confirmOrder(integration.credentials, String(payload.order_id));
          await prisma.platformOrder.update({
            where: { id: order.id },
            data: { status: 'confirmed', confirmedAt: new Date() },
          });
        }
      } catch (confirmErr) {
        console.error(`[webhook/doordash] Auto-confirm failed for order ${order.id}:`, errMsg(confirmErr));
        // Order stays as "new" — merchant will need to confirm manually
      }
    }

    res.status(200).json({ received: true, orderId: order.id });
  } catch (err) {
    console.error('[webhook/doordash/order] Error:', err);
    // Always return 200 to prevent DoorDash from retrying on our app errors
    // (log the error for internal investigation)
    res.status(200).json({ received: true, error: 'internal' });
  }
});

/**
 * POST /webhook/doordash/status
 * Receives dasher status updates from DoorDash.
 *
 * Expected payload:
 *   { order_id, dasher_status: "DASHER_CONFIRMED"|"ARRIVED"|"PICKED_UP"|"DROPPED_OFF" }
 */
router.post('/doordash/status', async (req, res) => {
  try {
    const { order_id, dasher_status } = req.body;

    if (!order_id || !dasher_status) {
      return res.status(400).json({ error: 'Missing order_id or dasher_status' });
    }

    const order = await prisma.platformOrder.findFirst({
      where: { platform: 'doordash', platformOrderId: String(order_id) },
    });

    if (!order) {
      console.warn(`[webhook/doordash/status] Order not found: ${order_id}`);
      return res.status(200).json({ received: true });
    }

    const updateData: Record<string, unknown> = { dasherStatus: dasher_status };

    // Also update lifecycle timestamps based on dasher status
    if (dasher_status === 'PICKED_UP' && !order.pickedUpAt) {
      updateData.status = 'picked_up';
      updateData.pickedUpAt = new Date();
    } else if (dasher_status === 'DROPPED_OFF' && !order.deliveredAt) {
      updateData.status = 'delivered';
      updateData.deliveredAt = new Date();
    }

    await prisma.platformOrder.update({
      where: { id: order.id },
      data: updateData,
    });

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook/doordash/status] Error:', err);
    res.status(200).json({ received: true, error: 'internal' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  UBEREATS WEBHOOKS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * POST /webhook/ubereats/order
 * Uber Eats order notification: orders.notification event
 * Verify: X-Uber-Signature = HMAC-SHA256(body, clientSecret)
 * Must respond 200. Then accept/deny within 11.5 min SLA.
 */
router.post('/ubereats/order', async (req, res) => {
  try {
    const payload = req.body;
    const eventType = payload.event_type;
    const resourceId = payload.meta?.resource_id;
    const ubStoreId = payload.meta?.user_id;

    console.log(`[webhook/ubereats] event=${eventType} order=${resourceId} store=${ubStoreId}`);

    if (eventType !== 'orders.notification' || !resourceId) {
      return res.status(200).json({ received: true, skipped: true });
    }

    // Find integration
    const integration = await prisma.storeIntegration.findFirst({
      where: { platform: 'ubereats', status: 'active' },
    });
    if (!integration) return res.status(200).json({ received: true, no_integration: true });

    // Verify signature
    const sigRaw = req.headers['x-uber-signature'];
    const sig = Array.isArray(sigRaw) ? sigRaw[0] : sigRaw;
    const creds = integration.credentials as { clientSecret?: string } | null;
    if (sig && creds?.clientSecret) {
      const { verifyWebhookSignature } = await import('../services/platforms/ubereats.js');
      if (!verifyWebhookSignature(JSON.stringify(req.body), sig, creds.clientSecret)) {
        console.warn('[webhook/ubereats] Signature mismatch');
        return res.status(200).json({ received: true });
      }
    }

    // Fetch full order details
    const ubereats = (await import('../services/platforms/ubereats.js')).default;
    interface UberEatsItem {
      title?: string; name?: string;
      quantity?: number;
      price?: number | string | { unit_price?: { amount_e5?: number } };
      external_data?: string | null;
      id?: string | null;
      special_instructions?: string | null;
    }
    interface UberEatsOrder {
      cart?: { items?: UberEatsItem[] };
      items?: UberEatsItem[];
      payment?: { charges?: { total?: { amount_e5?: number } } };
      eater?: { first_name?: string; phone?: { number?: string } };
      type?: string;
      display_id?: string;
      estimated_ready_for_pickup_at?: string | Date;
    }
    const { order } = (await ubereats.getOrder(creds as never, resourceId)) as { order: UberEatsOrder | null | undefined };

    const items = ((order?.cart?.items || order?.items || []) as UberEatsItem[]).map((i) => {
      const priceRaw = i.price;
      const priceNum = (typeof priceRaw === 'object' && priceRaw && 'unit_price' in priceRaw && priceRaw.unit_price?.amount_e5)
        ? priceRaw.unit_price.amount_e5 / 100000
        : (typeof priceRaw === 'object' ? 0 : Number(priceRaw) || 0);
      return {
        name: i.title || i.name || 'Item',
        qty: i.quantity || 1,
        price: priceNum,
        merchantItemId: i.external_data || i.id || null,
        specialInstructions: i.special_instructions || null,
      };
    });

    const grandTotal = order?.payment?.charges?.total?.amount_e5
      ? order.payment.charges.total.amount_e5 / 100000
      : items.reduce((s, i) => s + (i.price * i.qty), 0);

    await prisma.platformOrder.upsert({
      where: { platform_platformOrderId: { platform: 'ubereats', platformOrderId: resourceId } },
      update: { status: 'new', webhookData: payload, updatedAt: new Date() },
      create: {
        orgId: integration.orgId, storeId: integration.storeId,
        platform: 'ubereats', platformOrderId: resourceId,
        shortCode: order?.display_id || resourceId.slice(-6),
        status: 'new',
        fulfillmentType: order?.type === 'PICK_UP' ? 'pickup' : 'delivery',
        items, customerName: order?.eater?.first_name || 'Customer',
        customerPhone: order?.eater?.phone?.number || null,
        subtotal: grandTotal, grandTotal,
        estimatedPickup: order?.estimated_ready_for_pickup_at ? new Date(order.estimated_ready_for_pickup_at) : null,
        webhookData: payload,
      },
    });

    // Auto-confirm if enabled
    const ueConfig = integration.config as { autoConfirm?: boolean } | null;
    if (ueConfig?.autoConfirm) {
      ubereats.confirmOrder(creds as never, resourceId, { reason: 'Auto-accepted' })
        .then(() => prisma.platformOrder.updateMany({ where: { platform: 'ubereats', platformOrderId: resourceId }, data: { status: 'confirmed', confirmedAt: new Date() } }))
        .catch((e: unknown) => console.warn('[webhook/ubereats] Auto-confirm failed:', errMsg(e)));
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook/ubereats] Error:', errMsg(err));
    res.status(200).json({ received: true });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INSTACART WEBHOOKS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * POST /webhook/instacart/order
 * Instacart Connect event callbacks (31+ event types)
 * Key events: fulfillment.brand_new, .acknowledged, .picking, .delivering, .delivered, .canceled
 */
router.post('/instacart/order', async (req, res) => {
  try {
    const payload = req.body;
    const eventName = payload.event_name;
    const orderId = payload.order_id || payload.event_metadata?.order_id;

    console.log(`[webhook/instacart] event=${eventName} order=${orderId}`);

    if (!orderId) return res.status(200).json({ received: true, skipped: true });

    const integration = await prisma.storeIntegration.findFirst({
      where: { platform: 'instacart', status: 'active' },
    });
    if (!integration) return res.status(200).json({ received: true, no_integration: true });

    const eventMap: Record<string, string> = {
      'fulfillment.brand_new':    'new',
      'fulfillment.acknowledged': 'confirmed',
      'fulfillment.picking':      'preparing',
      'fulfillment.checkout':     'preparing',
      'fulfillment.delivering':   'picked_up',
      'fulfillment.delivered':    'delivered',
      'fulfillment.canceled':     'cancelled',
    };

    const status = eventMap[eventName] || null;
    if (!status) return res.status(200).json({ received: true, unmapped_event: eventName });

    if (eventName === 'fulfillment.brand_new') {
      // New order — create PlatformOrder
      interface InstacartItem {
        item_name?: string; name?: string;
        qty?: number; quantity?: number;
        unit_price?: number | string; price?: number | string;
        item_code?: string | null; lookup_code?: string | null;
      }
      const items = ((payload.order_items || payload.event_metadata?.items || []) as InstacartItem[]).map((i) => ({
        name: i.item_name || i.name || 'Item',
        qty: i.qty || i.quantity || 1,
        price: Number(i.unit_price || i.price || 0),
        merchantItemId: i.item_code || i.lookup_code || null,
      }));

      const total = items.reduce((s, i) => s + (i.price * i.qty), 0);

      await prisma.platformOrder.upsert({
        where: { platform_platformOrderId: { platform: 'instacart', platformOrderId: String(orderId) } },
        update: { status: 'new', webhookData: payload, updatedAt: new Date() },
        create: {
          orgId: integration.orgId, storeId: integration.storeId,
          platform: 'instacart', platformOrderId: String(orderId),
          shortCode: String(orderId).slice(-6),
          status: 'new', fulfillmentType: payload.fulfillment_type || 'delivery',
          items, customerName: payload.customer_name || 'Customer',
          subtotal: total, grandTotal: total,
          webhookData: payload,
        },
      });
    } else {
      // Status update — update existing order
      const data: Record<string, unknown> = { status, updatedAt: new Date() };
      if (status === 'confirmed') data.confirmedAt = new Date();
      if (status === 'picked_up') data.pickedUpAt = new Date();
      if (status === 'delivered') data.deliveredAt = new Date();
      if (status === 'cancelled') {
        data.cancelledAt = new Date();
        data.cancelReason = payload.cancellation_reason || payload.event_metadata?.cancellation_reason || null;
      }

      await prisma.platformOrder.updateMany({
        where: { platform: 'instacart', platformOrderId: String(orderId) },
        data,
      });
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook/instacart] Error:', errMsg(err));
    res.status(200).json({ received: true });
  }
});

export default router;
