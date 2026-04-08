/**
 * Shared BullMQ queue definitions for the Storv POS platform.
 *
 * OPTIONAL: If Redis is not available, queues return null and all
 * queue operations are no-ops. The POS system works without queues —
 * e-commerce sync simply doesn't happen until Redis is available.
 */

let Queue;
try {
  Queue = (await import('bullmq')).Queue;
} catch {
  Queue = null;
}

import { getRedisClient, isRedisAvailable } from '@storv/redis';

const _queues = {};

function getOrCreateQueue(name) {
  if (_queues[name]) return _queues[name];

  const connection = getRedisClient();
  if (!connection || !Queue) return null;

  try {
    _queues[name] = new Queue(name, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
    return _queues[name];
  } catch {
    return null;
  }
}

/** Product/department/inventory sync: POS backend → ecom-backend */
export function getEcomSyncQueue() {
  return getOrCreateQueue('ecom-sync');
}

/** Order notifications: ecom-backend → portal (SSE/polling) */
export function getEcomOrdersQueue() {
  return getOrCreateQueue('ecom-orders');
}

/** ISR revalidation triggers: ecom-backend → Next.js storefront */
export function getEcomRevalidateQueue() {
  return getOrCreateQueue('ecom-revalidate');
}

/**
 * Gracefully close all queues. Call on process exit.
 */
export async function closeAllQueues() {
  const names = Object.keys(_queues);
  await Promise.all(names.map(n => _queues[n]?.close?.().catch(() => {})));
  for (const n of names) delete _queues[n];
  if (names.length > 0) console.log('✓ BullMQ queues closed');
}

export { isRedisAvailable };
