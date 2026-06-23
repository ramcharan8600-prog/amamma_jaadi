/**
 * Cache Layer — Upstash Redis
 *
 * Provides caching for:
 * - Product catalog (reduces Supabase reads)
 * - API response caching
 * - Rate limiting preparation
 *
 * Setup: Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.local
 * If not configured, falls through to database directly (no-op cache).
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

// Read at REQUEST time — runtime env isn't reliable at module load on
// Cloudflare/OpenNext. (Upstash is optional; falls back to in-memory if unset.)
function getUpstash(): { url: string; token: string } {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  };
}

function isRedisConfigured(): boolean {
  const { url, token } = getUpstash();
  return !!(url && token);
}

/** Low-level Upstash REST API call */
async function redisCommand(command: string[]): Promise<unknown> {
  const { url, token } = getUpstash();
  if (!url || !token) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.result;
  } catch {
    return null;
  }
}

/** In-memory fallback cache when Redis is not configured */
const memoryCache = new Map<string, CacheEntry<unknown>>();

export const cache = {
  /**
   * Get a cached value. Returns null on miss.
   */
  async get<T>(key: string): Promise<T | null> {
    if (isRedisConfigured()) {
      const raw = await redisCommand(['GET', key]);
      if (raw && typeof raw === 'string') {
        try {
          // Redis handles expiry via EX — if the key exists it is still valid
          const entry: CacheEntry<T> = JSON.parse(raw);
          return entry.data;
        } catch { /* corrupted cache entry */ }
      }
      return null;
    }

    // In-memory fallback
    const entry = memoryCache.get(key) as CacheEntry<T> | undefined;
    if (entry && Date.now() < entry.expiresAt) return entry.data;
    memoryCache.delete(key);
    return null;
  },

  /**
   * Set a cached value with TTL in seconds.
   */
  async set<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };

    if (isRedisConfigured()) {
      await redisCommand(['SET', key, JSON.stringify(entry), 'EX', ttlSeconds.toString()]);
      return;
    }

    memoryCache.set(key, entry as CacheEntry<unknown>);
  },

  /**
   * Delete a cached value (cache invalidation).
   */
  async del(key: string): Promise<void> {
    if (isRedisConfigured()) {
      await redisCommand(['DEL', key]);
      return;
    }
    memoryCache.delete(key);
  },

  /**
   * Delete all keys matching a prefix (e.g. invalidate all product caches).
   */
  async invalidatePrefix(prefix: string): Promise<void> {
    if (isRedisConfigured()) {
      // Upstash supports SCAN but for simplicity, delete known keys
      const keys = await redisCommand(['KEYS', `${prefix}*`]);
      if (Array.isArray(keys)) {
        for (const key of keys) {
          await redisCommand(['DEL', key as string]);
        }
      }
      return;
    }

    for (const key of memoryCache.keys()) {
      if (key.startsWith(prefix)) memoryCache.delete(key);
    }
  },
};

/** Cache keys */
export const CACHE_KEYS = {
  PRODUCTS_ALL: 'products:all',
  PRODUCTS_CATEGORY: (cat: string) => `products:category:${cat}`,
  PICKUP_LOCATIONS: 'locations:active',
} as const;

/** Cache TTLs in seconds */
export const CACHE_TTL = {
  PRODUCTS: 5 * 60,       // 5 minutes
  LOCATIONS: 30 * 60,     // 30 minutes
  API_RESPONSE: 60,       // 1 minute
} as const;
