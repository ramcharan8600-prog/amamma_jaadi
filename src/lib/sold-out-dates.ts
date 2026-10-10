import type { D1Database } from '@cloudflare/workers-types';
import { toBusinessDateString } from '@/lib/date';
import { MAX_PICKUP_DAYS_AHEAD } from '@/lib/pickup-date';

/** Customer-facing refusal for a pickup on a sold-out date. */
export const SOLD_OUT_DATE_ERROR = 'Sorry, we are sold out for pickup on that date. Please choose another date.';

/** A date the owner may mark sold out: a real YYYY-MM-DD from today (Dallas) up to the pickup horizon. */
export function isMarkableSoldOutDate(value: unknown, now = new Date()): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const today = toBusinessDateString(now);
  const last = new Date(`${today}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + MAX_PICKUP_DAYS_AHEAD);
  return value >= today && value <= last.toISOString().slice(0, 10);
}

/** Sold-out dates from today (Dallas) onward, earliest first. */
export async function listSoldOutDates(db: D1Database, now = new Date()): Promise<string[]> {
  const rows = await db
    .prepare('SELECT date FROM sold_out_dates WHERE date >= ? ORDER BY date')
    .bind(toBusinessDateString(now))
    .all<{ date: string }>();
  return (rows.results ?? []).map((row) => row.date);
}

/**
 * Fails open: if the lookup itself fails (e.g. the table is missing), log it and
 * let the checkout continue rather than block every pickup order.
 */
export async function isSoldOutDate(db: D1Database, date: unknown): Promise<boolean> {
  if (typeof date !== 'string') return false;
  try {
    return Boolean(await db.prepare('SELECT 1 AS hit FROM sold_out_dates WHERE date = ?').bind(date).first());
  } catch (error) {
    console.error(JSON.stringify({ event: 'sold_out_lookup_failed', error: error instanceof Error ? error.message : String(error) }));
    return false;
  }
}

export async function markSoldOutDate(db: D1Database, date: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO sold_out_dates (date) VALUES (?)').bind(date).run();
}

export async function reopenSoldOutDate(db: D1Database, date: string): Promise<void> {
  await db.prepare('DELETE FROM sold_out_dates WHERE date = ?').bind(date).run();
}
