import { describe, it, expect } from 'vitest';
import {
  calculateOrderTotals,
  roundMoney,
  SALES_TAX_RATE,
  SALES_TAX_LABEL,
} from './pricing';

describe('pricing — Texas sales tax', () => {
  it('uses the 8.25% Texas rate', () => {
    expect(SALES_TAX_RATE).toBe(0.0825);
    expect(SALES_TAX_LABEL).toBe('Sales Tax (8.25%)');
  });

  it('adds 8.25% on top of the subtotal', () => {
    // $14.00 chicken pickle → 14 * 0.0825 = 1.155 → rounds to 1.16
    expect(calculateOrderTotals(14)).toEqual({ subtotal: 14, tax: 1.16, total: 15.16 });
  });

  it('handles a clean round case', () => {
    // $100 → exactly $8.25 tax
    expect(calculateOrderTotals(100)).toEqual({ subtotal: 100, tax: 8.25, total: 108.25 });
  });

  it('subtotal + tax always equals total exactly (no float dust)', () => {
    for (const s of [2.5, 5, 14, 16, 30, 37.5, 49.99, 123.45, 999.99]) {
      const { subtotal, tax, total } = calculateOrderTotals(s);
      expect(roundMoney(subtotal + tax)).toBe(total);
    }
  });

  it('never returns fractional cents', () => {
    for (const s of [2.5, 14, 33.33, 66.67, 87.77]) {
      const { tax, total } = calculateOrderTotals(s);
      expect(Number.isInteger(Math.round(tax * 100))).toBe(true);
      expect(tax * 100).toBeCloseTo(Math.round(tax * 100), 9);
      expect(total * 100).toBeCloseTo(Math.round(total * 100), 9);
    }
  });

  it('coerces junk and negatives to a zero order', () => {
    expect(calculateOrderTotals(0)).toEqual({ subtotal: 0, tax: 0, total: 0 });
    expect(calculateOrderTotals(-5)).toEqual({ subtotal: 0, tax: 0, total: 0 });
    expect(calculateOrderTotals(NaN as unknown as number)).toEqual({
      subtotal: 0,
      tax: 0,
      total: 0,
    });
  });

  it('rounds half up to the nearest cent', () => {
    expect(roundMoney(1.155)).toBe(1.16);
    expect(roundMoney(0.005)).toBe(0.01);
    expect(roundMoney(2.674999)).toBe(2.67);
  });
});
