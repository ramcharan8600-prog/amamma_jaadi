import type { D1Database } from '@cloudflare/workers-types';
import { getShippingZone, normalizeStateCode, type ShippingZone } from '@/lib/pricing';

/** Delivery areas in the order the admin panel lists them. */
export const DELIVERY_ZONES: ReadonlyArray<ShippingZone> = ['texas', 'nearby', 'far'];

export function isDeliveryZone(value: unknown): value is ShippingZone {
  return typeof value === 'string' && (DELIVERY_ZONES as ReadonlyArray<string>).includes(value);
}

/** Customer-facing refusal when every delivery area is paused. */
export const DELIVERY_PAUSED_ERROR = 'Delivery is paused right now. Pickup in Dallas is still available.';

/** Customer-facing refusal for a delivery to a paused area. */
export const DELIVERY_ZONE_PAUSED_ERROR =
  'Sorry, delivery to this state is paused right now. Please choose pickup or check back soon.';

/** The paused areas, in panel order. */
export async function listPausedZones(db: D1Database): Promise<ShippingZone[]> {
  const rows = await db.prepare('SELECT zone FROM delivery_pauses').all<{ zone: string }>();
  const paused = new Set((rows.results ?? []).map((row) => row.zone));
  return DELIVERY_ZONES.filter((zone) => paused.has(zone));
}

/** Replace the paused set (admin). */
export async function setPausedZones(db: D1Database, zones: ShippingZone[]): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM delivery_pauses'),
    ...zones.map((zone) => db.prepare('INSERT OR IGNORE INTO delivery_pauses (zone) VALUES (?)').bind(zone)),
  ]);
}

/**
 * True when delivery to this state is paused. Fails open: if the lookup itself
 * fails (e.g. the table is missing), log it and let checkout continue rather
 * than block every delivery order.
 */
export async function isDeliveryPausedFor(db: D1Database, state: unknown): Promise<boolean> {
  const code = normalizeStateCode(state);
  if (!code) return false;
  try {
    return Boolean(await db.prepare('SELECT 1 AS hit FROM delivery_pauses WHERE zone = ?').bind(getShippingZone(code)).first());
  } catch (error) {
    console.error(JSON.stringify({ event: 'delivery_pause_lookup_failed', error: error instanceof Error ? error.message : String(error) }));
    return false;
  }
}
