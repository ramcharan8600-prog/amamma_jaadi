import { BUSINESS_TZ } from '@/lib/constants';

/**
 * Date helpers anchored to the business timezone (US Central).
 *
 * Using UTC for "today" would roll the date forward during late-evening hours,
 * incorrectly affecting same-day pickup and production date filters.
 */

/** Format a Date as YYYY-MM-DD in the business timezone. */
export function toBusinessDateString(date: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Format a stored 'YYYY-MM-DD' pickup date for display, e.g.
 * "Saturday, July 26, 2026".
 *
 * Built and formatted in UTC on purpose: `new Date('2026-07-26')` is parsed as
 * UTC midnight, so formatting it in a behind-UTC timezone (like US Central)
 * would render the PREVIOUS day. Returns the raw value if it isn't a date.
 */
export function formatPickupDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || '').trim());
  if (!m) return ymd || '';
  const [, y, mo, d] = m;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))));
}

/** YYYY-MM-DD offset by `days` from now, in the business timezone. */
export function businessDateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toBusinessDateString(d);
}
