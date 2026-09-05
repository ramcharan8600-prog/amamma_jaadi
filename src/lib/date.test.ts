import { describe, it, expect } from 'vitest';
import {
  businessDateOffset,
  businessDateUtcRange,
  d1TimestampToBusinessDate,
  formatPickupDate,
  toBusinessDateString,
} from './date';

describe('formatPickupDate', () => {
  it('formats a stored YYYY-MM-DD as a readable date', () => {
    expect(formatPickupDate('2026-07-26')).toBe('Sunday, July 26, 2026');
  });

  it('does not drift a day in behind-UTC timezones', () => {
    // Regression: `new Date('2026-01-01')` is UTC midnight; formatting it in
    // US Central would otherwise render Dec 31.
    expect(formatPickupDate('2026-01-01')).toBe('Thursday, January 1, 2026');
  });

  it('passes through empty or malformed input', () => {
    expect(formatPickupDate('')).toBe('');
    expect(formatPickupDate('not-a-date')).toBe('not-a-date');
  });
});

describe('business-timezone date helpers', () => {
  it('formats a date as YYYY-MM-DD', () => {
    // Noon UTC is the same calendar day in US Central — stable to format.
    const d = new Date('2026-06-18T12:00:00Z');
    expect(toBusinessDateString(d)).toBe('2026-06-18');
  });

  it('resolves to the previous day for early-UTC times (Central is behind UTC)', () => {
    // 02:00 UTC on Jun 18 is still Jun 17 in US Central.
    const d = new Date('2026-06-18T02:00:00Z');
    expect(toBusinessDateString(d)).toBe('2026-06-17');
  });

  it('businessDateOffset(0) equals today in business tz', () => {
    expect(businessDateOffset(0)).toBe(toBusinessDateString(new Date()));
  });

  it('businessDateOffset advances by whole days', () => {
    const today = businessDateOffset(0);
    const inTwo = businessDateOffset(2);
    const diffDays =
      (Date.parse(inTwo) - Date.parse(today)) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(2);
  });

  it('returns a valid ISO-like date string', () => {
    expect(businessDateOffset(5)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('converts D1 UTC timestamps to the Central calendar date', () => {
    expect(d1TimestampToBusinessDate('2026-09-06 02:30:00')).toBe('2026-09-05');
    expect(d1TimestampToBusinessDate('2026-09-06T05:30:00Z')).toBe('2026-09-06');
  });

  it('returns an empty date for an invalid D1 timestamp', () => {
    expect(d1TimestampToBusinessDate('not-a-timestamp')).toBe('');
  });

  it('creates summer and winter UTC boundaries for Central calendar dates', () => {
    expect(businessDateUtcRange('2026-09-05')).toEqual({
      start: '2026-09-05 05:00:00',
      end: '2026-09-06 05:00:00',
    });
    expect(businessDateUtcRange('2026-01-05')).toEqual({
      start: '2026-01-05 06:00:00',
      end: '2026-01-06 06:00:00',
    });
  });

  it('handles 23-hour and 25-hour daylight-saving days', () => {
    expect(businessDateUtcRange('2026-03-08')).toEqual({
      start: '2026-03-08 06:00:00',
      end: '2026-03-09 05:00:00',
    });
    expect(businessDateUtcRange('2026-11-01')).toEqual({
      start: '2026-11-01 05:00:00',
      end: '2026-11-02 06:00:00',
    });
  });

  it('rejects impossible calendar dates', () => {
    expect(businessDateUtcRange('2026-02-30')).toBeNull();
    expect(businessDateUtcRange('bad-date')).toBeNull();
  });
});
