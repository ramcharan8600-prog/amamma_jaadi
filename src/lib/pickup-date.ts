import { businessDateUtcRange, toBusinessDateString } from '@/lib/date';
import { ASSORTED_BOBBATLU_BOX_PRODUCT_ID, BOBBATLU_PICKUP_TASTE_PACK_PRODUCT_ID, BOBBATLU_TASTE_PACK_PRODUCT_ID, isBobbatluProduct } from '@/data/products';

export const MAX_PICKUP_DAYS_AHEAD = 90;
export const SAME_DAY_PICKUP_CUTOFF_HOUR = 13;
export const SAME_DAY_PICKUP_CUTOFF_MINUTE = 30;

/** Pickup is closed on Tuesdays (UTC day 2 of a YYYY-MM-DD business date). */
export function isPickupClosedDate(date: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === 2;
}

/**
 * Days of notice a product needs before pickup, independently of ready stock.
 * Bobbatlu (loose, Kova Bobbatlu, the 8:8 box, both Taste Packs) needs 2 days so
 * the chef has time to make it (owner, 2026-11-26): added on Monday, pickup
 * opens Wednesday. Kova needs 1 day. Everything else can go same day.
 */
export function productPickupLeadDays(productId: string): number {
  if (isBobbatluProduct(productId) || productId === ASSORTED_BOBBATLU_BOX_PRODUCT_ID ||
    productId === BOBBATLU_TASTE_PACK_PRODUCT_ID || productId === BOBBATLU_PICKUP_TASTE_PACK_PRODUCT_ID) return 2;
  if (productId === 'sweet-kova') return 1;
  return 0;
}

/** The longest notice any item in the cart needs (0, 1 or 2 days). */
export function getPickupLeadDays(items: Array<{ productId: string }>): number {
  return items.reduce((days, { productId }) => Math.max(days, productPickupLeadDays(productId)), 0);
}

/** Product presence decides pickup lead time, independently of ready stock. */
export function requiresNextDayPickup(items: Array<{ productId: string }>): boolean {
  return getPickupLeadDays(items) > 0;
}

function pickupTimeBoundaries(now: Date) {
  const range = businessDateUtcRange(toBusinessDateString(now))!;
  const midnight = Date.parse(range.end.replace(' ', 'T') + 'Z');
  // Central DST changes happen before 1:30 PM, so counting back from the next
  // midnight preserves local cutoff time even on transition Sundays.
  const minutesUntilMidnight = 24 * 60 - (SAME_DAY_PICKUP_CUTOFF_HOUR * 60 + SAME_DAY_PICKUP_CUTOFF_MINUTE);
  const cutoff = midnight - minutesUntilMidnight * 60_000;
  return { midnight, cutoff };
}

function isPastSameDayCutoff(now: Date): boolean {
  return now.getTime() > pickupTimeBoundaries(now).cutoff;
}

/** Refresh only at the next Central-time cutoff or midnight; no polling needed. */
export function getNextPickupRefreshDelay(now = new Date()): number {
  const { midnight, cutoff } = pickupTimeBoundaries(now);
  // "On or before 1:30 PM" includes the cutoff instant itself.
  return Math.max(1, (now.getTime() <= cutoff ? cutoff + 1 : midnight) - now.getTime());
}

/**
 * Calendar arithmetic, independent of the customer's timezone and DST.
 * `leadDays` is the cart's product notice (getPickupLeadDays); `true` means 1 day.
 */
export function getPickupDateBounds(totalPieces: number, now = new Date(), leadDays: number | boolean = 0) {
  const productDays = Number(leadDays);
  const today = toBusinessDateString(now);
  const offset = (days: number) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const baseDays = totalPieces > 150 || isPastSameDayCutoff(now) ? 1 : 0;
  return { today, min: offset(Math.max(baseDays, productDays)), max: offset(MAX_PICKUP_DAYS_AHEAD) };
}

/** Return a customer-facing error, or null for an allowed YYYY-MM-DD date. */
export function getPickupDateError(value: unknown, totalPieces: number, now = new Date(), leadDays: number | boolean = 0): string | null {
  const productDays = Number(leadDays);
  if (value === '' || value == null) return 'Please select a pickup date.';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return 'Please select a valid pickup date.';
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return 'Please select a valid pickup date.';
  }
  const { today, min, max } = getPickupDateBounds(totalPieces, now, productDays);
  if (value < today) return 'Pickup date cannot be in the past. Please select today or a later date (Dallas time).';
  if (value < min) {
    if (productDays >= 2) return 'Bobbatlu is made fresh to order and needs 2 days to prepare. Please select the day after tomorrow or a later date.';
    if (productDays === 1) return 'Orders containing Kova are available for pickup from tomorrow. Please select tomorrow or a later date.';
    if (totalPieces > 150) return 'Large orders require at least 1 day notice. Please select tomorrow or a later date.';
    return 'Same-day pickup orders must be placed on or before 1:30 PM Central. Please select tomorrow or a later date.';
  }
  if (value > max) return `Pickup can be scheduled up to ${MAX_PICKUP_DAYS_AHEAD} days ahead. Please select an earlier date.`;
  if (isPickupClosedDate(value)) return 'Pickup is not available on Tuesdays. Please select another date.';
  return null;
}
