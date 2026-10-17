import type { D1Database } from '@cloudflare/workers-types';
import { toBusinessDateString } from '@/lib/date';

/**
 * Delivery shipment weeks (owner, 2026-10-17). Delivery orders ship in weekly
 * batches on Monday/Tuesday. At checkout the shopper picks a shipment week from
 * the next few; each week takes up to the owner's weekly limit of orders, then
 * shows "Full" while later weeks stay open. Orders placed up to Sunday 11:59 PM
 * Dallas time can join the coming Monday's shipment.
 *
 * A week is named by its Monday (YYYY-MM-DD), stored in orders.ship_week.
 * Paid and partly refunded delivery orders hold a spot; refunded, cancelled,
 * on-hold and test orders don't. No limit saved = every week open. Lookups
 * fail open: a database hiccup must not block delivery for everyone.
 */
const SETTING_KEY = 'weekly_delivery_limit';
export const MAX_WEEKLY_DELIVERY_LIMIT = 1000;
/** How many shipment weeks checkout offers. */
export const SHIP_WEEKS_OFFERED = 4;

/** When every offered shipment week is full (Delivery greys out). */
export const DELIVERY_WEEK_FULL_ERROR =
  'Delivery is fully booked for the next few weeks. Free pickup in Plano, Frisco and Irving is still available.';
/** When the chosen week filled up or is no longer offered. */
export const SHIP_WEEK_UNAVAILABLE_ERROR =
  'That shipment week is no longer available. Please choose another week.';

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the Dallas-time week containing `now`. */
function thisMonday(now: Date): string {
  const today = toBusinessDateString(now);
  return addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
}

/** The shipment weeks a shopper can choose now: the coming Monday onward. */
export function offeredShipWeeks(now = new Date(), count = SHIP_WEEKS_OFFERED): string[] {
  const first = addDays(thisMonday(now), 7);
  return Array.from({ length: count }, (_, i) => addDays(first, i * 7));
}

export function isShipWeek(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(`${value}T00:00:00Z`).getUTCDay() === 1;
}

/** "Mon Oct 26 / Tue Oct 27" — the dispatch days of a shipment week. */
export function shipWeekDays(week: string): string {
  const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  }).replace(',', '');
  return `${day(week)} / ${day(addDays(week, 1))}`;
}

/** A whole number from 1 to 1000, or null to remove the limit. Anything else is invalid (undefined). */
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

/** Delivery orders holding a spot in each of the given shipment weeks. */
export async function countShipWeekOrders(db: D1Database, weeks: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = Object.fromEntries(weeks.map((w) => [w, 0]));
  if (weeks.length === 0) return counts;
  const rows = await db.prepare(
    `SELECT o.ship_week AS week, COUNT(*) AS n FROM orders o
     WHERE o.order_type = 'delivery' AND o.payment_status IN ('paid', 'partially_refunded')
       AND o.status NOT IN ('cancelled', 'on_hold')
       AND o.ship_week IN (${weeks.map(() => '?').join(', ')})
       AND NOT EXISTS (SELECT 1 FROM order_reporting_exclusions x WHERE x.order_id = o.id)
     GROUP BY o.ship_week`,
  ).bind(...weeks).all<{ week: string; n: number }>();
  for (const row of rows.results ?? []) counts[row.week] = Number(row.n);
  return counts;
}

export interface ShipWeekStatus {
  week: string;
  /** "Mon Oct 26 / Tue Oct 27" */
  days: string;
  used: number;
  full: boolean;
}

export interface DeliveryWeeksStatus {
  limit: number | null;
  weeks: ShipWeekStatus[];
  /** Every offered week is full: Delivery greys out at checkout. */
  allFull: boolean;
}

/** The offered shipment weeks with their counts. Fails open (all open) on any error. */
export async function deliveryWeeksStatus(db: D1Database, now = new Date(), extraWeeks: string[] = []): Promise<DeliveryWeeksStatus> {
  const offered = offeredShipWeeks(now);
  const weeks = [...new Set([...extraWeeks.filter(isShipWeek), ...offered])].sort();
  try {
    const limit = await getWeeklyDeliveryLimit(db);
    const counts = await countShipWeekOrders(db, weeks);
    const status = weeks.map((week) => ({
      week, days: shipWeekDays(week), used: counts[week] ?? 0, full: limit !== null && (counts[week] ?? 0) >= limit,
    }));
    const offeredStatus = status.filter((w) => offered.includes(w.week));
    return { limit, weeks: status, allFull: offeredStatus.every((w) => w.full) };
  } catch (error) {
    console.error(JSON.stringify({ event: 'delivery_limit_lookup_failed', error: error instanceof Error ? error.message : String(error) }));
    return { limit: null, weeks: weeks.map((week) => ({ week, days: shipWeekDays(week), used: 0, full: false })), allFull: false };
  }
}

/** The earliest offered week with room, or null when every offered week is full. */
export function firstOpenWeek(status: DeliveryWeeksStatus, now = new Date()): string | null {
  const offered = offeredShipWeeks(now);
  return status.weeks.find((w) => offered.includes(w.week) && !w.full)?.week ?? null;
}

/** True when this shipment week still has room (any week; used again right before charging). */
export async function isShipWeekOpen(db: D1Database, week: string): Promise<boolean> {
  try {
    const limit = await getWeeklyDeliveryLimit(db);
    if (limit === null) return true;
    const counts = await countShipWeekOrders(db, [week]);
    return (counts[week] ?? 0) < limit;
  } catch (error) {
    console.error(JSON.stringify({ event: 'delivery_limit_lookup_failed', error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
}
