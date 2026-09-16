import { d1TimestampToBusinessDate, toBusinessDateString } from '@/lib/date';
import type { OrderRecord } from '@/types';

type SalesOrder = Pick<
  OrderRecord,
  'created_at' | 'total_price' | 'refunded_amount' | 'payment_status'
>;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const DISPLAYED_WEEKS = 52;
const DISPLAYED_MONTHS = 12;
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

/** Revenue periods and order weekdays based on the store's Central calendar. */
export function getSalesTimeSeries(orders: readonly SalesOrder[], now = new Date()) {
  const today = calendarDate(toBusinessDateString(now));
  const currentMonday = today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY_MS;
  const firstMonday = currentMonday - (DISPLAYED_WEEKS - 1) * WEEK_MS;

  const weeklyRevenue = Array.from({ length: DISPLAYED_WEEKS }, (_, index) => {
    const start = new Date(firstMonday + index * WEEK_MS);
    const end = new Date(start.getTime() + 6 * DAY_MS);
    return {
      label: shortDateFormatter.format(start),
      rangeLabel: `${fullDateFormatter.format(start)} – ${fullDateFormatter.format(end)}`,
      value: 0,
    };
  });

  const firstMonth = new Date(Date.UTC(
    today.getUTCFullYear(), today.getUTCMonth() - (DISPLAYED_MONTHS - 1), 1
  ));
  const firstMonthNumber = firstMonth.getUTCFullYear() * 12 + firstMonth.getUTCMonth();
  const monthlyRevenue = Array.from({ length: DISPLAYED_MONTHS }, (_, index) => ({
    label: monthFormatter.format(new Date(Date.UTC(
      firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + index, 1
    ))),
    value: 0,
  }));
  const dayOfWeek = DAY_NAMES.map((day) => ({ day, orders: 0 }));

  for (const order of orders) {
    if (!['paid', 'partially_refunded'].includes(order.payment_status)) continue;

    const ymd = d1TimestampToBusinessDate(order.created_at);
    if (!ymd) continue;
    const date = calendarDate(ymd);
    const revenue = netRevenueCents(order);

    const weekIndex = Math.floor((date.getTime() - firstMonday) / WEEK_MS);
    if (weekIndex >= 0 && weekIndex < weeklyRevenue.length) {
      weeklyRevenue[weekIndex].value += revenue;
    }

    const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() - firstMonthNumber;
    if (monthIndex >= 0 && monthIndex < monthlyRevenue.length) {
      monthlyRevenue[monthIndex].value += revenue;
    }
    dayOfWeek[date.getUTCDay()].orders += 1;
  }

  return {
    weeklyRevenue: weeklyRevenue.map((week) => ({ ...week, value: week.value / 100 })),
    monthlyRevenue: monthlyRevenue.map((month) => ({ ...month, value: month.value / 100 })),
    dayOfWeek,
  };
}
