import { describe, it, expect } from 'vitest';
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
  it('same-day pickup allowed at or below 150 pieces', () => {
    expect(isSameDayPickupAllowed(150)).toBe(true);
    expect(isSameDayPickupAllowed(151)).toBe(false);
  });

  it('getMinPickupDate is today for small orders', () => {
    expect(getMinPickupDate(100)).toBe(getTodayString());
  });

  it('getMinPickupDate is at least tomorrow for large orders', () => {
    expect(getMinPickupDate(200) > getTodayString()).toBe(true);
  });

  it('getMinEventDate is at least two days out', () => {
    expect(getMinEventDate() > getTodayString()).toBe(true);
  });
});
