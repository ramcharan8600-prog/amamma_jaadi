import { describe, expect, it } from 'vitest';
import { getSalesTimeSeries, REVENUE_YEARS } from './sales-analytics';

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
  it('starts 2026 in July with zero-filled periods through December', () => {
    const result = getSalesTimeSeries([], 2026);

    expect(REVENUE_YEARS).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
    expect(result.weeklyRevenue).toHaveLength(27);
    expect(result.weeklyRevenue[0]).toEqual({
      label: 'Jul 1', rangeLabel: 'Jul 1, 2026 – Jul 5, 2026', value: 0,
    });
    expect(result.weeklyRevenue[26]).toEqual({
      label: 'Dec 28', rangeLabel: 'Dec 28, 2026 – Dec 31, 2026', value: 0,
    });
    expect(result.monthlyRevenue).toEqual(
      ['Jul 26', 'Aug 26', 'Sep 26', 'Oct 26', 'Nov 26', 'Dec 26']
        .map((label) => ({ label, value: 0 }))
    );
    expect(result.weeklyRevenue.every((week) => week.value === 0)).toBe(true);
    expect(result.dayOfWeek).toEqual(
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => ({ day, orders: 0 }))
    );
  });

  it('clips 2026 revenue to July 1 through December 31 in Central time', () => {
    const result = getSalesTimeSeries([
      order('2026-07-01 04:59:59', 11), // June 30 Central, outside the range
      order('2026-07-01 05:00:00', 20), // July 1 midnight Central
      order('2027-01-01 05:59:59', 30), // December 31 Central
      order('2027-01-01 06:00:00', 40), // January 1 Central, outside the range
    ], 2026);

    expect(result.weeklyRevenue[0].value).toBe(20);
    expect(result.weeklyRevenue[26].value).toBe(30);
    expect(result.monthlyRevenue[0]).toEqual({ label: 'Jul 26', value: 20 });
    expect(result.monthlyRevenue[5]).toEqual({ label: 'Dec 26', value: 30 });
    expect(result.weeklyRevenue.reduce((sum, week) => sum + week.value, 0)).toBe(50);
    expect(result.dayOfWeek.reduce((sum, day) => sum + day.orders, 0)).toBe(4);
  });

  it('uses Monday–Sunday weeks after the first partial week', () => {
    const result = getSalesTimeSeries([
      order('2026-07-06 04:59:59', 11), // Sunday 11:59:59 PM Central
      order('2026-07-06 05:00:00', 20), // Monday midnight Central
      order('2026-07-08 12:00:00', 30),
    ], 2026);

    expect(result.weeklyRevenue[0].value).toBe(11);
    expect(result.weeklyRevenue[1]).toEqual({
      label: 'Jul 6', rangeLabel: 'Jul 6, 2026 – Jul 12, 2026', value: 50,
    });
    expect(result.dayOfWeek[0].orders).toBe(1);
    expect(result.dayOfWeek[1].orders).toBe(1);
    expect(result.dayOfWeek[3].orders).toBe(1);
  });

  it('separates adjacent calendar years even when they share the same week', () => {
    const orders = [
      order('2027-01-01 05:59:59', 10), // December 31, 2026 Central
      order('2027-01-01 06:00:00', 20), // January 1, 2027 Central
      order('2028-01-01 05:59:59', 30), // December 31, 2027 Central
      order('2028-01-01 06:00:00', 40), // January 1, 2028 Central
    ];
    const result = getSalesTimeSeries(orders, 2027);

    expect(result.weeklyRevenue[0]).toEqual({
      label: 'Jan 1', rangeLabel: 'Jan 1, 2027 – Jan 3, 2027', value: 20,
    });
    expect(result.weeklyRevenue.at(-1)).toEqual({
      label: 'Dec 27', rangeLabel: 'Dec 27, 2027 – Dec 31, 2027', value: 30,
    });
    expect(result.monthlyRevenue[0]).toEqual({ label: 'Jan 27', value: 20 });
    expect(result.monthlyRevenue[11]).toEqual({ label: 'Dec 27', value: 30 });
    expect(result.weeklyRevenue.reduce((sum, week) => sum + week.value, 0)).toBe(50);
    expect(getSalesTimeSeries(orders, 2026).monthlyRevenue.at(-1)?.value).toBe(10);
    expect(getSalesTimeSeries(orders, 2028).monthlyRevenue[0].value).toBe(40);
  });

  it.each(REVENUE_YEARS)('counts every in-range day in %i once in both revenue charts', (year) => {
    const firstMonth = year === 2026 ? 6 : 0;
    const start = Date.UTC(year, firstMonth, 1, 12);
    const end = Date.UTC(year + 1, 0, 1, 12);
    const days = (end - start) / 86_400_000;
    const orders = Array.from({ length: days }, (_, index) => (
      order(new Date(start + index * 86_400_000).toISOString(), 1)
    ));
    const result = getSalesTimeSeries(orders, year);

    expect(result.weeklyRevenue.reduce((sum, week) => sum + week.value, 0)).toBe(days);
    expect(result.monthlyRevenue.reduce((sum, month) => sum + month.value, 0)).toBe(days);
    expect(result.dayOfWeek.reduce((sum, day) => sum + day.orders, 0)).toBe(days);
    expect(result.weeklyRevenue.slice(1, -1).every((week) => week.value === 7)).toBe(true);
    if (year === 2028) {
      expect(result.monthlyRevenue[1]).toEqual({ label: 'Feb 28', value: 29 });
      expect(days).toBe(366);
    }
  });

  it.each(REVENUE_YEARS.slice(1))('shows all twelve empty months for %i', (year) => {
    const result = getSalesTimeSeries([], year);

    expect(result.weeklyRevenue).toHaveLength(53);
    expect(result.monthlyRevenue).toHaveLength(12);
    expect(result.monthlyRevenue[0].label).toBe(`Jan ${year % 100}`);
    expect(result.monthlyRevenue[11].label).toBe(`Dec ${year % 100}`);
    expect(result.weeklyRevenue.every((week) => week.value === 0)).toBe(true);
    expect(result.monthlyRevenue.every((month) => month.value === 0)).toBe(true);
  });

  it('normalizes raw D1 and equivalent ISO timestamps to the same business day', () => {
    const result = getSalesTimeSeries([
      order('2026-09-01 02:30:00', 10),
      order('2026-09-01T02:30:00Z', 20),
      order('2026-09-01T02:30:00.000', 30),
      order('2026-08-31T21:30:00-05:00', 40),
      order('2026-09-01 05:00:00', 50),
    ], 2026);

    expect(result.monthlyRevenue[1]).toEqual({ label: 'Aug 26', value: 100 });
    expect(result.monthlyRevenue[2]).toEqual({ label: 'Sep 26', value: 50 });
    expect(result.dayOfWeek[1].orders).toBe(4);
    expect(result.dayOfWeek[2].orders).toBe(1);
  });

  it('keeps week boundaries correct across the spring DST transition', () => {
    const result = getSalesTimeSeries([
      order('2027-03-14 07:30:00', 10), // Sunday before the clock change
      order('2027-03-14 08:30:00', 20), // Sunday after the clock change
      order('2027-03-15 04:59:59', 30), // Sunday 11:59:59 PM Central
      order('2027-03-15 05:00:00', 40), // Monday midnight Central
    ], 2027);

    expect(result.weeklyRevenue.find((week) => week.label === 'Mar 8')?.value).toBe(60);
    expect(result.weeklyRevenue.find((week) => week.label === 'Mar 15')?.value).toBe(40);
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
    ], 2026);

    expect(result.weeklyRevenue.find((week) => week.label === 'Sep 14')?.value).toBe(31.48);
    expect(result.monthlyRevenue[2].value).toBe(31.48);
    expect(result.dayOfWeek[3].orders).toBe(3);
  });

  it('ignores malformed timestamps without losing valid orders or producing NaN', () => {
    const result = getSalesTimeSeries([
      order('not-a-date', 100),
      order('', 100),
      order('2026-99-99 99:99:99', 100),
      order('2026-09-16 12:00:00', 9.99),
    ], 2026);

    expect(result.weeklyRevenue.find((week) => week.label === 'Sep 14')?.value).toBe(9.99);
    expect(result.monthlyRevenue[2].value).toBe(9.99);
    expect(result.dayOfWeek.reduce((sum, day) => sum + day.orders, 0)).toBe(1);
  });

  it('keeps weekday counts independent of the selected revenue year', () => {
    const orders = [
      order('2026-06-30 12:00:00'),
      order('2026-09-16 12:00:00'),
      order('2027-07-01 12:00:00'),
    ];

    const current = getSalesTimeSeries(orders, 2026);
    const future = getSalesTimeSeries(orders, 2031);

    expect(current.dayOfWeek).toEqual(future.dayOfWeek);
    expect(current.dayOfWeek.reduce((sum, day) => sum + day.orders, 0)).toBe(3);
    expect(future.weeklyRevenue.every((week) => week.value === 0)).toBe(true);
    expect(future.monthlyRevenue.every((month) => month.value === 0)).toBe(true);
  });

  it.each([2025, 2032, 2026.5, NaN, Infinity])('rejects unsupported year %s', (year) => {
    expect(() => getSalesTimeSeries([], year)).toThrow(RangeError);
  });

  it('does not mutate the supplied orders', () => {
    const original = Object.freeze(order('2026-09-16 12:00:00', 12));
    const orders = Object.freeze([original]);

    getSalesTimeSeries(orders, 2026);

    expect(orders).toEqual([order('2026-09-16 12:00:00', 12)]);
  });
});
