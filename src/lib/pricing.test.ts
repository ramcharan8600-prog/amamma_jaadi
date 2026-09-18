import { describe, it, expect } from 'vitest';
import {
  calculateOrderTotals,
  DELIVERY_STATE_OPTIONS,
  roundMoney,
  isTexas,
  getShippingZone,
  getDeliveryMinimumSubtotal,
  getDeliveryMinimumShortfall,
  isSupportedDeliveryState,
  normalizeStateCode,
  shippingMethodLabel,
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

  it('charges a flat $6.99 on TX delivery under $60', () => {
    expect(
      calculateOrderTotals(30, { fulfillmentType: 'delivery', taxableSubtotal: 0, ...TX })
    ).toEqual({ subtotal: 30, tax: 0, shipping: 6.99, total: 36.99 });
  });

  it('charges the same $6.99 at and above $60', () => {
    expect(
      calculateOrderTotals(60, { fulfillmentType: 'delivery', ...TX }).shipping
    ).toBe(6.99);
    expect(calculateOrderTotals(75, { fulfillmentType: 'delivery', ...TX }).shipping)
      .toBe(6.99);
  });

  it('a mixed cart taxes pickles and the full TX shipping fee', () => {
    const mixed = calculateOrderTotals(44, {
      fulfillmentType: 'delivery', taxableSubtotal: 14, ...TX,
    });
    expect(mixed.shipping).toBe(6.99);
    expect(mixed.tax).toBe(1.73);
    expect(mixed.total).toBe(roundMoney(44 + 1.73 + 6.99));
  });
});

describe('pricing — nearby-state delivery', () => {
  for (const deliveryState of ['AL', 'AR', 'CO', 'LA', 'NM', 'OK']) {
    it(`${deliveryState}: $11.99 below $60 and $8.99 at $60+`, () => {
      expect(calculateOrderTotals(59.99, { fulfillmentType: 'delivery', deliveryState }).shipping)
        .toBe(11.99);
      expect(calculateOrderTotals(60, { fulfillmentType: 'delivery', deliveryState }).shipping)
        .toBe(8.99);
    });
  }
});

describe('pricing — far-state delivery', () => {
  const NY = { deliveryState: 'NY' };

  it('charges a flat $11.99 shipping fee', () => {
    expect(calculateOrderTotals(80, { fulfillmentType: 'delivery', ...NY }).shipping)
      .toBe(11.99);
    expect(calculateOrderTotals(100, { fulfillmentType: 'delivery', ...NY }).shipping)
      .toBe(11.99);
  });

  it('requires an $80 merchandise subtotal', () => {
    expect(getDeliveryMinimumSubtotal('NY')).toBe(80);
    expect(getDeliveryMinimumShortfall(40, 'NY')).toBe(40);
    expect(getDeliveryMinimumShortfall(79.99, 'NY')).toBe(0.01);
    expect(getDeliveryMinimumShortfall(80, 'NY')).toBe(0);
    expect(getDeliveryMinimumShortfall(100, 'NY')).toBe(0);
    expect(getDeliveryMinimumSubtotal('TX')).toBe(0);
    expect(getDeliveryMinimumSubtotal('AL')).toBe(0);
    expect(getDeliveryMinimumSubtotal('OK')).toBe(0);
  });

  it('classifies named examples as far states', () => {
    for (const state of ['NY', 'DE', 'MA', 'WA', 'DC', 'NC', 'IL', 'MI', 'MO']) {
      expect(getShippingZone(state)).toBe('far');
    }
  });
});

