/**
 * Minimal in-memory rate limiter — no external dependencies.
 *
 * For production with multiple backend instances, replace with a Redis-backed
 * limiter (express-rate-limit + rate-limit-redis). This is sufficient for
 * single-instance deployments and dev.
 *
 * Each limiter keeps a fixed-window counter per IP.
 */

function createLimiter({ windowMs, max, message = 'Too many requests, please try again later.' }) {
  const hits = new Map(); // key -> { count, resetAt }

  // Periodic cleanup to avoid unbounded memory.
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits.entries()) {
      if (v.resetAt <= now) hits.delete(k);
    }
  }, windowMs).unref?.();

  return function rateLimit(req, res, next) {
    const key = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ error: message, retryAfter });
    }

    next();
  };
}

// 5 attempts / 15 min — login
export const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts. Please try again in 15 minutes.',
});

// 3 attempts / hour — forgot password
export const forgotPasswordLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: 'Too many password reset requests. Please try again in an hour.',
});

// 10 attempts / hour — signup (avoids mass account creation)
export const signupLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many signup attempts. Please try again later.',
});

// 20 attempts / 15 min — password reset with token
export const resetPasswordLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many password reset attempts. Please try again later.',
});

// 15 PIN attempts / 5 min — cashier PIN-based endpoints (clock, pin-login).
// Tolerates legitimate rapid shift turnover while blocking PIN brute force.
export const pinLimiter = createLimiter({
  windowMs: 5 * 60 * 1000,
  max: 15,
  message: 'Too many PIN attempts. Please wait a few minutes.',
});
