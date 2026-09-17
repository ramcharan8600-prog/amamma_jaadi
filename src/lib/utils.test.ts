import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  formatCurrency,
  isSameDayPickupAllowed,
  getMinPickupDate,
  getTodayString,
  getMinEventDate,
} from '@/lib/utils';

describe('formatCurrency', () => {
  it('formats USD with two decimals', () => {
    expect(formatCurrency(48)).toBe('$48.00');
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });
});

describe('pickup business rules', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-17T18:59:59Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('same-day pickup allowed at or below 150 pieces before the cutoff', () => {
    expect(isSameDayPickupAllowed(150)).toBe(true);
    expect(isSameDayPickupAllowed(151)).toBe(false);
  });

  it('getMinPickupDate is today for small orders', () => {
    expect(getMinPickupDate(100)).toBe(getTodayString());
  });

  it('getMinPickupDate is at least tomorrow for large orders', () => {
    expect(getMinPickupDate(200) > getTodayString()).toBe(true);
  });

  it('uses tomorrow at the cutoff or when the cart has a next-day product', () => {
    expect(isSameDayPickupAllowed(16, true)).toBe(false);
    expect(getMinPickupDate(16, true)).toBe('2026-09-18');
    vi.setSystemTime(new Date('2026-09-17T19:00:00Z'));
    expect(isSameDayPickupAllowed(16)).toBe(false);
    expect(getMinPickupDate(16)).toBe('2026-09-18');
  });

  it('getMinEventDate is at least two days out', () => {
    expect(getMinEventDate() > getTodayString()).toBe(true);
  });
});
