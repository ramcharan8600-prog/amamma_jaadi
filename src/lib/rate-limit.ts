/**
 * Lightweight in-memory rate limiter (sliding window).
 *
 * Works without external infrastructure — suitable for protecting public
 * write endpoints (event inquiries, payment sessions) from spam/abuse.
 *
 * NOTE: In-memory state is per-instance. On a multi-instance/serverless
 * deployment this is best-effort. When Upstash Redis is configured we should
 * move this to a Redis-backed sliding window for global accuracy.
 */

interface Hit {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Hit>();

/**
 * Returns true if the request is allowed, false if the limit is exceeded.
 *
 * @param key     Unique identifier for the caller (e.g. `events:<ip>`)
 * @param limit   Max requests allowed within the window
 * @param windowMs Window length in milliseconds
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now > existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (existing.count >= limit) {
    return false;
  }

  existing.count += 1;
  return true;
}

/** Best-effort client IP from request headers. */
export function getClientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

// Periodically evict expired buckets so the map doesn't grow unbounded.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, hit] of buckets) {
      if (now > hit.resetAt) buckets.delete(key);
    }
  }, 5 * 60 * 1000).unref?.();
}
