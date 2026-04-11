/**
 * DoorDash Marketplace Adapter
 * -----------------------------
 * Implements the platform adapter interface for DoorDash Drive / Marketplace API.
 * Uses JWT (HS256, DD-JWT-V1) for authentication.
 *
 * API docs: https://developer.doordash.com/
 */

import crypto from 'node:crypto';
import axios from 'axios';

const BASE_URL = 'https://openapi.doordash.com/marketplace';
const TIMEOUT  = 15_000;

// ── JWT generation ──────────────────────────────────────────

function base64url(buf) {
  return buf.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Build a DoorDash JWT (DD-JWT-V1) valid for 5 minutes.
 *
 * @param {{ developerId: string, keyId: string, signingSecret: string }} creds
 * @returns {string} Signed JWT
 */
function createJWT({ developerId, keyId, signingSecret }) {
  const header = {
    alg:      'HS256',
    typ:      'JWT',
    'dd-ver': 'DD-JWT-V1',
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: 'doordash',
    iss: developerId,
    kid: keyId,
    iat: now,
    exp: now + 300,
  };

  const segments = [
    base64url(Buffer.from(JSON.stringify(header))),
    base64url(Buffer.from(JSON.stringify(payload))),
  ];

  const signingInput = segments.join('.');

  // DoorDash signing secrets are base64-encoded
  const decodedSecret = Buffer.from(signingSecret, 'base64');
  const signature = crypto
    .createHmac('sha256', decodedSecret)
    .update(signingInput)
    .digest();

  segments.push(base64url(signature));
  return segments.join('.');
}

// ── HTTP client factory ─────────────────────────────────────

function client(creds) {
  const jwt = createJWT(creds);
  return axios.create({
    baseURL: BASE_URL,
    timeout: TIMEOUT,
    headers: {
      'Authorization':  `Bearer ${jwt}`,
      'auth-version':   'v2',
      'Content-Type':   'application/json',
    },
  });
}

/**
 * Normalize Axios / network errors into a terse message.
 */
function extractError(err) {
  if (err.response) {
    const d = err.response.data;
    return d?.message || d?.error || `HTTP ${err.response.status}: ${err.response.statusText}`;
  }
  if (err.code === 'ECONNABORTED') return 'Request timed out (15 s)';
  return err.message || 'Unknown error';
}

// ── Adapter methods ─────────────────────────────────────────

/**
 * Verify credentials by fetching the store details.
 */
async function testConnection(creds) {
  try {
    const { data } = await client(creds).get(
      `/api/v1/stores/${creds.storeLocationId}/store_details`,
    );
    return { ok: true, storeName: data.name || data.store_name || 'DoorDash Store' };
  } catch (err) {
    return { ok: false, error: extractError(err) };
  }
}

/**
 * Sync inventory items (stock status + price) to DoorDash.
 *
 * @param {object}   creds
 * @param {Array<{ merchant_supplied_id: string, base_price: number, status: 'AVAILABLE'|'OUT_OF_STOCK' }>} items
 */
async function syncInventory(creds, items) {
  const synced  = [];
  const failed  = [];
  const errors  = [];

  // DoorDash supports batch updates via PATCH /items
  const BATCH_SIZE = 100;
  const http = client(creds);

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    try {
      await http.patch(
        `/api/v2/stores/${creds.storeLocationId}/items`,
        batch,
      );
      synced.push(...batch.map(b => b.merchant_supplied_id));
    } catch (err) {
      const msg = extractError(err);
      errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${msg}`);
      failed.push(...batch.map(b => b.merchant_supplied_id));
    }
  }

  return { synced: synced.length, failed: failed.length, errors };
}

/**
 * Confirm (accept / reject) a DoorDash order.
 *
 * @param {object} creds
 * @param {string} orderId  — external platform order ID
 * @param {{ accept: boolean, merchantSuppliedId?: string }} data
 */
async function confirmOrder(creds, orderId, data = {}) {
  try {
    await client(creds).patch(`/api/v1/orders/${orderId}`, {
      merchant_supplied_id: data.merchantSuppliedId || orderId,
      order_status: data.accept !== false ? 'success' : 'fail',
    });
    return { confirmed: true };
  } catch (err) {
    return { confirmed: false, error: extractError(err) };
  }
}

/**
 * Notify DoorDash the order is ready for pickup.
 */
async function markReady(creds, orderId) {
  try {
    await client(creds).patch(
      `/api/v1/orders/${orderId}/events/order_ready_for_pickup`,
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: extractError(err) };
  }
}

/**
 * Cancel / reject an order with a reason.
 */
async function cancelOrder(creds, orderId, reason = 'store_closed') {
  try {
    await client(creds).patch(`/api/v1/orders/${orderId}`, {
      order_status:   'fail',
      failure_reason: reason,
    });
    return { cancelled: true };
  } catch (err) {
    return { cancelled: false, error: extractError(err) };
  }
}

/**
 * Fetch the full menu / catalog for this store.
 */
async function getMenu(creds) {
  try {
    const { data } = await client(creds).get(
      `/api/v1/stores/${creds.storeLocationId}/store_menu`,
    );
    return { menu: data };
  } catch (err) {
    return { menu: null, error: extractError(err) };
  }
}

/**
 * Update the store's operating hours on DoorDash.
 *
 * @param {object} creds
 * @param {object} hours  — { operating_hours: [...] } in DoorDash format
 */
async function updateHours(creds, hours) {
  try {
    await client(creds).patch(
      `/api/v2/stores/${creds.storeLocationId}`,
      { operating_hours: hours },
    );
    return { updated: true };
  } catch (err) {
    return { updated: false, error: extractError(err) };
  }
}

// ── Export ───────────────────────────────────────────────────

export default {
  testConnection,
  syncInventory,
  confirmOrder,
  markReady,
  cancelOrder,
  getMenu,
  updateHours,
};
