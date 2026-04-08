/**
 * In-memory rate limiter for DDoS protection at the route level.
 * Default: 5 attempts per 10-minute window per IP. Callers can override
 * both `windowMs` and `max` via the options object passed to rateLimiter().
 *
 * Note: Resets on server restart. The persistent brute-force lockout
 * (5 failed attempts / 10 min) is handled by authService via the
 * login_attempts DB table, which survives restarts.
 */

const store = new Map();

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

/**
 * Clean up expired entries periodically.
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.windowStart > WINDOW_MS) {
      store.delete(key);
    }
  }
}, 60 * 1000); // Cleanup every minute

/**
 * Rate limiter middleware factory.
 * @param {Object} options
 * @param {number} options.windowMs - Window size in milliseconds (default: 10 min)
 * @param {number} options.max - Max attempts per window (default: 5)
 */
function rateLimiter(options = {}) {
  const windowMs = options.windowMs || WINDOW_MS;
  const max = options.max || MAX_ATTEMPTS;

  return async (ctx, next) => {
    const ip = ctx.ip || ctx.request.ip || 'unknown';
    const now = Date.now();

    let entry = store.get(ip);

    if (!entry || (now - entry.windowStart > windowMs)) {
      entry = { windowStart: now, count: 0 };
      store.set(ip, entry);
    }

    entry.count++;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      ctx.set('Retry-After', String(retryAfter));
      ctx.status = 429;
      ctx.body = {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please try again later.',
          retryAfterSeconds: retryAfter
        }
      };
      return;
    }

    await next();
  };
}

/**
 * Reset rate limit for a specific IP (e.g., after successful login).
 */
function resetRateLimit(ip) {
  store.delete(ip);
}

module.exports = { rateLimiter, resetRateLimit };
