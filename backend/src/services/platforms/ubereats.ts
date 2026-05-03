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

import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import crypto from 'crypto';
import type {
  PlatformAdapter,
  PlatformCredentials,
  TestConnectionResult,
  SyncInventoryResult,
  ConfirmOrderResult,
  MarkReadyResult,
  CancelOrderResult,
  GetMenuResult,
  UpdateHoursResult,
  InventoryItemInput,
  PlatformHours,
} from './adapterInterface.js';

const BASE_URL = 'https://api.uber.com';
const TOKEN_URL = 'https://auth.uber.com/oauth/v2/token';
const SCOPES = 'eats.store eats.order eats.store.orders.read eats.store.status.write eats.report';

interface UberCredentials extends PlatformCredentials {
  clientId: string;
  clientSecret: string;
  storeId: string;
  accessToken?: string;
  tokenExpiresAt?: string;
}

interface UberInventoryItem extends InventoryItemInput {
  merchant_supplied_id: string;
  base_price?: number;
  status?: 'AVAILABLE' | 'OUT_OF_STOCK';
}

interface UberSyncError { itemId: string; error: string }

interface UberConfirmData {
  reason?: string;
  pickupTime?: string | number | Date;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// ── Token Management ─────────────────────────────────────────────────────────

async function getAccessToken(credentials: UberCredentials): Promise<string> {
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

  const resp = await axios.post<{ access_token: string; expires_in?: number }>(TOKEN_URL, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });

  credentials.accessToken = resp.data.access_token;
  credentials.tokenExpiresAt = new Date(Date.now() + (resp.data.expires_in || 2592000) * 1000).toISOString();
  return credentials.accessToken;
}

// ── API Call Helper ──────────────────────────────────────────────────────────

async function callAPI<T = unknown>(
  method: HttpMethod,
  path: string,
  credentials: UberCredentials,
  body: unknown = null,
): Promise<T> {
  const token = await getAccessToken(credentials);
  const config: AxiosRequestConfig = {
    method,
    url: `${BASE_URL}${path}`,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 15000,
  };
  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) config.data = body;
  return (await axios.request<T>(config)).data;
}

