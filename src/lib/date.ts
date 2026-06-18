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

/** YYYY-MM-DD offset by `days` from now, in the business timezone. */
export function businessDateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toBusinessDateString(d);
}
