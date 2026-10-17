import type { D1Database } from '@cloudflare/workers-types';
import { businessDateUtcRange, toBusinessDateString } from '@/lib/date';

/**
 * Weekly cap on delivery orders (owner, 2026-10-17: "accept 30 delivery orders
 * per week, Monday to Sunday, then grey out delivery"). The week runs Monday
 * 12:00 AM to Sunday 11:59 PM Dallas time. Paid and partly refunded delivery
 * orders count; fully refunded, cancelled and test orders give their spot back.
 * No limit saved = no cap. Every lookup fails open: a database hiccup must not
 * block delivery for everyone.
 */
const SETTING_KEY = 'weekly_delivery_limit';
export const MAX_WEEKLY_DELIVERY_LIMIT = 1000;

/** Shown on the greyed-out Delivery option and returned by the server when the week is full. */
export const DELIVERY_WEEK_FULL_ERROR =
  "This week's delivery orders are full. Delivery opens again on Monday. Free pickup in Plano, Frisco and Irving is still available.";

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** This delivery week in Dallas time: Monday, Sunday, next Monday (YYYY-MM-DD) and its D1 UTC bounds. */
export function deliveryWeek(now = new Date()) {
  const today = toBusinessDateString(now);
  const sinceMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDays(today, -sinceMonday);
  const nextMonday = addDays(monday, 7);
  return {
    monday,
    sunday: addDays(monday, 6),
    nextMonday,
    start: businessDateUtcRange(monday)!.start,
    end: businessDateUtcRange(nextMonday)!.start,
  };
}

/** A whole number from 1 to 1000, or null to remove the cap. Anything else is invalid (undefined). */
export function parseWeeklyLimit(value: unknown): number | null | undefined {
  if (value === null || value === '') return null;
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_WEEKLY_DELIVERY_LIMIT ? n : undefined;
}

export async function getWeeklyDeliveryLimit(db: D1Database): Promise<number | null> {
  const row = await db.prepare('SELECT value FROM shop_settings WHERE key = ?').bind(SETTING_KEY).first<{ value: string }>();
  return parseWeeklyLimit(row?.value ?? null) ?? null;
}

export async function setWeeklyDeliveryLimit(db: D1Database, limit: number | null): Promise<void> {
  if (limit === null) {
    await db.prepare('DELETE FROM shop_settings WHERE key = ?').bind(SETTING_KEY).run();
    return;
  }
  await db.prepare(
    `INSERT INTO shop_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(SETTING_KEY, String(limit)).run();
}

/** Delivery orders that hold a spot in this week. */
export async function countWeekDeliveryOrders(db: D1Database, now = new Date()): Promise<number> {
  const week = deliveryWeek(now);
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM orders o
     WHERE o.order_type = 'delivery' AND o.payment_status IN ('paid', 'partially_refunded') AND o.status != 'cancelled'
       AND o.created_at >= ? AND o.created_at < ?
       AND NOT EXISTS (SELECT 1 FROM order_reporting_exclusions x WHERE x.order_id = o.id)`,
  ).bind(week.start, week.end).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export interface DeliveryWeekStatus {
  limit: number | null;
  used: number;
  full: boolean;
  monday: string;
  sunday: string;
  /** The Monday delivery opens again (the next week's start). */
  reopensOn: string;
}

/** Limit, orders this week and whether delivery is full. Fails open (not full) on any error. */
export async function deliveryWeekStatus(db: D1Database, now = new Date()): Promise<DeliveryWeekStatus> {
  const week = deliveryWeek(now);
  const base = { monday: week.monday, sunday: week.sunday, reopensOn: week.nextMonday };
  try {
    const limit = await getWeeklyDeliveryLimit(db);
    const used = await countWeekDeliveryOrders(db, now);
    return { ...base, limit, used, full: limit !== null && used >= limit };
  } catch (error) {
    console.error(JSON.stringify({ event: 'delivery_limit_lookup_failed', error: error instanceof Error ? error.message : String(error) }));
    return { ...base, limit: null, used: 0, full: false };
  }
}

/** True when this week's delivery orders have reached the cap. */
export async function isDeliveryWeekFull(db: D1Database, now = new Date()): Promise<boolean> {
  return (await deliveryWeekStatus(db, now)).full;
}