function errMsg(err: unknown): string {
  if (err instanceof AxiosError) {
    const d = err.response?.data as { message?: string } | undefined;
    return d?.message || err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function asCreds(c: PlatformCredentials): UberCredentials {
  return c as UberCredentials;
}

// ── Webhook Signature Verification ───────────────────────────────────────────

export function verifyWebhookSignature(
  body: string | object,
  signature: string,
  clientSecret: string,
): boolean {
  const computed = crypto.createHmac('sha256', clientSecret)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');
  return computed === signature;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADAPTER
// ═══════════════════════════════════════════════════════════════════════════════

interface UberEatsAdapter extends PlatformAdapter {
  getOrder(credentials: PlatformCredentials, orderId: string): Promise<{ order: unknown | null; error?: string }>;
  setStoreStatus(credentials: PlatformCredentials, status: string): Promise<{ success: boolean; error?: string }>;
  listCreatedOrders(credentials: PlatformCredentials): Promise<{ orders: unknown[]; error?: string }>;
}

const ubereats: UberEatsAdapter = {
  // ── Test connection ────────────────────────────────────────────────────────
  testConnection: async (credentials: PlatformCredentials): Promise<TestConnectionResult> => {
    const creds = asCreds(credentials);
    try {
      if (!creds.clientId || !creds.clientSecret || !creds.storeId)
        return { ok: false, error: 'Client ID, Client Secret, and Store ID are required' };
      const data = await callAPI<{ name?: string; store_name?: string }>(
        'GET',
        `/v1/eats/stores/${creds.storeId}`,
        creds,
      );
      return { ok: true, storeName: data.name || data.store_name || creds.storeId };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  },

  // ── Sync inventory (update menu items) ─────────────────────────────────────
  syncInventory: async (credentials: PlatformCredentials, items: InventoryItemInput[]): Promise<SyncInventoryResult> => {
    const creds = asCreds(credentials);
    const list = items as UberInventoryItem[];
    if (!list?.length) return { synced: 0, failed: 0, errors: [] };
    let synced = 0, failed = 0;
    const errors: string[] = [];

    for (const item of list) {
      try {
        const payload: Record<string, unknown> = { enabled: item.status === 'AVAILABLE' };
        if (item.base_price != null) payload.price_info = { price: item.base_price };
        if (item.status === 'OUT_OF_STOCK') {
          payload.suspension_info = { suspension: { suspend_until: 9999999999, reason: 'OUT_OF_STOCK' } };
        }
        await callAPI('POST', `/v1/eats/stores/${creds.storeId}/menus/items/${item.merchant_supplied_id}`, creds, payload);
        synced++;
      } catch (err) {
        failed++;
        const detail: UberSyncError = { itemId: item.merchant_supplied_id, error: errMsg(err) };
        errors.push(`${detail.itemId}: ${detail.error}`);
      }
    }
    return { synced, failed, errors };
  },

  // ── Accept order (SLA: 11.5 minutes) ───────────────────────────────────────
  confirmOrder: async (
    credentials: PlatformCredentials,
    orderId: string,
    data: unknown = {},
  ): Promise<ConfirmOrderResult> => {
    const creds = asCreds(credentials);
    const body = (data || {}) as UberConfirmData;
    try {
      await callAPI('POST', `/v1/eats/orders/${orderId}/accept_pos_order`, creds, {
        reason: body.reason || 'Accepted via StoreVue POS',
        ...(body.pickupTime ? { pickup_time: Math.floor(new Date(body.pickupTime).getTime() / 1000) } : {}),
      });
      return { confirmed: true };
    } catch (err) {
      return { confirmed: false, error: errMsg(err) };
    }
  },

  // ── Mark order ready ───────────────────────────────────────────────────────
  markReady: async (credentials: PlatformCredentials, orderId: string): Promise<MarkReadyResult> => {
    const creds = asCreds(credentials);
    try {
      await callAPI('POST', `/v1/eats/orders/${orderId}/restaurantdelivery/status`, creds, { status: 'ready' });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  // ── Deny or cancel order ───────────────────────────────────────────────────
  cancelOrder: async (
    credentials: PlatformCredentials,
    orderId: string,
    reason: string = 'Store cancelled',
  ): Promise<CancelOrderResult> => {
    const creds = asCreds(credentials);
    try {
      // Try deny (new orders) → then cancel (accepted orders)
      try {
        await callAPI('POST', `/v1/eats/orders/${orderId}/deny_pos_order`, creds, {
          reason: { explanation: reason },
        });
        return { cancelled: true };
      } catch {
        await callAPI('POST', `/v1/eats/orders/${orderId}/cancel`, creds, {
          reason, cancelling_party: 'MERCHANT',
        });
        return { cancelled: true };
      }
    } catch (err) {
      return { cancelled: false, error: errMsg(err) };
    }
  },

  // ── Get menu ───────────────────────────────────────────────────────────────
  getMenu: async (credentials: PlatformCredentials): Promise<GetMenuResult> => {
    const creds = asCreds(credentials);
    try {
      const data = await callAPI<Record<string, unknown>>('GET', `/v1/eats/stores/${creds.storeId}/menus`, creds);
      return { menu: data };
    } catch (err) {
      return { menu: null, error: errMsg(err) };
    }
  },

  // ── Update store hours ─────────────────────────────────────────────────────
  updateHours: async (credentials: PlatformCredentials, hours: PlatformHours): Promise<UpdateHoursResult> => {
    const creds = asCreds(credentials);
    try {
      await callAPI('POST', `/v1/eats/stores/${creds.storeId}/holiday-hours`, creds, { holiday_hours: hours });
      return { updated: true };
    } catch (err) {
      return { updated: false, error: errMsg(err) };
    }
  },

  // ── Extra: Get order details ───────────────────────────────────────────────
  getOrder: async (credentials: PlatformCredentials, orderId: string) => {
    const creds = asCreds(credentials);
    try {
      const order = await callAPI('GET', `/v2/eats/order/${orderId}`, creds);
      return { order };
    } catch (err) {
      return { order: null, error: errMsg(err) };
    }
  },

  // ── Extra: Set store online/offline ────────────────────────────────────────
  setStoreStatus: async (credentials: PlatformCredentials, status: string) => {
    const creds = asCreds(credentials);
    try {
      await callAPI('POST', `/v1/eats/store/${creds.storeId}/status`, creds, { status });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  // ── Extra: Poll for new orders (alternative to webhooks) ───────────────────
  listCreatedOrders: async (credentials: PlatformCredentials) => {
    const creds = asCreds(credentials);
    try {
      const data = await callAPI<{ orders?: unknown[] }>(
        'GET',
        `/v1/eats/stores/${creds.storeId}/created-orders`,
        creds,
      );
      return { orders: data.orders || [] };
    } catch (err) {
      return { orders: [], error: errMsg(err) };
    }
  },
};

export default ubereats;