describe('delivery-state validation', () => {
  it('offers every contiguous state plus DC exactly once', () => {
    const codes = DELIVERY_STATE_OPTIONS.map(({ code }) => code);
    expect(codes).toEqual([
      'AL', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA',
      'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA',
      'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
      'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD',
      'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
    ]);
    expect(new Set(codes).size).toBe(49);
    expect(codes.every((code) => isSupportedDeliveryState(code))).toBe(true);
    for (const excluded of ['AK', 'HI', 'PR', 'VI', 'TE', 'TC']) {
      expect(codes).not.toContain(excluded);
    }
    expect(codes.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
  });

  it('rejects full names, state typos, empty values and malformed input', () => {
    for (const state of [
      'T', 'Tex', 'Texas', 'TE', 'TC', 'Not a state', '', '   ', undefined, null, 42, {}, [],
    ]) {
      expect(isSupportedDeliveryState(state)).toBe(false);
    }
  });

  it('normalizes valid code casing and safely handles non-text API input', () => {
    expect(normalizeStateCode(' tx ')).toBe('TX');
    expect(normalizeStateCode(42)).toBe('');
    expect(normalizeStateCode({ state: 'TX' })).toBe('');
  });

  it('accepts all configured contiguous destinations and DC', () => {
    for (const state of ['TX', 'OK', 'CA', 'NY', 'DC']) {
      expect(isSupportedDeliveryState(state)).toBe(true);
    }
  });

  it('does not allow Alaska, Hawaii, territories or arbitrary input', () => {
    for (const state of ['AK', 'HI', 'PR', 'XX', '', undefined]) {
      expect(isSupportedDeliveryState(state)).toBe(false);
    }
  });
});

describe('pricing — pickup and general', () => {
  it('identifies the standard shipping service consistently', () => {
    expect(shippingMethodLabel('standard')).toBe('UPS 2nd Day Air');
    expect(shippingMethodLabel(undefined)).toBe('UPS 2nd Day Air');
    expect(shippingMethodLabel('standard', true)).toBe('Standard shipping');
    expect(shippingMethodLabel(undefined, true)).toBe('Standard shipping');
    expect(shippingMethodLabel(null, true)).toBe('Standard shipping');
    expect(shippingMethodLabel('ground', true)).toBe('Ground — estimated 2–5 business days in transit');
    expect(shippingMethodLabel('expedited', true)).toBe('Expedited — estimated 2 business days in transit');
  });

  it('does NOT charge shipping for pickup, even below $60', () => {
    expect(calculateOrderTotals(30, { fulfillmentType: 'pickup' }).shipping).toBe(0);
  });

  it('pickup remains free regardless of the merchandise subtotal', () => {
    expect(
      calculateOrderTotals(14, { fulfillmentType: 'pickup' }).shipping
    ).toBe(0);
  });

  it('taxes the delivery fee when Texas merchandise is taxable', () => {
    const t = calculateOrderTotals(30, { fulfillmentType: 'delivery', taxableSubtotal: 30, deliveryState: 'TX' });
    expect(t.tax).toBe(roundMoney((30 + 6.99) * 0.0825));
    expect(t.total).toBe(roundMoney(30 + t.tax + 6.99));
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


describe('approved Texas mixed-cart policy', () => {
  it.each([
    [19, 19, true, 6.99, 2.14, 28.13],
    [30, 0, false, 6.99, 0, 36.99],
    [49, 19, false, 6.99, 2.14, 58.13],
  ])('prices subtotal %s with taxable subtotal %s', (subtotal, taxableSubtotal, picklesOnly, shipping, tax, total) => {
    expect(calculateOrderTotals(subtotal, {fulfillmentType: 'delivery', deliveryState: 'TX', taxableSubtotal, picklesOnly}))
      .toEqual({subtotal, shipping, tax, total});
  });
  it('removes shipping and its tax for mixed pickup', () => {
    expect(calculateOrderTotals(49, {fulfillmentType: 'pickup', taxableSubtotal: 19}))
      .toEqual({subtotal: 49, shipping: 0, tax: 1.57, total: 50.57});
  });
  it('preserves the out-of-state tax base with the new pickle rate', () => {
    expect(calculateOrderTotals(95, {fulfillmentType: 'delivery', deliveryState: 'CA', taxableSubtotal: 95, picklesOnly: true, pickleJarCount: 5}))
      .toEqual({subtotal: 95, shipping: 4.99, tax: 7.84, total: 107.83});
  });
});


describe('Texas pickle shipping by total jars', () => {
  it.each([
    [1, 19, 6.99, 2.14, 28.13], [2, 38, 5.99, 3.63, 47.62],
    [3, 57, 4.99, 5.11, 67.10], [4, 76, 4.99, 6.68, 87.67],
  ])('%s jars: taxes merchandise plus the correct shipping fee', (pickleJarCount, subtotal, shipping, tax, total) => {
    expect(calculateOrderTotals(subtotal, {fulfillmentType:'delivery', deliveryState:'TX',
      taxableSubtotal:subtotal, picklesOnly:true, pickleJarCount})).toEqual({subtotal,shipping,tax,total});
  });
  it('keeps mixed-cart regional rates and free pickup unchanged', () => {
    expect(calculateOrderTotals(68, {fulfillmentType:'delivery',deliveryState:'TX',taxableSubtotal:38,picklesOnly:false,pickleJarCount:2}).shipping).toBe(6.99);
    expect(calculateOrderTotals(38, {fulfillmentType:'pickup',taxableSubtotal:38,picklesOnly:true,pickleJarCount:2}).shipping).toBe(0);
    for (const [deliveryState, subtotal, shipping] of [['OK',38,11.99],['OK',76,8.99],['CA',95,11.99]] as const) {
      expect(calculateOrderTotals(subtotal,{fulfillmentType:'delivery',deliveryState,taxableSubtotal:19,picklesOnly:false,pickleJarCount:1}).shipping).toBe(shipping);
    }
  });
});

describe('pickle-only nationwide rates and minimum exemption', () => {
  it.each(DELIVERY_STATE_OPTIONS)('$code uses jar-count rates with no minimum', ({ code }) => {
    for (const [pickleJarCount, shipping] of [[1, 6.99], [2, 5.99], [3, 4.99], [10, 4.99]]) {
      const subtotal = 19 * pickleJarCount;
      expect(calculateOrderTotals(subtotal, {
        fulfillmentType: 'delivery', deliveryState: code, taxableSubtotal: subtotal,
        picklesOnly: true, pickleJarCount,
      }).shipping).toBe(shipping);
      expect(getDeliveryMinimumSubtotal(code, true)).toBe(0);
      expect(getDeliveryMinimumShortfall(subtotal, code, true)).toBe(0);
    }
  });
  it('restores the far-state minimum when sweets are present', () => {
    expect(getDeliveryMinimumSubtotal('NY', false)).toBe(80);
    expect(getDeliveryMinimumShortfall(59, 'NY', false)).toBe(21);
    expect(getDeliveryMinimumShortfall(80, 'NY', false)).toBe(0);
  });
});
