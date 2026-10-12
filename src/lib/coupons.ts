/** 'free_delivery' rows are old shipping offers, ended 2026-10-12: they never apply now. */
export type CouponType = 'complimentary' | 'free_delivery';

export type CouponBenefit = { code: string; type: 'complimentary'; bonusItem: string; bonusQty: number };

export interface CouponRow {
  code: string;
  coupon_type: CouponType;
  bonus_item: string;
  bonus_qty: number;
  active: number;
  min_subtotal: number;
}

/**
 * Read only trusted database rows; never accept a benefit from checkout input.
 * Free-shipping offers ended with the 2026-10-12 rate card, so only free-piece coupons apply.
 */
export function couponBenefit(coupon: CouponRow): CouponBenefit | null {
  if (coupon.coupon_type === 'complimentary' && coupon.bonus_item?.trim() &&
      Number.isSafeInteger(coupon.bonus_qty) && coupon.bonus_qty > 0) {
    return { code: coupon.code, type: 'complimentary', bonusItem: coupon.bonus_item, bonusQty: coupon.bonus_qty };
  }
  return null;
}

export function couponBenefitLabel(coupon: CouponBenefit): string {
  return `${coupon.bonusQty} complimentary ${coupon.bonusItem} pcs`;
}
