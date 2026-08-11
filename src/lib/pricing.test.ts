import { describe, it, expect } from 'vitest';
import {
  calculateOrderTotals,
  roundMoney,
  SALES_TAX_RATE,
  SALES_TAX_LABEL,
} from './pricing';

describe('pricing — Texas sales tax on the taxable portion only', () => {
  it('uses the 8.25% Texas rate', () => {
    expect(SALES_TAX_RATE).toBe(0.0825);
    expect(SALES_TAX_LABEL).toBe('Sales Tax (8.25%)');
  });

  it('charges NO tax on an all-exempt order (bakery items)', () => {
    // $40 of sweets → nothing taxable.
    expect(calculateOrderTotals(40, { taxableSubtotal: 0 })).toEqual({
      subtotal: 40,
      tax: 0,
      shipping: 0,
      total: 40,
    });
  });

  it('taxes a fully taxable order (pickles only)', () => {
    // $14 chicken pickle → 14 * 0.0825 = 1.155 → 1.16
    expect(calculateOrderTotals(14, { taxableSubtotal: 14 })).toEqual({
      subtotal: 14,
      tax: 1.16,
      shipping: 0,
      total: 15.16,
    });
  });

  it('taxes only the taxable share of a MIXED order', () => {
    // $40 sweets (exempt) + $14 pickle (taxable) = $54 subtotal, tax on $14.
    expect(calculateOrderTotals(54, { taxableSubtotal: 14 })).toEqual({
      subtotal: 54,
      tax: 1.16,
      shipping: 0,
      total: 55.16,
    });
  });

  it('treats the whole subtotal as taxable when not told otherwise', () => {
    expect(calculateOrderTotals(100).tax).toBe(8.25);
  });

  it('never taxes more than the subtotal, even on bad input', () => {
    expect(calculateOrderTotals(10, { taxableSubtotal: 999 }).tax).toBe(roundMoney(10 * 0.0825));
    expect(calculateOrderTotals(10, { taxableSubtotal: -5 }).tax).toBe(0);
  });

  it('charges a $4 delivery fee on delivery orders below $50, tax-free goods included', () => {
    expect(calculateOrderTotals(30, { fulfillmentType: 'delivery', taxableSubtotal: 0 })).toEqual({
      subtotal: 30,
      tax: 0,
      shipping: 4,
      total: 34,
    });
  });

  it('does not tax the delivery fee', () => {
    // $30 taxable goods + $4 shipping → tax is on 30, not 34.
    const t = calculateOrderTotals(30, { fulfillmentType: 'delivery', taxableSubtotal: 30 });
    expect(t.tax).toBe(roundMoney(30 * 0.0825));
    expect(t.total).toBe(roundMoney(30 + t.tax + 4));
  });

  it('does NOT charge shipping for pickup, even below $50', () => {
    expect(calculateOrderTotals(30, { fulfillmentType: 'pickup' }).shipping).toBe(0);
  });

  it('ships free at exactly the $50 threshold for delivery', () => {
    expect(calculateOrderTotals(50, { fulfillmentType: 'delivery' }).shipping).toBe(0);
    expect(calculateOrderTotals(49.99, { fulfillmentType: 'delivery' }).shipping).toBe(4);
  });

  it('subtotal + tax + shipping always equals total exactly (no float dust)', () => {
    for (const s of [2.5, 5, 14, 16, 30, 37.5, 49.99, 123.45, 999.99]) {
      const { subtotal, tax, shipping, total } = calculateOrderTotals(s, { fulfillmentType: 'delivery' });
      expect(roundMoney(subtotal + tax + shipping)).toBe(total);
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
    expect(calculateOrderTotals(0)).toEqual({ subtotal: 0, tax: 0, shipping: 0, total: 0 });
    expect(calculateOrderTotals(-5)).toEqual({ subtotal: 0, tax: 0, shipping: 0, total: 0 });
    expect(calculateOrderTotals(NaN as unknown as number)).toEqual({
      subtotal: 0,
      tax: 0,
      shipping: 0,
      total: 0,
    });
  });

  it('rounds half up to the nearest cent', () => {
    expect(roundMoney(1.155)).toBe(1.16);
    expect(roundMoney(0.005)).toBe(0.01);
    expect(roundMoney(2.674999)).toBe(2.67);
  });
});
