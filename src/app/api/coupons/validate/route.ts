import { NextRequest } from 'next/server';
import { getDb, isDbConfigured } from '@/lib/db';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { ok, fail } from '@/lib/api';
import { couponBenefit, type CouponRow } from '@/lib/coupons';
import { validateCart } from '@/lib/cart-validation';

/**
 * POST /api/coupons/validate
 *
 * Validates an influencer coupon code against the D1 table.
 * Returns the selected benefit on success, or a reason on failure.
 */
export async function POST(request: NextRequest) {
  try {
    if (!rateLimit(`coupon-validate:${getClientIp(request)}`, 15, 60_000)) {
      return fail('Too many attempts. Please slow down.', 429);
    }

    if (!isDbConfigured()) {
      return fail("That promo code isn't valid.", 400);
    }

    const body = await request.json();
    const raw = String(body.code || '').trim().replace(/\s+/g, '').toUpperCase();
    if (!raw) {
      return fail('Enter a promo code.', 400);
    }

    const coupon = await getDb()
      .prepare('SELECT code, coupon_type, bonus_item, bonus_qty, active, min_subtotal FROM influencer_coupons WHERE code = ?')
      .bind(raw)
      .first<CouponRow>();

    if (!coupon || !coupon.active) {
      return fail("That promo code isn't valid.", 400);
    }

    const benefit = couponBenefit(coupon);
    if (!benefit) return fail("That promo code isn't valid.", 400);
    if (benefit.type === 'free_delivery') {
      const cart = validateCart(body.items);
      if (!cart.ok) return fail(cart.error, cart.status);
      if (cart.subtotal < benefit.minSubtotal) {
        return fail(`This code requires a minimum cart value of $${benefit.minSubtotal.toFixed(2)} before tax and delivery.`, 400);
      }
    }
    return ok(benefit);
  } catch (e) {
    console.error('Coupon validation error:', e);
    return fail("That promo code isn't valid.", 400);
  }
}
