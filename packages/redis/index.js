/**
 * Shared Redis client singleton for the Storv POS platform.
 *
 * OPTIONAL: If Redis is not available, all operations degrade gracefully.
 * The POS system continues to work without Redis — e-commerce sync
 * and caching features are simply disabled.
 *
 * Env:
 *   REDIS_URL  — Redis connection string (default: redis://127.0.0.1:6379)
 */

let Redis;
try {
  Redis = (await import('ioredis')).default;
} catch {
  Redis = null;
}

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let _client = null;
let _available = false;
let _warned = false;

/**
 * Get or create the shared Redis client.
 * Returns null if Redis (ioredis) is not installed or connection fails.
 */
export function getRedisClient() {
  if (_client) return _client;

  if (!Redis) {
    if (!_warned) {
      console.log('⚠ ioredis not installed — Redis features disabled');
      _warned = true;
    }
    return null;
  }

  _client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,   // Required by BullMQ
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 3) {
        // Stop retrying after 3 attempts — Redis is optional
        if (!_warned) {
          console.log('⚠ Redis unavailable after 3 retries — running without Redis');
          _warned = true;
        }
        return null; // stop retrying
      }
      return Math.min(times * 500, 3000);
    },
  });

  _client.on('connect', () => {
    _available = true;
    console.log('✓ Redis connected');
  });

  _client.on('error', (err) => {
    _available = false;
    if (!_warned) {
      console.log('⚠ Redis not available:', err.message, '— e-commerce sync disabled');
      _warned = true;
    }
  });

  _client.on('close', () => {
    _available = false;
  });

  // Non-blocking connect attempt
  _client.connect().catch(() => {});

  return _client;
}

/**
 * Check if Redis is currently connected and available.
 */
export function isRedisAvailable() {
  return _available;
}

/**
 * Graceful disconnect — call on process exit.
 */
export async function disconnectRedis() {
  if (_client) {
    try {
      await _client.quit();
    } catch {}
    _client = null;
    _available = false;
    console.log('✓ Redis disconnected');
  }
}

export default getRedisClient;
