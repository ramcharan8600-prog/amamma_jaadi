import { businessDateUtcRange, toBusinessDateString } from '@/lib/date';

export const MAX_PICKUP_DAYS_AHEAD = 90;
export const SAME_DAY_PICKUP_CUTOFF_HOUR = 13;
export const SAME_DAY_PICKUP_CUTOFF_MINUTE = 30;

/** Product presence decides pickup lead time, independently of ready stock. */
export function requiresNextDayPickup(items: Array<{ productId: string }>): boolean {
  return items.some(({ productId }) => productId === 'sweet-bobbatlu' || productId === 'sweet-kova');
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

/** Calendar arithmetic, independent of the customer's timezone and DST. */
export function getPickupDateBounds(totalPieces: number, now = new Date(), hasNextDayProduct = false) {
  const today = toBusinessDateString(now);
  const offset = (days: number) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  return { today, min: offset(totalPieces > 150 || hasNextDayProduct || isPastSameDayCutoff(now) ? 1 : 0), max: offset(MAX_PICKUP_DAYS_AHEAD) };
}

/** Return a customer-facing error, or null for an allowed YYYY-MM-DD date. */
export function getPickupDateError(value: unknown, totalPieces: number, now = new Date(), hasNextDayProduct = false): string | null {
  if (value === '' || value == null) return 'Please select a pickup date.';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return 'Please select a valid pickup date.';
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return 'Please select a valid pickup date.';
  }
  const { today, min, max } = getPickupDateBounds(totalPieces, now, hasNextDayProduct);
  if (value < today) return 'Pickup date cannot be in the past. Please select today or a later date (Dallas time).';
  if (value < min) {
    if (hasNextDayProduct) return 'Orders containing Bobbatlu or Kova are available for pickup from tomorrow. Please select tomorrow or a later date.';
    if (totalPieces > 150) return 'Large orders require at least 1 day notice. Please select tomorrow or a later date.';
    return 'Same-day pickup orders must be placed on or before 1:30 PM Central. Please select tomorrow or a later date.';
  }
  if (value > max) return `Pickup can be scheduled up to ${MAX_PICKUP_DAYS_AHEAD} days ahead. Please select an earlier date.`;
  return null;
}
