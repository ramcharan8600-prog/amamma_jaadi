import { describe, it, expect } from 'vitest';
import { formatPickupDate } from './date';

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
import { toBusinessDateString, businessDateOffset } from '@/lib/date';

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
});
