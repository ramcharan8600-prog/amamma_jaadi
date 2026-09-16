import { describe, expect, it } from 'vitest';
import { getSalesTimeSeries } from './sales-analytics';

function order(created_at: string, total_price = 10, overrides = {}) {
  return {
    created_at,
    total_price,
    refunded_amount: 0,
    payment_status: 'paid',
    ...overrides,
  };
}

describe('getSalesTimeSeries', () => {
  it('returns complete zero-filled series when no orders are available', () => {
    const result = getSalesTimeSeries([], new Date('2026-09-16T17:00:00Z'));

    expect(result.weeklyRevenue).toHaveLength(52);
    expect(result.monthlyRevenue).toHaveLength(12);
    expect(result.weeklyRevenue.every((week) => week.value === 0)).toBe(true);
    expect(result.monthlyRevenue.every((month) => month.value === 0)).toBe(true);
    expect(result.dayOfWeek).toEqual(
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => ({ day, orders: 0 }))
    );
  });

  it('uses Monday–Sunday weeks and includes orders earlier today in the current week', () => {
    const result = getSalesTimeSeries([
      order('2026-09-14 04:59:59', 11), // Sunday 11:59:59 PM Central
      order('2026-09-14 05:00:00', 20), // Monday midnight Central
      order('2026-09-16 12:00:00', 30), // Earlier today
    ], new Date('2026-09-16T17:00:00Z'));

    expect(result.weeklyRevenue[50]).toEqual({
      label: 'Sep 7', rangeLabel: 'Sep 7, 2026 – Sep 13, 2026', value: 11,
    });
    expect(result.weeklyRevenue[51]).toEqual({
      label: 'Sep 14', rangeLabel: 'Sep 14, 2026 – Sep 20, 2026', value: 50,
    });
    expect(result.dayOfWeek[0].orders).toBe(1);
    expect(result.dayOfWeek[1].orders).toBe(1);
    expect(result.dayOfWeek[3].orders).toBe(1);
  });

  it('uses the Central date of now when UTC has already reached Monday or a new month', () => {
    const result = getSalesTimeSeries([
      order('2026-06-01 02:30:00', 19), // Still Sunday, May 31 Central
    ], new Date('2026-06-01T03:00:00Z'));

    expect(result.weeklyRevenue[51]).toEqual({
      label: 'May 25', rangeLabel: 'May 25, 2026 – May 31, 2026', value: 19,
    });
    expect(result.monthlyRevenue[11]).toEqual({ label: 'May 26', value: 19 });
    expect(result.dayOfWeek[0].orders).toBe(1);
  });

  it('generates twelve distinct calendar months on March 31 without rolling February into March', () => {
    const result = getSalesTimeSeries([
      order('2025-10-15 12:00:00', 10),
      order('2025-11-15 12:00:00', 20),
      order('2025-12-15 12:00:00', 30),
      order('2026-01-15 12:00:00', 40),
      order('2026-02-15 12:00:00', 50),
      order('2026-03-31 12:00:00', 60),
    ], new Date('2026-03-31T17:00:00Z'));

    expect(result.monthlyRevenue).toEqual([
      { label: 'Apr 25', value: 0 },
      { label: 'May 25', value: 0 },
      { label: 'Jun 25', value: 0 },
      { label: 'Jul 25', value: 0 },
      { label: 'Aug 25', value: 0 },
      { label: 'Sep 25', value: 0 },
      { label: 'Oct 25', value: 10 },
      { label: 'Nov 25', value: 20 },
      { label: 'Dec 25', value: 30 },
      { label: 'Jan 26', value: 40 },
      { label: 'Feb 26', value: 50 },
      { label: 'Mar 26', value: 60 },
    ]);
  });

  it('normalizes raw D1 and equivalent ISO timestamps to the same business day', () => {
    const result = getSalesTimeSeries([
      order('2026-09-01 02:30:00', 10),
      order('2026-09-01T02:30:00Z', 20),
      order('2026-09-01T02:30:00.000', 30),
      order('2026-08-31T21:30:00-05:00', 40),
      order('2026-09-01 05:00:00', 50),
    ], new Date('2026-09-16T17:00:00Z'));

    expect(result.monthlyRevenue[10]).toEqual({ label: 'Aug 26', value: 100 });
    expect(result.monthlyRevenue[11]).toEqual({ label: 'Sep 26', value: 50 });
    expect(result.dayOfWeek[1].orders).toBe(4);
    expect(result.dayOfWeek[2].orders).toBe(1);
  });

  it('keeps week boundaries correct across the spring DST transition', () => {
    const result = getSalesTimeSeries([
      order('2026-03-08 07:30:00', 10), // Sunday before the clock change
      order('2026-03-08 08:30:00', 20), // Sunday after the clock change
      order('2026-03-09 04:59:59', 30), // Sunday 11:59:59 PM Central
      order('2026-03-09 05:00:00', 40), // Monday midnight Central
    ], new Date('2026-03-09T17:00:00Z'));

    expect(result.weeklyRevenue[50].value).toBe(60);
    expect(result.weeklyRevenue[51].value).toBe(40);
    expect(result.dayOfWeek[0].orders).toBe(3);
    expect(result.dayOfWeek[1].orders).toBe(1);
  });

  it('uses net revenue for partial refunds and ignores unpaid or fully refunded orders', () => {
    const result = getSalesTimeSeries([
      order('2026-09-16 12:00:00', 10.99),
      order('2026-09-16 12:00:00', 25.99, {
        payment_status: 'partially_refunded', refunded_amount: 5.5,
      }),
      order('2026-09-16 12:00:00', 20, {
        payment_status: 'partially_refunded', refunded_amount: 22,
      }),
      order('2026-09-16 12:00:00', 100, { payment_status: 'pending' }),
      order('2026-09-16 12:00:00', 100, { payment_status: 'failed' }),
      order('2026-09-16 12:00:00', 100, {
        payment_status: 'refunded', refunded_amount: 100,
      }),
    ], new Date('2026-09-16T17:00:00Z'));

    expect(result.weeklyRevenue[51].value).toBe(31.48);
    expect(result.monthlyRevenue[11].value).toBe(31.48);
    expect(result.dayOfWeek[3].orders).toBe(3);
  });

  it('ignores malformed timestamps without losing valid orders or producing NaN', () => {
    const result = getSalesTimeSeries([
      order('not-a-date', 100),
      order('', 100),
      order('2026-99-99 99:99:99', 100),
      order('2026-09-16 12:00:00', 9.99),
    ], new Date('2026-09-16T17:00:00Z'));

    expect(result.weeklyRevenue[51].value).toBe(9.99);
    expect(result.monthlyRevenue[11].value).toBe(9.99);
    expect(result.dayOfWeek.reduce((sum, day) => sum + day.orders, 0)).toBe(1);
  });

  it('includes exactly 52 current-inclusive weeks across the year boundary', () => {
    const result = getSalesTimeSeries([
      order('2025-09-22 04:59:59', 10), // Sunday just before the first displayed week
      order('2025-09-22 05:00:00', 20), // Monday midnight, first displayed week
      order('2025-12-31 12:00:00', 30),
      order('2026-01-01 12:00:00', 40), // Same calendar week across New Year
      order('2026-09-21 05:00:00', 50), // Next week, outside the displayed range
    ], new Date('2026-09-16T17:00:00Z'));

    expect(result.weeklyRevenue).toHaveLength(52);
    expect(result.weeklyRevenue[0]).toEqual({
      label: 'Sep 22', rangeLabel: 'Sep 22, 2025 – Sep 28, 2025', value: 20,
    });
    expect(result.weeklyRevenue.find((week) => week.label === 'Dec 29')).toEqual({
      label: 'Dec 29', rangeLabel: 'Dec 29, 2025 – Jan 4, 2026', value: 70,
    });
    expect(result.weeklyRevenue[51].rangeLabel).toBe('Sep 14, 2026 – Sep 20, 2026');
    expect(result.weeklyRevenue.reduce((sum, week) => sum + week.value, 0)).toBe(90);
    expect(result.dayOfWeek.reduce((sum, day) => sum + day.orders, 0)).toBe(5);
  });

  it('includes exactly 12 current-inclusive months and excludes adjacent months', () => {
    const result = getSalesTimeSeries([
      order('2025-10-01 04:59:59', 10), // Still September Central, before the range
      order('2025-10-01 05:00:00', 20), // October midnight, first displayed month
      order('2026-01-01 06:00:00', 30), // January midnight Central
      order('2026-09-16 12:00:00', 40),
      order('2026-10-01 05:00:00', 50), // Following month, outside the range
    ], new Date('2026-09-16T17:00:00Z'));

    expect(result.monthlyRevenue).toHaveLength(12);
    expect(result.monthlyRevenue[0]).toEqual({ label: 'Oct 25', value: 20 });
    expect(result.monthlyRevenue[3]).toEqual({ label: 'Jan 26', value: 30 });
    expect(result.monthlyRevenue[11]).toEqual({ label: 'Sep 26', value: 40 });
    expect(result.monthlyRevenue.reduce((sum, month) => sum + month.value, 0)).toBe(90);
    expect(result.dayOfWeek.reduce((sum, day) => sum + day.orders, 0)).toBe(5);
  });

  it('does not mutate orders or the supplied current date', () => {
    const original = Object.freeze(order('2026-09-16 12:00:00', 12));
    const orders = Object.freeze([original]);
    const now = new Date('2026-09-16T17:00:00Z');

    getSalesTimeSeries(orders, now);

    expect(orders).toEqual([order('2026-09-16 12:00:00', 12)]);
    expect(now.toISOString()).toBe('2026-09-16T17:00:00.000Z');
  });
});
