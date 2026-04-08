/**
 * BullMQ producer helpers for the POS backend.
 *
 * Strategy:
 *   1. Try BullMQ queue (if Redis available)
 *   2. Fall back to direct HTTP call to ecom-backend (no Redis needed)
 *
 * POS operations are NEVER blocked by sync failures.
 */

import { getEcomSyncQueue } from './index.js';

const ECOM_BACKEND_URL = process.env.ECOM_BACKEND_URL || 'http://localhost:5005';
let _httpFallbackWarned = false;

/**
 * Send sync event via direct HTTP to ecom-backend.
 * Used when BullMQ/Redis is not available.
 */
async function httpFallback(data) {
  try {
    const resp = await fetch(`${ECOM_BACKEND_URL}/api/internal/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error('[ecom-sync] HTTP sync error:', err.error || resp.status);
    }
  } catch (err) {
    // Ecom-backend not running — silently skip (ecom module is optional)
    if (!_httpFallbackWarned) {
      console.log('⚠ Ecom-backend not reachable — product sync skipped (this is fine if e-commerce is not enabled)');
      _httpFallbackWarned = true;
    }
  }
}

/**
 * Core emit: tries BullMQ first, falls back to direct HTTP.
 */
async function emitSync(jobName, data) {
  // Try BullMQ first
  try {
    const queue = getEcomSyncQueue();
    if (queue) {
      await queue.add(jobName, { ...data, emittedAt: new Date().toISOString() }, {
        jobId: `${data.entityType}-${data.entityId}-${Date.now()}`,
      });
      return;
    }
  } catch {}

  // BullMQ unavailable — direct HTTP to ecom-backend
  await httpFallback(data);
}

export async function emitProductSync(orgId, productId, action, payload = null) {
  await emitSync('product.sync', { orgId, entityType: 'product', entityId: String(productId), action, payload });
}

export async function emitDepartmentSync(orgId, departmentId, action, payload = null) {
  await emitSync('department.sync', { orgId, entityType: 'department', entityId: String(departmentId), action, payload });
}

export async function emitInventorySync(orgId, storeId, productId, action, payload = null) {
  await emitSync('inventory.sync', { orgId, storeId, entityType: 'inventory', entityId: `${storeId}:${productId}`, action, payload });
}

export async function emitPromotionSync(orgId, promotionId, action, payload = null) {
  await emitSync('promotion.sync', { orgId, entityType: 'promotion', entityId: String(promotionId), action, payload });
}
