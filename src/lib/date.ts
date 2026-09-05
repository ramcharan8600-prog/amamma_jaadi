import { BUSINESS_TZ } from '@/lib/constants';

const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const D1_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

const businessDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

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
 * Convert a D1 UTC timestamp to its calendar date in the business timezone.
 *
 * SQLite's `datetime('now')` is stored as `YYYY-MM-DD HH:mm:ss` without a
 * timezone suffix. Browsers otherwise interpret that shape inconsistently, so
 * normalize it explicitly as UTC before formatting it for the dashboard.
 */
export function d1TimestampToBusinessDate(value: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';

  const normalized = D1_UTC_TIMESTAMP_PATTERN.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? '' : toBusinessDateString(date);
}

function parseCalendarDate(ymd: string): { year: number; month: number; day: number } | null {
  const match = YMD_PATTERN.exec((ymd || '').trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) return null;

  return { year, month, day };
}

function businessTimeZoneOffsetMs(date: Date): number {
  const parts = Object.fromEntries(
    businessDateTimeFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  const localClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localClockAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function businessMidnightUtc(year: number, month: number, day: number): Date {
  const localClock = Date.UTC(year, month - 1, day);
  let instant = localClock;

  // Re-evaluate the offset at the calculated instant. This second pass makes
  // the conversion correct on both CST and CDT dates, including DST weekends.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    instant = localClock - businessTimeZoneOffsetMs(new Date(instant));
  }
  return new Date(instant);
}

function toD1UtcTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** UTC bounds that represent one US-Central calendar day in D1. */
export function businessDateUtcRange(
  ymd: string
): { start: string; end: string } | null {
  const parsed = parseCalendarDate(ymd);
  if (!parsed) return null;

  const nextDate = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1));
  const start = businessMidnightUtc(parsed.year, parsed.month, parsed.day);
  const end = businessMidnightUtc(
    nextDate.getUTCFullYear(),
    nextDate.getUTCMonth() + 1,
    nextDate.getUTCDate()
  );

  return { start: toD1UtcTimestamp(start), end: toD1UtcTimestamp(end) };
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
  const m = YMD_PATTERN.exec((ymd || '').trim());
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
