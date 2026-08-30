import { describe, it, expect } from 'vitest';
import {
  calculateOrderTotals,
  pickleDeliveryFee,
  roundMoney,
  isTexas,
  SALES_TAX_RATE,
  SALES_TAX_LABEL,
} from './pricing';

describe('pricing — Texas sales tax on the taxable portion only', () => {
  it('uses the 8.25% Texas rate', () => {
    expect(SALES_TAX_RATE).toBe(0.0825);
    expect(SALES_TAX_LABEL).toBe('Sales Tax (8.25%)');
  });

  it('charges NO tax on an all-exempt order (bakery items)', () => {
    expect(calculateOrderTotals(40, { taxableSubtotal: 0 })).toEqual({
      subtotal: 40,
      tax: 0,
      shipping: 0,
      total: 40,
    });
  });

  it('taxes a fully taxable order (pickles only)', () => {
    expect(calculateOrderTotals(14, { taxableSubtotal: 14 })).toEqual({
      subtotal: 14,
      tax: 1.16,
      shipping: 0,
      total: 15.16,
    });
  });

  it('taxes only the taxable share of a MIXED order', () => {
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
});

describe('isTexas helper', () => {
  it('recognises TX in any case', () => {
    expect(isTexas('TX')).toBe(true);
    expect(isTexas('tx')).toBe(true);
    expect(isTexas('Tx')).toBe(true);
    expect(isTexas(' TX ')).toBe(true);
  });
  it('rejects non-Texas states', () => {
    expect(isTexas('NY')).toBe(false);
    expect(isTexas('CA')).toBe(false);
    expect(isTexas('')).toBe(false);
    expect(isTexas(undefined)).toBe(false);
    expect(isTexas(null)).toBe(false);
  });
});

describe('pricing — Texas delivery (in-state)', () => {
  const TX = { deliveryState: 'TX' };

  it('charges $4.99 on TX delivery under $60', () => {
    expect(
      calculateOrderTotals(30, { fulfillmentType: 'delivery', taxableSubtotal: 0, ...TX })
    ).toEqual({ subtotal: 30, tax: 0, shipping: 4.99, total: 34.99 });
  });

  it('ships free at exactly the $60 threshold for TX delivery', () => {
    expect(
      calculateOrderTotals(60, { fulfillmentType: 'delivery', ...TX }).shipping
    ).toBe(0);
  });

  it('ships free above $60 for TX delivery', () => {
    expect(
      calculateOrderTotals(75, { fulfillmentType: 'delivery', ...TX }).shipping
    ).toBe(0);
  });

  it('charges $4.99 at $59.99 for TX delivery', () => {
    expect(
      calculateOrderTotals(59.99, { fulfillmentType: 'delivery', ...TX }).shipping
    ).toBe(4.99);
  });

  it('charges the pickle delivery scale by jar count (TX, under $60)', () => {
    // 1 jar $14 → $8 delivery (exceeds $4.99 base).
    const one = calculateOrderTotals(14, {
      fulfillmentType: 'delivery', taxableSubtotal: 14, pickleJars: 1, ...TX,
    });
    expect(one).toEqual({ subtotal: 14, tax: 1.16, shipping: 8, total: 23.16 });

    // 2 jars $28 → $7 delivery (exceeds $4.99 base).
    const two = calculateOrderTotals(28, {
      fulfillmentType: 'delivery', taxableSubtotal: 28, pickleJars: 2, ...TX,
    });
    expect(two).toEqual({ subtotal: 28, tax: 2.31, shipping: 7, total: 37.31 });

    // 3 jars $42 → $4.99 base delivery (table value matches base).
    const three = calculateOrderTotals(42, {
      fulfillmentType: 'delivery', taxableSubtotal: 42, pickleJars: 3, ...TX,
    });
    expect(three).toEqual({ subtotal: 42, tax: 3.47, shipping: 4.99, total: 50.46 });
  });

  it('4+ jars at $60+ ship free in TX', () => {
    expect(
      calculateOrderTotals(70, { fulfillmentType: 'delivery', taxableSubtotal: 70, pickleJars: 5, ...TX }).shipping
    ).toBe(0);
  });

  it('a mixed cart under $60 in TX pays the flat $4.99 base', () => {
    const mixed = calculateOrderTotals(44, {
      fulfillmentType: 'delivery', taxableSubtotal: 14, pickleJars: 1, ...TX,
    });
    expect(mixed.shipping).toBe(4.99);
    expect(mixed.tax).toBe(1.16);
    expect(mixed.total).toBe(roundMoney(44 + 1.16 + 4.99));
  });

  it('never charges less than the TX base fee, whatever the jar count', () => {
    for (const jars of [0, 1, 2, 3, 4, 10]) {
      const { shipping } = calculateOrderTotals(30, { fulfillmentType: 'delivery', pickleJars: jars, ...TX });
      expect(shipping).toBeGreaterThanOrEqual(4.99);
    }
  });

  it('sweets-only under $60 pays $4.99 in TX', () => {
    expect(
      calculateOrderTotals(30, { fulfillmentType: 'delivery', taxableSubtotal: 0, pickleJars: 0, ...TX }).shipping
    ).toBe(4.99);
  });
});

describe('pricing — out-of-state delivery', () => {
  const NY = { deliveryState: 'NY' };

  it('charges $6.99 on out-of-state delivery under $60', () => {
    expect(
      calculateOrderTotals(30, { fulfillmentType: 'delivery', taxableSubtotal: 0, ...NY })
    ).toEqual({ subtotal: 30, tax: 0, shipping: 6.99, total: 36.99 });
  });

  it('charges $2.99 on out-of-state delivery at $60+', () => {
    expect(
      calculateOrderTotals(60, { fulfillmentType: 'delivery', ...NY }).shipping
    ).toBe(2.99);
    expect(
      calculateOrderTotals(100, { fulfillmentType: 'delivery', ...NY }).shipping
    ).toBe(2.99);
  });

  it('charges $6.99 at $59.99 out-of-state', () => {
    expect(
      calculateOrderTotals(59.99, { fulfillmentType: 'delivery', ...NY }).shipping
    ).toBe(6.99);
  });

  it('out-of-state pickle jars do not use the jar scale (flat fee)', () => {
    const result = calculateOrderTotals(14, {
      fulfillmentType: 'delivery', taxableSubtotal: 14, pickleJars: 1, ...NY,
    });
    expect(result.shipping).toBe(6.99);
  });
});

describe('pricing — no deliveryState defaults to out-of-state', () => {
  it('no state → out-of-state fees apply', () => {
    expect(
      calculateOrderTotals(30, { fulfillmentType: 'delivery' }).shipping
    ).toBe(6.99);
    expect(
      calculateOrderTotals(70, { fulfillmentType: 'delivery' }).shipping
    ).toBe(2.99);
  });
});

describe('pricing — pickup and general', () => {
  it('does NOT charge shipping for pickup, even below $60', () => {
    expect(calculateOrderTotals(30, { fulfillmentType: 'pickup' }).shipping).toBe(0);
  });

  it('pickle jars never add a fee to a PICKUP order', () => {
    expect(
      calculateOrderTotals(14, { fulfillmentType: 'pickup', pickleJars: 3 }).shipping
    ).toBe(0);
  });

  it('does not tax the delivery fee', () => {
    const t = calculateOrderTotals(30, { fulfillmentType: 'delivery', taxableSubtotal: 30, deliveryState: 'TX' });
    expect(t.tax).toBe(roundMoney(30 * 0.0825));
    expect(t.total).toBe(roundMoney(30 + t.tax + 4.99));
  });

  it('pickleDeliveryFee: 0 jars is free, beyond the table uses the cheapest tier', () => {
    expect(pickleDeliveryFee(0)).toBe(0);
    expect(pickleDeliveryFee(1)).toBe(8);
    expect(pickleDeliveryFee(2)).toBe(7);
    expect(pickleDeliveryFee(3)).toBe(4.99);
    expect(pickleDeliveryFee(9)).toBe(4.99);
    expect(pickleDeliveryFee(-2)).toBe(0);
  });

  it('subtotal + tax + shipping always equals total exactly (no float dust)', () => {
    for (const s of [2.5, 5, 14, 16, 30, 37.5, 49.99, 123.45, 999.99]) {
      const { subtotal, tax, shipping, total } = calculateOrderTotals(s, { fulfillmentType: 'delivery', deliveryState: 'TX' });
      expect(roundMoney(subtotal + tax + shipping)).toBe(total);
    }
    for (const s of [2.5, 14, 30, 49.99, 123.45]) {
      const { subtotal, tax, shipping, total } = calculateOrderTotals(s, { fulfillmentType: 'delivery', deliveryState: 'NY' });
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
      subtotal: 0, tax: 0, shipping: 0, total: 0,
    });
  });

  it('rounds half up to the nearest cent', () => {
    expect(roundMoney(1.155)).toBe(1.16);
    expect(roundMoney(0.005)).toBe(0.01);
    expect(roundMoney(2.674999)).toBe(2.67);
  });
});
