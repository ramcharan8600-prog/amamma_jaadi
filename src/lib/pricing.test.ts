import { describe, it, expect } from 'vitest';
import {
  calculateOrderTotals,
  calculateShippingQuote,
  DELIVERY_STATE_OPTIONS,
  roundMoney,
  isTexas,
  getShippingZone,
  getDeliveryMinimumSubtotal,
  getDeliveryMinimumShortfall,
  isSupportedDeliveryState,
  normalizeStateCode,
  shippingMethodLabel,
  deliveryService,
  deliveryServiceLabel,
  isExpressDeliveryService,
  isGroundShippingCart,
  groundShippingKind,
  deliveryRestriction,
  containsMiniComboPack,
  SALES_TAX_RATE,
  SALES_TAX_LABEL,
} from './pricing';
import { getProductById } from '@/data/products';

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
    it(`${deliveryState}: $10.99 below $60 and $8.99 at $60+`, () => {
      expect(calculateOrderTotals(59.99, { fulfillmentType: 'delivery', deliveryState }).shipping)
        .toBe(10.99);
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

  it('requires a $60 merchandise subtotal', () => {
    expect(getDeliveryMinimumSubtotal('NY')).toBe(60);
    expect(getDeliveryMinimumShortfall(40, 'NY')).toBe(20);
    expect(getDeliveryMinimumShortfall(59.99, 'NY')).toBe(0.01);
    expect(getDeliveryMinimumShortfall(60, 'NY')).toBe(0);
    expect(getDeliveryMinimumShortfall(100, 'NY')).toBe(0);
    expect(getDeliveryMinimumSubtotal('TX')).toBe(0);
    expect(getDeliveryMinimumSubtotal('AL')).toBe(0);
    expect(getDeliveryMinimumSubtotal('OK')).toBe(0);
  });

  it('classifies named examples as far states', () => {
    for (const state of ['NY', 'DE', 'MA', 'WA', 'DC', 'NC', 'MI']) {
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

  it('subtotal + tax + shipping + fee always equals total exactly (no float dust)', () => {
    for (const s of [2.5, 5, 14, 16, 30, 37.5, 49.99, 123.45, 999.99]) {
      const { subtotal, tax, shipping, maintenanceFee = 0, total } = calculateOrderTotals(s, { fulfillmentType: 'delivery', deliveryState: 'TX' });
      expect(roundMoney(subtotal + tax + shipping + maintenanceFee)).toBe(total);
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
      .toEqual({subtotal: 95, shipping: 6.99, tax: 7.84, total: 109.83});
  });
});


describe('Texas pickle shipping by total jars', () => {
  it.each([
    [1, 19, 6.99, 2.14, 28.13], [2, 38, 6.99, 3.71, 48.70],
    [3, 57, 6.99, 5.28, 69.27], [4, 76, 6.99, 6.85, 89.84],
  ])('%s jars: taxes merchandise plus the correct shipping fee', (pickleJarCount, subtotal, shipping, tax, total) => {
    expect(calculateOrderTotals(subtotal, {fulfillmentType:'delivery', deliveryState:'TX',
      taxableSubtotal:subtotal, picklesOnly:true, pickleJarCount})).toEqual({subtotal,shipping,tax,total});
  });
  it('keeps mixed-cart regional rates and free pickup unchanged', () => {
    expect(calculateOrderTotals(68, {fulfillmentType:'delivery',deliveryState:'TX',taxableSubtotal:38,picklesOnly:false,pickleJarCount:2}).shipping).toBe(6.99);
    expect(calculateOrderTotals(38, {fulfillmentType:'pickup',taxableSubtotal:38,picklesOnly:true,pickleJarCount:2}).shipping).toBe(0);
    for (const [deliveryState, subtotal, shipping] of [['OK',38,10.99],['OK',76,8.99],['CA',95,11.99]] as const) {
      expect(calculateOrderTotals(subtotal,{fulfillmentType:'delivery',deliveryState,taxableSubtotal:19,picklesOnly:false,pickleJarCount:1}).shipping).toBe(shipping);
    }
  });
});

describe('pickle-only nationwide rates and minimum exemption', () => {
  it.each(DELIVERY_STATE_OPTIONS)('$code uses a flat pickle rate with no minimum', ({ code }) => {
    for (const [pickleJarCount, shipping] of [[1, 6.99], [2, 6.99], [3, 6.99], [10, 6.99]]) {
      const subtotal = 19 * pickleJarCount;
      // Texas deliveries of $100+ pay the $2.99 shipping fee instead.
      expect(calculateOrderTotals(subtotal, {
        fulfillmentType: 'delivery', deliveryState: code, taxableSubtotal: subtotal,
        picklesOnly: true, pickleJarCount,
      }).shipping).toBe(code === 'TX' && subtotal >= 100 ? 2.99 : shipping);
      expect(getDeliveryMinimumSubtotal(code, true)).toBe(0);
      expect(getDeliveryMinimumShortfall(subtotal, code, true)).toBe(0);
    }
  });
  it('restores the far-state minimum when sweets are present', () => {
    expect(getDeliveryMinimumSubtotal('NY', false)).toBe(60);
    expect(getDeliveryMinimumShortfall(59, 'NY', false)).toBe(1);
    expect(getDeliveryMinimumShortfall(60, 'NY', false)).toBe(0);
  });
});


describe('shipping coupons are Texas-only', () => {
  const shippingCoupon = { minSubtotal: 70, shippingPolicy: 'texas_v3' as const };
  it.each([['TX', 0], ['OK', 8.99], ['GA', 8.99], ['CA', 11.99]])('gives %s shipping of %s on an $80 sweets cart', (deliveryState, shipping) => {
    expect(calculateOrderTotals(80, { fulfillmentType: 'delivery', deliveryState: String(deliveryState), shippingCoupon, taxableSubtotal: 0 }).shipping).toBe(shipping);
  });
  it.each(['TX', 'OK', 'CA'])('does not discount a cart one cent below the minimum in %s', deliveryState => {
    const opts = { fulfillmentType: 'delivery' as const, deliveryState, picklesOnly: true, pickleJarCount: 4 };
    expect(calculateOrderTotals(69.99, { ...opts, shippingCoupon })).toEqual(calculateOrderTotals(69.99, opts));
  });
  it.each(['OK', 'NY'])('leaves pickle-only shipping at the regular $6.99 in %s', deliveryState => {
    expect(calculateShippingQuote(72, { fulfillmentType: 'delivery', deliveryState, picklesOnly: true, pickleJarCount: 4, shippingCoupon }))
      .toEqual({ shipping: 6.99, regularShipping: 6.99, referenceShipping: 6.99, couponSavings: 0 });
  });
  it('makes Texas pickle-only shipping free with the $1.99 fee', () => {
    expect(calculateShippingQuote(72, { fulfillmentType: 'delivery', deliveryState: 'TX', picklesOnly: true, pickleJarCount: 4, shippingCoupon }))
      .toEqual({ shipping: 0, regularShipping: 6.99, referenceShipping: 6.99, couponSavings: 6.99, maintenanceFee: 1.99 });
  });
  it('gives no discount outside Texas even for a coupon with no policy', () => {
    expect(calculateOrderTotals(80, { fulfillmentType: 'delivery', deliveryState: 'CA', shippingCoupon: { minSubtotal: 70 } }).shipping).toBe(11.99);
    expect(calculateOrderTotals(80, { fulfillmentType: 'delivery', deliveryState: 'TX', shippingCoupon: { minSubtotal: 70 } }).shipping).toBe(0);
  });
  it('uses the configured minimum rather than a fixed $70', () => {
    expect(calculateOrderTotals(70, { fulfillmentType: 'delivery', deliveryState: 'TX', shippingCoupon: { ...shippingCoupon, minSubtotal: 70.01 } }).shipping).toBe(6.99);
    expect(calculateOrderTotals(70, { fulfillmentType: 'delivery', deliveryState: 'TX', shippingCoupon }).shipping).toBe(0);
  });
  it('keeps pickup free with no coupon savings', () => {
    expect(calculateShippingQuote(80, { fulfillmentType: 'pickup', shippingCoupon }).couponSavings).toBe(0);
  });
});

describe('pricing — nearby states with the $100 tier', () => {
  const nearby = ['AL', 'AR', 'CO', 'FL', 'GA', 'IA', 'IL', 'KS', 'LA', 'MO', 'MS', 'NE', 'NM', 'OK', 'TN'];

  it('treats every nearby state as nearby with no minimum', () => {
    for (const state of nearby) {
      expect(getShippingZone(state)).toBe('nearby');
      expect(getDeliveryMinimumSubtotal(state)).toBe(0);
    }
  });

  it.each(nearby)('%s: $10.99 below $60, $8.99 from $60, $7.99 from $100', (deliveryState) => {
    const ship = (subtotal: number) =>
      calculateOrderTotals(subtotal, { fulfillmentType: 'delivery', deliveryState, taxableSubtotal: 0 }).shipping;
    expect(ship(40)).toBe(10.99);
    expect(ship(59.99)).toBe(10.99);
    expect(ship(60)).toBe(8.99);
    expect(ship(99.99)).toBe(8.99);
    expect(ship(100)).toBe(7.99);
    expect(ship(150)).toBe(7.99);
  });

  it('keeps Texas, far states and pickle-only rates unchanged', () => {
    expect(calculateOrderTotals(99, { fulfillmentType: 'delivery', deliveryState: 'TX', taxableSubtotal: 0 }).shipping).toBe(6.99);
    expect(calculateOrderTotals(120, { fulfillmentType: 'delivery', deliveryState: 'NY', taxableSubtotal: 0 }).shipping).toBe(11.99);
    expect(calculateOrderTotals(18, { fulfillmentType: 'delivery', deliveryState: 'FL', picklesOnly: true, pickleJarCount: 1 }).shipping).toBe(6.99);
    expect(getDeliveryMinimumSubtotal('NC')).toBe(60);
  });

  it('gives no shipping-coupon discount on the $7.99 nearby tier', () => {
    expect(calculateOrderTotals(100, { fulfillmentType: 'delivery', deliveryState: 'GA', taxableSubtotal: 0,
      shippingCoupon: { minSubtotal: 50, shippingPolicy: 'texas_v3' } }).shipping).toBe(7.99);
  });
});

describe('pricing — Malai Khaja-only carts', () => {
  const ship = (subtotal: number, deliveryState: string, malaiKhaja = true) =>
    calculateOrderTotals(subtotal, { fulfillmentType: 'delivery', deliveryState, taxableSubtotal: 0,
      groundShipping: malaiKhaja ? 'malai-khaja' as const : undefined }).shipping;

  it('recognises carts made entirely of Malai Khaja, or entirely of the Assorted Box', () => {
    expect(isGroundShippingCart([{ productId: 'sweet-malai-khaja' }])).toBe(true);
    expect(isGroundShippingCart([{ productId: 'sweet-malai-khaja' }, { productId: 'sweet-malai-khaja' }])).toBe(true);
    expect(isGroundShippingCart([{ productId: 'sweet-malai-khaja' }, { productId: 'sweet-kova' }])).toBe(false);
    expect(isGroundShippingCart([{ productId: 'sweet-malai-khaja' }, { productId: 'pickle-chicken' }])).toBe(false);
    expect(isGroundShippingCart([{ productId: 'sweet-assorted-box' }])).toBe(true);
    expect(isGroundShippingCart([{ productId: 'sweet-assorted-box' }, { productId: 'sweet-assorted-box' }])).toBe(true);
    expect(isGroundShippingCart([{ productId: 'sweet-assorted-box' }, { productId: 'sweet-malai-khaja' }])).toBe(false);
    expect(isGroundShippingCart([{ productId: 'sweet-assorted-box' }, { productId: 'sweet-malpuri' }])).toBe(false);
    expect(isGroundShippingCart([])).toBe(false);
    expect(groundShippingKind([{ productId: 'sweet-malai-khaja' }])).toBe('malai-khaja');
    expect(groundShippingKind([{ productId: 'sweet-assorted-box' }, { productId: 'sweet-assorted-box' }])).toBe('assorted-box');
    // The Bobbatlu Taste Pack ships with the 11:11 box at the box's rate, never on its own terms.
    expect(groundShippingKind([{ productId: 'sweet-assorted-box' }, { productId: 'sweet-bobbatlu-taste-pack' }])).toBe('assorted-box');
    expect(groundShippingKind([{ productId: 'sweet-bobbatlu-taste-pack' }])).toBeUndefined();
    expect(groundShippingKind([{ productId: 'sweet-malpuri' }, { productId: 'sweet-bobbatlu-taste-pack' }])).toBeUndefined();
    expect(groundShippingKind([{ productId: 'sweet-assorted-box' }, { productId: 'sweet-malpuri' }, { productId: 'sweet-bobbatlu-taste-pack' }])).toBeUndefined();
  });

  it('keeps $6.99 in Texas below $100, $2.99 from $100', () => {
    expect(ship(40, 'TX')).toBe(6.99);
    expect(ship(100, 'TX')).toBe(2.99);
  });

  it('caps nearby states at $9.99 but keeps the cheaper $8.99 / $7.99 tiers', () => {
    expect(ship(40, 'FL')).toBe(9.99);
    expect(ship(59.99, 'OK')).toBe(9.99);
    expect(ship(60, 'GA')).toBe(8.99);
    expect(ship(100, 'TN')).toBe(7.99);
  });

  it('ships to far states for $9.99 with no minimum', () => {
    for (const state of ['NY', 'CA', 'WA', 'NC']) {
      expect(ship(40, state)).toBe(9.99);
      expect(ship(120, state)).toBe(9.99);
      expect(getDeliveryMinimumSubtotal(state, false, true)).toBe(0);
      expect(getDeliveryMinimumShortfall(40, state, false, true)).toBe(0);
    }
  });

  it('leaves every other cart on the regular rates and minimum', () => {
    expect(ship(40, 'FL', false)).toBe(10.99);
    expect(ship(80, 'NY', false)).toBe(11.99);
    expect(getDeliveryMinimumShortfall(40, 'NY')).toBe(20);
  });

  it('gives no shipping-coupon discount on the $9.99 rate', () => {
    expect(calculateOrderTotals(50, { fulfillmentType: 'delivery', deliveryState: 'NY', taxableSubtotal: 0, groundShipping: 'malai-khaja',
      shippingCoupon: { minSubtotal: 50, shippingPolicy: 'texas_v3' } }).shipping).toBe(9.99);
  });
});

describe('pricing — Assorted Box-only carts', () => {
  const ship = (subtotal: number, deliveryState: string) =>
    calculateOrderTotals(subtotal, { fulfillmentType: 'delivery', deliveryState, taxableSubtotal: 0, groundShipping: 'assorted-box' }).shipping;

  it('keeps $6.99 in Texas below $100, $2.99 from $100', () => {
    expect(ship(60, 'TX')).toBe(6.99);
    expect(ship(120, 'TX')).toBe(2.99);
  });

  it('charges a flat $8.99 to nearby states, ignoring the nearby tiers', () => {
    for (const state of ['GA', 'OK', 'FL', 'KS', 'AL', 'TN']) {
      expect(ship(60, state)).toBe(8.99);
      expect(ship(84, state)).toBe(8.99);
      expect(ship(120, state)).toBe(8.99);
    }
  });

  it('charges a flat $9.99 to far states', () => {
    for (const state of ['NY', 'CA', 'WA', 'NC']) {
      expect(ship(60, state)).toBe(9.99);
      expect(ship(120, state)).toBe(9.99);
    }
  });

  it('has no far-state minimum', () => {
    expect(getDeliveryMinimumShortfall(60, 'NY', false, 'assorted-box')).toBe(0);
  });
});

describe('pricing — Malai Khaja-only rates by total pieces', () => {
  const ship = (subtotal: number, deliveryState: string, groundPieces: number) =>
    calculateOrderTotals(subtotal, { fulfillmentType: 'delivery', deliveryState, taxableSubtotal: 0,
      groundShipping: 'malai-khaja', groundPieces }).shipping;

  it.each([
    // [pieces, subtotal, Texas, nearby (GA), far (NY)]; Texas pays $2.99 from $100.
    [16, 40, 6.99, 9.99, 9.99],
    [25, 62.5, 6.99, 8.99, 8.99],
    [50, 125, 2.99, 5.99, 5.99],
    [32, 80, 6.99, 8.99, 8.99],   // 2 × 16
    [48, 120, 2.99, 7.99, 8.99],  // 3 × 16: nearby keeps the cheaper $100 tier
    [50, 125, 2.99, 5.99, 5.99],  // 2 × 25
    [100, 250, 2.99, 5.99, 5.99], // 2 × 50
  ])('%i pieces ($%s): Texas $%s, nearby $%s, far $%s', (pieces, subtotal, tx, nearby, far) => {
    expect(ship(subtotal, 'TX', pieces)).toBe(tx);
    expect(ship(subtotal, 'GA', pieces)).toBe(nearby);
    expect(ship(subtotal, 'NY', pieces)).toBe(far);
  });

  it('keeps a Texas shipping coupon on a 50-piece order (free + $0.99)', () => {
    expect(calculateShippingQuote(125, { fulfillmentType: 'delivery', deliveryState: 'TX', groundShipping: 'malai-khaja',
      groundPieces: 50, shippingCoupon: { minSubtotal: 70, shippingPolicy: 'texas_v3' } })).toMatchObject({ shipping: 0, maintenanceFee: 0.99 });
  });
});

describe('pricing — $2.99 Texas shipping from $100', () => {
  const quote = (subtotal: number, opts: Parameters<typeof calculateShippingQuote>[1] = {}) =>
    calculateShippingQuote(subtotal, { fulfillmentType: 'delivery', deliveryState: 'TX', ...opts });

  it('charges $2.99 to ship Texas deliveries of $100+, with no operational fee', () => {
    expect(quote(90)).toMatchObject({ shipping: 6.99, couponSavings: 0 });
    expect(quote(99.99)).toMatchObject({ shipping: 6.99, couponSavings: 0 });
    expect(quote(99.99).discountedShippingMinimum).toBeUndefined();
    expect(quote(100)).toMatchObject({ shipping: 2.99, couponSavings: 4, discountedShippingMinimum: 100 });
    expect(quote(100).maintenanceFee).toBeUndefined();
    expect(quote(250)).toMatchObject({ shipping: 2.99 });
  });

  it('applies to every Texas cart type', () => {
    for (const q of [
      quote(126, { picklesOnly: true, pickleJarCount: 6 }),
      quote(125, { groundShipping: 'malai-khaja', groundPieces: 50 }),
      quote(120, { groundShipping: 'assorted-box' }),
      quote(100, { picklesOnly: true, pickleJarCount: 5 }),
    ]) {
      expect(q.shipping).toBe(2.99);
      expect(q.maintenanceFee).toBeUndefined();
    }
  });

  it('lets a Texas shipping coupon win (free + its fee), above or below $100', () => {
    const shippingCoupon = { minSubtotal: 60, shippingPolicy: 'texas_v3' as const };
    expect(quote(130, { shippingCoupon })).toMatchObject({ shipping: 0, maintenanceFee: 0.99 });
    expect(quote(126, { picklesOnly: true, pickleJarCount: 6, shippingCoupon })).toMatchObject({ shipping: 0, maintenanceFee: 1.99 });
    expect(quote(126, { picklesOnly: true, pickleJarCount: 6, shippingCoupon }).discountedShippingMinimum).toBeUndefined();
    expect(quote(84, { picklesOnly: true, pickleJarCount: 4, shippingCoupon })).toMatchObject({ shipping: 0, maintenanceFee: 1.99 });
  });

  it('never applies to pickup or other states', () => {
    expect(calculateShippingQuote(150, { fulfillmentType: 'pickup', deliveryState: 'TX' })).toMatchObject({ shipping: 0, couponSavings: 0 });
    expect(quote(120, { deliveryState: 'GA' })).toMatchObject({ shipping: 7.99, couponSavings: 0 });
    expect(quote(120, { deliveryState: 'NY' })).toMatchObject({ shipping: 11.99, couponSavings: 0 });
    expect(quote(120, { deliveryState: 'NY' }).discountedShippingMinimum).toBeUndefined();
  });

  it('taxes the $2.99 with pickles in a Texas order, like any shipping', () => {
    expect(calculateOrderTotals(120, { fulfillmentType: 'delivery', deliveryState: 'TX', taxableSubtotal: 18 }))
      .toEqual({ subtotal: 120, tax: 1.73, shipping: 2.99, total: 124.72 });
    expect(calculateOrderTotals(120, { fulfillmentType: 'delivery', deliveryState: 'TX', taxableSubtotal: 0 }))
      .toEqual({ subtotal: 120, tax: 0, shipping: 2.99, total: 122.99 });
  });
});


describe('deliveryService', () => {
  it('names the service customers are told about, by zone and cart', () => {
    // Texas: always the 1-day estimate.
    expect(deliveryService('TX', false, undefined)).toBe('texas');
    expect(deliveryService('TX', true, undefined)).toBe('texas');
    // Nearby states: Express, including box-only and Malai Khaja-only carts.
    expect(deliveryService('OK', false, undefined)).toBe('express');
    expect(deliveryService('FL', false, 'assorted-box')).toBe('express');
    expect(deliveryService('IA', false, 'malai-khaja')).toBe('express');
    // Other states: UPS 2nd Day Air, except the quietly ground-shipped carts.
    expect(deliveryService('NY', false, undefined)).toBe('second-day-air');
    expect(deliveryService('CA', false, 'assorted-box')).toBe('standard');
    expect(deliveryService('NY', false, 'malai-khaja')).toBe('standard');
    // Pickle-only outside Texas: Standard everywhere.
    expect(deliveryService('OK', true, undefined)).toBe('standard');
    expect(deliveryService('NY', true, undefined)).toBe('standard');
  });

  it('labels each service, keeping a legacy recorded method', () => {
    expect(deliveryServiceLabel('texas')).toBe('Shipping (estimated 1 business day after dispatch)');
    expect(deliveryServiceLabel('express')).toBe('Express shipping (2-day ETA)');
    expect(deliveryServiceLabel('second-day-air')).toBe('UPS 2nd Day Air');
    expect(deliveryServiceLabel('standard', 'standard')).toBe('Standard shipping');
    expect(deliveryServiceLabel('express', 'ground')).toBe('Ground — estimated 2–5 business days in transit');
  });

  it('treats nearby Express and UPS 2nd Day Air as express for the sweets note', () => {
    expect(isExpressDeliveryService('express')).toBe(true);
    expect(isExpressDeliveryService('second-day-air')).toBe(true);
    expect(isExpressDeliveryService('standard')).toBe(false);
    expect(isExpressDeliveryService('texas')).toBe(false);
  });
});

describe('Mini Combo Pack shipping', () => {
  const mini = { productId: 'gift-box-mini-combo' };
  const quote = (state: string, subtotal = 48, items = [mini]) => calculateShippingQuote(subtotal, {
    fulfillmentType: 'delivery', deliveryState: state, groundShipping: groundShippingKind(items),
  });

  it('is its own box-only rate; mixing with anything restores regular rates', () => {
    expect(groundShippingKind([mini])).toBe('mini-combo');
    expect(groundShippingKind([mini, mini])).toBe('mini-combo');
    expect(groundShippingKind([mini, { productId: 'sweet-malpuri' }])).toBeUndefined();
  });

  it('ships free in Texas and $3.99 to nearby states, per order', () => {
    expect(quote('TX').shipping).toBe(0);
    expect(quote('TX', 96).shipping).toBe(0);
    expect(quote('OK').shipping).toBe(3.99);
    expect(quote('IA', 144).shipping).toBe(3.99);
    // Texas $100+ ($2.99) never raises the cheaper (free) box rate.
    expect(quote('TX', 144).shipping).toBe(0);
  });

  it('never adds the coupon\'s $0.99 operational fee to an already-free Texas box', () => {
    const q = calculateShippingQuote(96, {
      fulfillmentType: 'delivery', deliveryState: 'TX', groundShipping: 'mini-combo',
      shippingCoupon: { minSubtotal: 60, shippingPolicy: 'texas_v3' },
    });
    expect(q).toMatchObject({ shipping: 0, couponSavings: 0 });
    expect(q.maintenanceFee).toBeUndefined();
  });

  it('uses regular rates when mixed', () => {
    expect(quote('TX', 88, [mini, { productId: 'sweet-malpuri' }]).shipping).toBe(6.99);
    expect(quote('OK', 88, [mini, { productId: 'sweet-malpuri' }]).shipping).toBe(8.99);
  });
});

describe('deliveryRestriction', () => {
  const sweetMemories = getProductById('gift-box-sweet-memories')!;
  const mini = getProductById('gift-box-mini-combo')!;

  it('refuses delivery of the pickup-only $30 box anywhere, at any subtotal', () => {
    for (const state of ['TX', 'OK', 'NY', null]) {
      expect(deliveryRestriction(sweetMemories, state, 500)).toContain('is pickup only');
    }
  });

  it('delivers the Mini Combo Pack only within Texas and nearby states', () => {
    expect(deliveryRestriction(mini, 'TX', 48)).toBeNull();
    expect(deliveryRestriction(mini, 'FL', 48)).toBeNull();
    expect(deliveryRestriction(mini, 'NY', 500)).toBe(
      'Mini Combo Pack - #Delivery is delivered within Texas and nearby states only. Choose pickup, remove it from your cart, or select an address in Texas and nearby states.'
    );
  });

  it('leaves unrestricted products alone', () => {
    expect(deliveryRestriction(getProductById('sweet-malpuri')!, 'NY', 40)).toBeNull();
  });

  it('still supports a state list with an out-of-state minimum', () => {
    const product = { name: 'Test Box', deliveryStateCodes: ['TX'], deliveryOutsideStateMinimum: 60 };
    expect(deliveryRestriction(product, 'TX', 30)).toBeNull();
    expect(deliveryRestriction(product, 'OK', 60)).toBeNull();
    expect(deliveryRestriction(product, 'OK', 30)).toContain('Add $30.00 more');
  });
});

describe('containsMiniComboPack', () => {
  it('drops the $0.99 fee, not the free coupon shipping, when the order has a Mini Combo Pack', () => {
    const items = [{ productId: 'gift-box-mini-combo' }, { productId: 'sweet-malpuri' }];
    expect(containsMiniComboPack(items)).toBe(true);
    expect(containsMiniComboPack([{ productId: 'sweet-malpuri' }])).toBe(false);
    const q = calculateShippingQuote(88, {
      fulfillmentType: 'delivery', deliveryState: 'TX', groundShipping: groundShippingKind(items),
      miniComboPack: true, shippingCoupon: { minSubtotal: 60, shippingPolicy: 'texas_v3' },
    });
    expect(q).toMatchObject({ shipping: 0, couponSavings: 2.99 });
    expect(q.maintenanceFee).toBeUndefined();
  });
});

describe('Texas orders with the Mini Combo Pack plus other items', () => {
  const quote = (subtotal: number, extra: Partial<Parameters<typeof calculateShippingQuote>[1]> = {}) =>
    calculateShippingQuote(subtotal, { fulfillmentType: 'delivery', deliveryState: 'TX', miniComboPack: true, ...extra });

  it('ships for $2.99 at any subtotal, including $100+', () => {
    expect(quote(88).shipping).toBe(2.99);
    expect(quote(150).shipping).toBe(2.99);
  });

  it('keeps nearby-state rates normal and the box alone free', () => {
    expect(calculateShippingQuote(88, { fulfillmentType: 'delivery', deliveryState: 'OK', miniComboPack: true }).shipping).toBe(8.99);
    expect(quote(48, { groundShipping: 'mini-combo' }).shipping).toBe(0);
  });

  it('lets a Texas coupon ship it free, with no operational fee', () => {
    const q = quote(88, { shippingCoupon: { minSubtotal: 60, shippingPolicy: 'texas_v3' } });
    expect(q).toMatchObject({ shipping: 0, couponSavings: 2.99 });
    expect(q.maintenanceFee).toBeUndefined();
  });
});
