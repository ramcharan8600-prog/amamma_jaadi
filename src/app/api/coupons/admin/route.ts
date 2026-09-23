import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { ok, fail } from '@/lib/api';
import { isValidCouponMinimum, type CouponType } from '@/lib/coupons';

interface CouponRow {
  code: string;
  influencer_name: string;
  coupon_type: CouponType;
  min_subtotal: number;
  bonus_item: string;
  bonus_qty: number;
  times_used: number;
  active: number;
  created_at: string;
}

async function requireAdmin() {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  return session?.value && verifySessionToken(session.value);
}

/**
 * GET /api/coupons/admin — list all influencer coupons + per-coupon analytics.
 */
export async function GET() {
  if (!(await requireAdmin())) return fail('Unauthorized', 401);
  if (!isDbConfigured()) return ok({ coupons: [], analytics: [] });

  const db = getDb();
  const { results: coupons } = await db
    .prepare('SELECT * FROM influencer_coupons ORDER BY created_at DESC')
    .all<CouponRow>();

  const { results: analytics } = await db
    .prepare(
      `SELECT
         o.coupon_code                          AS code,
         COUNT(*)                               AS order_count,
         SUM(MAX(0, o.total_price - o.refunded_amount)) AS total_revenue,
         SUM(CASE WHEN o.order_type = 'pickup'   THEN 1 ELSE 0 END) AS pickup_orders,
         SUM(CASE WHEN o.order_type = 'delivery' THEN 1 ELSE 0 END) AS delivery_orders,
         SUM(CASE WHEN o.order_type = 'pickup'
             THEN MAX(0, o.total_price - o.refunded_amount) ELSE 0 END) AS pickup_revenue,
         SUM(CASE WHEN o.order_type = 'delivery'
             THEN MAX(0, o.total_price - o.refunded_amount) ELSE 0 END) AS delivery_revenue
       FROM orders o
       WHERE o.coupon_code IS NOT NULL
         AND o.payment_status IN ('paid', 'partially_refunded')
       GROUP BY o.coupon_code`
    )
    .all<Record<string, unknown>>();

  return ok({ coupons: coupons ?? [], analytics: analytics ?? [] });
}

/**
 * POST /api/coupons/admin — create a new coupon.
 */
export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return fail('Unauthorized', 401);
  if (!isDbConfigured()) return fail('Database not configured', 503);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Invalid coupon request.', 400);
  const code = String(body.code || '').trim().replace(/\s+/g, '').toUpperCase();
  const influencerName = String(body.influencerName || '').trim();
  const couponType = body.type ?? 'complimentary';
  if (couponType !== 'complimentary' && couponType !== 'free_delivery') {
    return fail('Select complimentary pieces or free delivery.', 400);
  }
  const bonusItem = couponType === 'complimentary' ? String(body.bonusItem ?? 'Malai Khaja').trim() : '';
  const bonusQty = couponType === 'complimentary' ? Number(body.bonusQty ?? 2) : 0;
  const minSubtotal = couponType === 'free_delivery' ? body.minSubtotal : 0;
  if (!isValidCouponMinimum(minSubtotal)) {
    return fail('Enter a minimum cart value of $0 or more, with up to two decimal places.', 400);
  }
  if (couponType === 'complimentary' && (!['Malai Khaja', 'Malpuri'].includes(bonusItem) ||
      !Number.isSafeInteger(bonusQty) || bonusQty < 1 || bonusQty > 10)) {
    return fail('Select a complimentary item and a whole quantity from 1 to 10.', 400);
  }

  if (!code || code.length < 2) return fail('Code must be at least 2 characters.', 400);
  if (!influencerName) return fail('Influencer or campaign name is required.', 400);

  try {
    await getDb()
      .prepare(
        `INSERT INTO influencer_coupons (code, influencer_name, bonus_item, bonus_qty, coupon_type, min_subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(code, influencerName, bonusItem, bonusQty, couponType, minSubtotal)
      .run();
    return ok({ code }, 201);
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      return fail('A coupon with that code already exists.', 409);
    }
    console.error('Coupon create error:', e);
    return fail('Failed to create coupon', 500);
  }
}

/**
 * PATCH /api/coupons/admin — toggle status or adjust a free-delivery minimum.
 */
export async function PATCH(request: NextRequest) {
  if (!(await requireAdmin())) return fail('Unauthorized', 401);
  if (!isDbConfigured()) return fail('Database not configured', 503);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Invalid coupon request.', 400);
  const code = String(body.code || '').trim().toUpperCase();

  if (!code) return fail('Coupon code is required.', 400);

  const coupon = await getDb().prepare('SELECT coupon_type FROM influencer_coupons WHERE code = ?')
    .bind(code).first<{ coupon_type: CouponType }>();
  if (!coupon) return fail('Coupon not found.', 404);

  if ('minSubtotal' in body) {
    if (coupon.coupon_type !== 'free_delivery') return fail('Only free-delivery coupons have a minimum cart value.', 400);
    if (!isValidCouponMinimum(body.minSubtotal)) {
      return fail('Enter a minimum cart value of $0 or more, with up to two decimal places.', 400);
    }
    await getDb().prepare('UPDATE influencer_coupons SET min_subtotal = ? WHERE code = ?')
      .bind(body.minSubtotal, code).run();
    return ok({ code, minSubtotal: body.minSubtotal });
  }
  if (![true, false, 0, 1].includes(body.active)) return fail('Select an active status.', 400);
  const active = body.active ? 1 : 0;

  await getDb()
    .prepare('UPDATE influencer_coupons SET active = ? WHERE code = ?')
    .bind(active, code)
    .run();

  return ok({ code, active });
}
