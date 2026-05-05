/**
 * @storeveu/queue/producers — sync event emitters used by the POS backend.
 *
 * Every emit is best-effort: if Redis/BullMQ aren't available, it logs a
 * one-line warn and returns. The POS backend already wraps these imports in a
 * try/catch (catalogController.ts) so a missing dep also degrades gracefully.
 *
 * S71d follow-up — Signatures match the call sites in catalogController.ts:
 *   emitProductSync   (orgId, productId, action, payload?)
 *   emitDepartmentSync(orgId, departmentId, action, payload?)
 *   emitInventorySync (orgId, storeId, productId, action, payload?)
 *   emitPromotionSync (orgId, promotionId, action, payload?)
 *
 * Earlier versions of this file took a single-arg `payload` and silently
 * dropped everything but `orgId`. The signature now bundles positional args
 * into the BullMQ payload so the consumer (ecom-backend syncWorker) gets the
 * full event shape when Redis is enabled. Today this path is a no-op (queue
 * stub returns null), but the fix removes the latent footgun.
 */

import { getQueue, QUEUE_NAMES } from './index.js';

async function enqueue(eventName, payload) {
  try {
    const queue = await getQueue(QUEUE_NAMES.ECOM_SYNC);
    if (!queue) return;
    await queue.add(eventName, payload, {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  } catch (err) {
    console.warn(`[storeveu/queue] failed to enqueue ${eventName}:`, err.message);
  }
}

export async function emitProductSync(orgId, productId, action, payload) {
  return enqueue('product.sync', {
    orgId, entityType: 'product', entityId: String(productId), action, payload,
  });
}

export async function emitDepartmentSync(orgId, departmentId, action, payload) {
  return enqueue('department.sync', {
    orgId, entityType: 'department', entityId: String(departmentId), action, payload,
  });
}

export async function emitInventorySync(orgId, storeId, productId, action, payload) {
  return enqueue('inventory.sync', {
    orgId, storeId, entityType: 'inventory', entityId: String(productId), action, payload,
  });
}

export async function emitPromotionSync(orgId, promotionId, action, payload) {
  return enqueue('promotion.sync', {
    orgId, entityType: 'promotion', entityId: String(promotionId), action, payload,
  });
}
