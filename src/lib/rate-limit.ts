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

  // Opportunistic eviction (no global timer — not Workers-friendly): sweep
  // expired buckets only when the map grows large, keeping memory bounded.
  if (buckets.size > 5000) {
    for (const [k, hit] of buckets) {
      if (now > hit.resetAt) buckets.delete(k);
    }
  }

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

/**
 * Trusted client IP. On Cloudflare, `cf-connecting-ip` is set by the edge and
 * cannot be spoofed by the client — unlike `x-forwarded-for`, which a caller can
 * set to any value to bypass per-IP limits. Prefer it; fall back for non-CF/local.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}
