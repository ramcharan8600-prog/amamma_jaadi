import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { ok, fail } from '@/lib/api';

interface CouponRow {
  code: string;
  influencer_name: string;
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
         SUM(o.total_price)                     AS total_revenue,
         SUM(CASE WHEN o.order_type = 'pickup'   THEN 1 ELSE 0 END) AS pickup_orders,
         SUM(CASE WHEN o.order_type = 'delivery' THEN 1 ELSE 0 END) AS delivery_orders,
         SUM(CASE WHEN o.order_type = 'pickup'   THEN o.total_price ELSE 0 END) AS pickup_revenue,
         SUM(CASE WHEN o.order_type = 'delivery' THEN o.total_price ELSE 0 END) AS delivery_revenue
       FROM orders o
       WHERE o.coupon_code IS NOT NULL AND o.payment_status = 'paid'
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

  const body = await request.json();
  const code = String(body.code || '').trim().replace(/\s+/g, '').toUpperCase();
  const influencerName = String(body.influencerName || '').trim();
  const bonusItem = String(body.bonusItem || 'Malai Khaja').trim();
  const bonusQty = Math.max(1, Math.floor(Number(body.bonusQty) || 2));

  if (!code || code.length < 2) return fail('Code must be at least 2 characters.', 400);
  if (!influencerName) return fail('Influencer name is required.', 400);

  try {
    await getDb()
      .prepare(
        `INSERT INTO influencer_coupons (code, influencer_name, bonus_item, bonus_qty)
         VALUES (?, ?, ?, ?)`
      )
      .bind(code, influencerName, bonusItem, bonusQty)
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
 * PATCH /api/coupons/admin — toggle active status.
 */
export async function PATCH(request: NextRequest) {
  if (!(await requireAdmin())) return fail('Unauthorized', 401);
  if (!isDbConfigured()) return fail('Database not configured', 503);

  const body = await request.json();
  const code = String(body.code || '').trim().toUpperCase();
  const active = body.active ? 1 : 0;

  if (!code) return fail('Coupon code is required.', 400);

  await getDb()
    .prepare('UPDATE influencer_coupons SET active = ? WHERE code = ?')
    .bind(active, code)
    .run();

  return ok({ code, active });
}
