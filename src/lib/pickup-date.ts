import { toBusinessDateString } from '@/lib/date';

export const MAX_PICKUP_DAYS_AHEAD = 90;

/** Calendar arithmetic, independent of the customer's timezone and DST. */
export function getPickupDateBounds(totalPieces: number, now = new Date()) {
  const today = toBusinessDateString(now);
  const offset = (days: number) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  return { today, min: offset(totalPieces > 150 ? 1 : 0), max: offset(MAX_PICKUP_DAYS_AHEAD) };
}

/** Return a customer-facing error, or null for an allowed YYYY-MM-DD date. */
export function getPickupDateError(value: unknown, totalPieces: number, now = new Date()): string | null {
  if (value === '' || value == null) return 'Please select a pickup date.';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return 'Please select a valid pickup date.';
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return 'Please select a valid pickup date.';
  }
  const { today, min, max } = getPickupDateBounds(totalPieces, now);
  if (value < today) return 'Pickup date cannot be in the past. Please select today or a later date (Dallas time).';
  if (value < min) return 'Large orders require at least 1 day notice. Please select tomorrow or a later date.';
  if (value > max) return `Pickup can be scheduled up to ${MAX_PICKUP_DAYS_AHEAD} days ahead. Please select an earlier date.`;
  return null;
}
