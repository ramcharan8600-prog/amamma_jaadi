import { NextRequest } from 'next/server';
import { getDb, isDbConfigured } from '@/lib/db';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { ok, fail } from '@/lib/api';

/**
 * POST /api/coupons/validate
 *
 * Validates an influencer coupon code against the D1 table.
 * Returns the bonus item details on success, or a reason on failure.
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
      .prepare('SELECT code, influencer_name, bonus_item, bonus_qty, active FROM influencer_coupons WHERE code = ?')
      .bind(raw)
      .first<{ code: string; influencer_name: string; bonus_item: string; bonus_qty: number; active: number }>();

    if (!coupon || !coupon.active) {
      return fail("That promo code isn't valid.", 400);
    }

    return ok({
      code: coupon.code,
      bonusItem: coupon.bonus_item,
      bonusQty: coupon.bonus_qty,
    });
  } catch (e) {
    console.error('Coupon validation error:', e);
    return fail("That promo code isn't valid.", 400);
  }
}
