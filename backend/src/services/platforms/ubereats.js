/**
 * Uber Eats Platform Adapter — Full Implementation
 *
 * Auth: OAuth 2.0 Client Credentials (30-day tokens)
 * Base URL: https://api.uber.com
 * Scopes: eats.store, eats.order, eats.store.orders.read, eats.store.status.write
 *
 * Required credentials: { clientId, clientSecret, storeId }
 * Token auto-cached in credentials object (accessToken + tokenExpiresAt)
 *
 * Order flow:
 *   1. Webhook: orders.notification → get order details → create PlatformOrder
 *   2. Accept: POST /v1/eats/orders/{id}/accept_pos_order (within 11.5 min SLA)
 *   3. Ready:  POST /v1/eats/orders/{id}/restaurantdelivery/status {status:"ready"}
 *   4. Or deny: POST /v1/eats/orders/{id}/deny_pos_order
 *
 * Webhook verification: HMAC-SHA256 of body with clientSecret → compare X-Uber-Signature
 */

import axios from 'axios';
import crypto from 'crypto';

const BASE_URL = 'https://api.uber.com';
const TOKEN_URL = 'https://auth.uber.com/oauth/v2/token';
const SCOPES = 'eats.store eats.order eats.store.orders.read eats.store.status.write eats.report';

// ── Token Management ─────────────────────────────────────────────────────────

async function getAccessToken(credentials) {
  // Use cached token if still valid (1hr buffer)
  if (credentials.accessToken && credentials.tokenExpiresAt) {
    const expiresAt = new Date(credentials.tokenExpiresAt).getTime();
    if (Date.now() < expiresAt - 3600000) return credentials.accessToken;
  }

  const params = new URLSearchParams();
  params.append('client_id', credentials.clientId);
  params.append('client_secret', credentials.clientSecret);
  params.append('grant_type', 'client_credentials');
  params.append('scope', SCOPES);

  const resp = await axios.post(TOKEN_URL, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });

  credentials.accessToken = resp.data.access_token;
  credentials.tokenExpiresAt = new Date(Date.now() + (resp.data.expires_in || 2592000) * 1000).toISOString();
  return credentials.accessToken;
}

// ── API Call Helper ──────────────────────────────────────────────────────────

async function callAPI(method, path, credentials, body = null) {
  const token = await getAccessToken(credentials);
  const config = {
    method, url: `${BASE_URL}${path}`,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 15000,
  };
  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) config.data = body;
  return (await axios(config)).data;
}

// ── Webhook Signature Verification ───────────────────────────────────────────

export function verifyWebhookSignature(body, signature, clientSecret) {
  const computed = crypto.createHmac('sha256', clientSecret)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');
  return computed === signature;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADAPTER
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  // ── Test connection ────────────────────────────────────────────────────────
  testConnection: async (credentials) => {
    try {
      if (!credentials.clientId || !credentials.clientSecret || !credentials.storeId)
        return { ok: false, error: 'Client ID, Client Secret, and Store ID are required' };
      const data = await callAPI('GET', `/v1/eats/stores/${credentials.storeId}`, credentials);
      return { ok: true, storeName: data.name || data.store_name || credentials.storeId };
    } catch (err) {
      return { ok: false, error: err.response?.data?.message || err.message };
    }
  },

  // ── Sync inventory (update menu items) ─────────────────────────────────────
  syncInventory: async (credentials, items) => {
    if (!items?.length) return { synced: 0, failed: 0, errors: [] };
    let synced = 0, failed = 0;
    const errors = [];

    for (const item of items) {
      try {
        const payload = { enabled: item.status === 'AVAILABLE' };
        if (item.base_price != null) payload.price_info = { price: item.base_price };
        if (item.status === 'OUT_OF_STOCK') {
          payload.suspension_info = { suspension: { suspend_until: 9999999999, reason: 'OUT_OF_STOCK' } };
        }
        await callAPI('POST', `/v1/eats/stores/${credentials.storeId}/menus/items/${item.merchant_supplied_id}`, credentials, payload);
        synced++;
      } catch (err) {
        failed++;
        errors.push({ itemId: item.merchant_supplied_id, error: err.response?.data?.message || err.message });
      }
    }
    return { synced, failed, errors };
  },

  // ── Accept order (SLA: 11.5 minutes) ───────────────────────────────────────
  confirmOrder: async (credentials, orderId, data = {}) => {
    try {
      await callAPI('POST', `/v1/eats/orders/${orderId}/accept_pos_order`, credentials, {
        reason: data.reason || 'Accepted via StoreVue POS',
        ...(data.pickupTime ? { pickup_time: Math.floor(new Date(data.pickupTime).getTime() / 1000) } : {}),
      });
      return { confirmed: true };
    } catch (err) {
      return { confirmed: false, error: err.response?.data?.message || err.message };
    }
  },

  // ── Mark order ready ───────────────────────────────────────────────────────
  markReady: async (credentials, orderId) => {
    try {
      await callAPI('POST', `/v1/eats/orders/${orderId}/restaurantdelivery/status`, credentials, { status: 'ready' });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.response?.data?.message || err.message };
    }
  },

  // ── Deny or cancel order ───────────────────────────────────────────────────
  cancelOrder: async (credentials, orderId, reason = 'Store cancelled') => {
    try {
      // Try deny (new orders) → then cancel (accepted orders)
      try {
        await callAPI('POST', `/v1/eats/orders/${orderId}/deny_pos_order`, credentials, {
          reason: { explanation: reason },
        });
        return { cancelled: true };
      } catch {
        await callAPI('POST', `/v1/eats/orders/${orderId}/cancel`, credentials, {
          reason, cancelling_party: 'MERCHANT',
        });
        return { cancelled: true };
      }
    } catch (err) {
      return { cancelled: false, error: err.response?.data?.message || err.message };
    }
  },

  // ── Get menu ───────────────────────────────────────────────────────────────
  getMenu: async (credentials) => {
    try {
      const data = await callAPI('GET', `/v1/eats/stores/${credentials.storeId}/menus`, credentials);
      return { menu: data };
    } catch (err) {
      return { menu: null, error: err.response?.data?.message || err.message };
    }
  },

  // ── Update store hours ─────────────────────────────────────────────────────
  updateHours: async (credentials, hours) => {
    try {
      await callAPI('POST', `/v1/eats/stores/${credentials.storeId}/holiday-hours`, credentials, { holiday_hours: hours });
      return { updated: true };
    } catch (err) {
      return { updated: false, error: err.response?.data?.message || err.message };
    }
  },

  // ── Extra: Get order details ───────────────────────────────────────────────
  getOrder: async (credentials, orderId) => {
    try {
      return { order: await callAPI('GET', `/v2/eats/order/${orderId}`, credentials) };
    } catch (err) {
      return { order: null, error: err.message };
    }
  },

  // ── Extra: Set store online/offline ────────────────────────────────────────
  setStoreStatus: async (credentials, status) => {
    try {
      await callAPI('POST', `/v1/eats/store/${credentials.storeId}/status`, credentials, { status });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // ── Extra: Poll for new orders (alternative to webhooks) ───────────────────
  listCreatedOrders: async (credentials) => {
    try {
      const data = await callAPI('GET', `/v1/eats/stores/${credentials.storeId}/created-orders`, credentials);
      return { orders: data.orders || [] };
    } catch (err) {
      return { orders: [], error: err.message };
    }
  },
};
