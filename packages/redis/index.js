/**
 * @storeveu/redis — stub. Returns null / false / no-op everywhere so
 * consumers (ecom-backend cache, BullMQ workers, sync producers) degrade
 * gracefully without Redis. Replace with a real ioredis-backed singleton
 * when the ecom sync pipeline is wired up.
 *
 * Existing consumers already guard against null return from getRedisClient()
 * and false from isRedisAvailable() — see ecom-backend/src/server.js,
 * ecom-backend/src/config/redis.js, ecom-backend/src/workers/syncWorker.js.
 */

export function getRedisClient() {
  return null;
}

export function isRedisAvailable() {
  return false;
}

export async function disconnectRedis() {
  // no-op
}
