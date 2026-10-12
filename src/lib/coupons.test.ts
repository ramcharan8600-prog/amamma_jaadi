import { describe, expect, it } from 'vitest';
import { couponBenefit, couponBenefitLabel, type CouponRow } from './coupons';

const row = (fields: Partial<CouponRow>): CouponRow => ({
  code: 'CODE', coupon_type: 'complimentary', bonus_item: 'Malai Khaja', bonus_qty: 2, active: 1, min_subtotal: 0, ...fields,
});

describe('coupons', () => {
  it('reads a free-piece coupon from its database row', () => {
    const benefit = couponBenefit(row({ code: 'KURRA007' }));
    expect(benefit).toEqual({ code: 'KURRA007', type: 'complimentary', bonusItem: 'Malai Khaja', bonusQty: 2 });
    expect(couponBenefitLabel(benefit!)).toBe('2 complimentary Malai Khaja pcs');
  });

  it('never applies an old free-shipping offer (ended with the 2026-10-12 rate card)', () => {
    expect(couponBenefit(row({ code: 'ANU2026', coupon_type: 'free_delivery', bonus_item: '', bonus_qty: 0, min_subtotal: 60 }))).toBeNull();
  });

  it('refuses a free-piece row without an item or a whole positive quantity', () => {
    expect(couponBenefit(row({ bonus_item: ' ' }))).toBeNull();
    expect(couponBenefit(row({ bonus_qty: 0 }))).toBeNull();
    expect(couponBenefit(row({ bonus_qty: 1.5 }))).toBeNull();
  });
});
