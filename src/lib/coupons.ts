export type CouponType = 'complimentary' | 'free_delivery';

export type CouponBenefit =
  | { code: string; type: 'complimentary'; bonusItem: string; bonusQty: number }
  | { code: string; type: 'free_delivery'; minSubtotal: number };

export interface CouponRow {
  code: string;
  coupon_type: CouponType;
  bonus_item: string;
  bonus_qty: number;
  active: number;
  min_subtotal: number;
}

/** Read only trusted database rows; never accept a benefit from checkout input. */
export function couponBenefit(coupon: CouponRow): CouponBenefit | null {
  if (coupon.coupon_type === 'free_delivery' && isValidCouponMinimum(coupon.min_subtotal)) {
    return { code: coupon.code, type: 'free_delivery', minSubtotal: coupon.min_subtotal };
  }
  if (coupon.coupon_type === 'complimentary' && coupon.bonus_item?.trim() &&
      Number.isSafeInteger(coupon.bonus_qty) && coupon.bonus_qty > 0) {
    return { code: coupon.code, type: 'complimentary', bonusItem: coupon.bonus_item, bonusQty: coupon.bonus_qty };
  }
  return null;
}

export function isValidCouponMinimum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
    Number.isSafeInteger(Math.round(value * 100)) &&
    Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
}

export function couponBenefitLabel(coupon: CouponBenefit): string {
  return coupon.type === 'free_delivery'
    ? 'Free delivery'
    : `${coupon.bonusQty} complimentary ${coupon.bonusItem} pcs`;
}
