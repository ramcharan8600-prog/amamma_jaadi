/**
 * Cloudflare D1 access layer.
 *
 * All database access goes through the Worker's `DB` binding (server-side only —
 * the browser never touches the database). Replaces the Supabase client.
 */
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { D1Database } from '@cloudflare/workers-types';

type EnvWithDb = { DB?: D1Database };

/** Returns the D1 binding, or throws if it isn't configured. */
export function getDb(): D1Database {
  const env = getCloudflareContext().env as EnvWithDb;
  if (!env.DB) {
    throw new Error('D1 binding "DB" is not configured.');
  }
  return env.DB;
}

/** True when the D1 binding is available (request scope). */
export function isDbConfigured(): boolean {
  try {
    return !!(getCloudflareContext().env as EnvWithDb).DB;
  } catch {
    return false;
  }
}

/** Generate a primary-key id (UUID v4). */
export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Next sequential order number, e.g. AJ-1001.
 * `UPDATE ... RETURNING` is a single atomic statement and D1 serializes writes,
 * so concurrent callers always get distinct numbers — no race, no scan.
 */
export async function generateOrderNumber(db: D1Database): Promise<string> {
  const row = await db
    .prepare("UPDATE counters SET value = value + 1 WHERE name = 'order_number' RETURNING value")
    .first<{ value: number }>();
  const n = row?.value ?? 1001;
  return `AJ-${n}`;
}

/** Parse a JSON text column, tolerating null/garbage. */
export function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
