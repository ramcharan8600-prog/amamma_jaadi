import { describe, expect, it } from 'vitest';
import { couponBenefit } from './coupons';
import { calculateShippingQuote, DELIVERY_STATE_OPTIONS, getShippingZone } from './pricing';

describe('revised regional shipping coupon', () => {
  const shippingCoupon = { minSubtotal: 70, shippingPolicy: 'texas_v3' } as const;
  it.each(DELIVERY_STATE_OPTIONS)('$code receives its eligible shipping rate', ({ code }) => {
    const zone = getShippingZone(code);
    for (const picklesOnly of [true, false]) {
      const options = { fulfillmentType: 'delivery' as const, deliveryState: code, picklesOnly, pickleJarCount: 4 };
      const regular = calculateShippingQuote(80, options);
      const quote = calculateShippingQuote(80, { ...options, shippingCoupon });
      expect(quote.shipping).toBe(zone === 'texas' ? 0 : regular.shipping);
      expect(quote.couponSavings).toBe(zone === 'texas' ? regular.shipping : 0);
      expect(quote.maintenanceFee ?? 0).toBe(zone === 'texas' ? picklesOnly ? 1.99 : 0.99 : 0);
      if (zone !== 'texas') expect(quote).toEqual(regular);
      expect(calculateShippingQuote(69.99, { ...options, shippingCoupon })).toEqual(calculateShippingQuote(69.99, options));
    }
  });
  it('uses the editable minimum and accepts an exact match', () => {
    const options = { fulfillmentType: 'delivery' as const, deliveryState: 'OK', shippingCoupon };
    expect(calculateShippingQuote(70, options).shipping).toBe(8.99);
    expect(calculateShippingQuote(70, { ...options, shippingCoupon: { ...shippingCoupon, minSubtotal: 70.01 } }).shipping).toBe(8.99);
    expect(calculateShippingQuote(70, { ...options, fulfillmentType: 'pickup' }).couponSavings).toBe(0);
  });
  it('publishes the revised shipping policy without complimentary pieces', () => {
    expect(couponBenefit({ code: 'SHIP70', coupon_type: 'free_delivery', min_subtotal: 70, bonus_item: '', bonus_qty: 0, active: 1 }))
      .toEqual({ code: 'SHIP70', type: 'free_delivery', minSubtotal: 70, shippingPolicy: 'texas_v3' });
  });
});

it('preserves a previously quoted Texas v2 sweets order without adding the new fee', () => {
  expect(calculateShippingQuote(80, { fulfillmentType: 'delivery', deliveryState: 'TX', shippingCoupon: { minSubtotal: 70, shippingPolicy: 'texas_v2' } }).maintenanceFee).toBeUndefined();
});
