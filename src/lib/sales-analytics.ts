import { d1TimestampToBusinessDate } from '@/lib/date';
import type { OrderRecord } from '@/types';

type SalesOrder = Pick<
  OrderRecord,
  'created_at' | 'total_price' | 'refunded_amount' | 'payment_status'
>;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
export const REVENUE_YEARS = [2026, 2027, 2028, 2029, 2030, 2031] as const;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', timeZone: 'UTC',
});
const fullDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const monthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short', year: '2-digit', timeZone: 'UTC',
});

// These Dates represent calendar days, not instants in the business timezone.
// UTC arithmetic keeps their day/month boundaries stable through DST changes.
function calendarDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

function netRevenueCents(order: SalesOrder): number {
  const total = Number(order.total_price);
  const refund = Number(order.refunded_amount) || 0;
  if (!Number.isFinite(total) || !Number.isFinite(refund)) return 0;
  return Math.max(0, Math.round(total * 100) - Math.round(refund * 100));
}

/** Selected-year revenue and all-history weekdays in the store's Central calendar. */
export function getSalesTimeSeries(orders: readonly SalesOrder[], year: number) {
  if (!REVENUE_YEARS.some((supportedYear) => supportedYear === year)) {
    throw new RangeError('Revenue year must be between 2026 and 2031.');
  }

  // Revenue reporting begins in July 2026. Later years show
  // January through December, including empty periods and partial edge weeks.
  const firstMonth = year === 2026 ? 6 : 0;
  const rangeStart = new Date(Date.UTC(year, firstMonth, 1));
  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = Date.UTC(year + 1, 0, 1);
  const firstMonday = rangeStartMs - ((rangeStart.getUTCDay() + 6) % 7) * DAY_MS;
  const weekCount = Math.ceil((rangeEndMs - firstMonday) / WEEK_MS);

  const weeklyRevenue = Array.from({ length: weekCount }, (_, index) => {
    const monday = firstMonday + index * WEEK_MS;
    const start = new Date(Math.max(monday, rangeStartMs));
    const end = new Date(Math.min(monday + 6 * DAY_MS, rangeEndMs - DAY_MS));
    return {
      label: shortDateFormatter.format(start),
      rangeLabel: `${fullDateFormatter.format(start)} – ${fullDateFormatter.format(end)}`,
      value: 0,
    };
  });

  const monthlyRevenue = Array.from({ length: 12 - firstMonth }, (_, index) => ({
    label: monthFormatter.format(new Date(Date.UTC(year, firstMonth + index, 1))),
    value: 0,
  }));
  const dayOfWeek = DAY_NAMES.map((day) => ({ day, orders: 0 }));

  for (const order of orders) {
    if (!['paid', 'partially_refunded'].includes(order.payment_status)) continue;

    const ymd = d1TimestampToBusinessDate(order.created_at);
    if (!ymd) continue;
    const date = calendarDate(ymd);
    dayOfWeek[date.getUTCDay()].orders += 1;

    const dateMs = date.getTime();
    if (dateMs < rangeStartMs || dateMs >= rangeEndMs) continue;

    const revenue = netRevenueCents(order);
    const weekIndex = Math.floor((dateMs - firstMonday) / WEEK_MS);
    weeklyRevenue[weekIndex].value += revenue;
    monthlyRevenue[date.getUTCMonth() - firstMonth].value += revenue;
  }

  return {
    weeklyRevenue: weeklyRevenue.map((week) => ({ ...week, value: week.value / 100 })),
    monthlyRevenue: monthlyRevenue.map((month) => ({ ...month, value: month.value / 100 })),
    dayOfWeek,
  };
}
