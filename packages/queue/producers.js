/**
 * @storeveu/queue/producers — sync event emitters used by the POS backend.
 *
 * Every emit is best-effort: if Redis/BullMQ aren't available, it logs a
 * one-line warn and returns. The POS backend already wraps these imports in a
 * try/catch (catalogController.ts) so a missing dep also degrades gracefully.
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

export async function emitProductSync(payload) {
  return enqueue('product.sync', payload);
}

export async function emitDepartmentSync(payload) {
  return enqueue('department.sync', payload);
}

export async function emitInventorySync(payload) {
  return enqueue('inventory.sync', payload);
}

export async function emitPromotionSync(payload) {
  return enqueue('promotion.sync', payload);
}
