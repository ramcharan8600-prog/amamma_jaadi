import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { ok, fail } from '@/lib/api';
import { buildOrderFilters } from '@/lib/order-filters';

async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  return Boolean(session?.value && verifySessionToken(session.value));
}

/**
 * GET /api/orders/production — Admin only: what the orders matching the order
 * list's filters need, across every page: pickup / delivery order counts and
 * their items summed by name and size. Fully refunded orders are excluded; a
 * partial refund can be a price adjustment while the order still needs making.
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return fail('Unauthorized', 401);
  }

  try {
    if (!isDbConfigured()) {
      return ok({ orderCounts: { pickup: 0, delivery: 0 }, lines: [] });
    }

    const filters = buildOrderFilters(new URL(request.url).searchParams);
    if ('error' in filters) return fail(filters.error, 400);
    const where = [...filters.where, "payment_status IN ('paid', 'partially_refunded')"].join(' AND ');
    const db = getDb();

    const [counts, lines] = await Promise.all([
      db.prepare(`SELECT order_type, COUNT(*) AS orders FROM orders WHERE ${where} GROUP BY order_type`)
        .bind(...filters.binds)
        .all<{ order_type: string; orders: number }>(),
      db.prepare(
        `SELECT product_name, selected_tier, SUM(quantity) AS quantity
         FROM order_items
         WHERE order_id IN (SELECT id FROM orders WHERE ${where})
         GROUP BY product_name, selected_tier
         ORDER BY product_name, selected_tier`
      )
        .bind(...filters.binds)
        .all<{ product_name: string; selected_tier: number | null; quantity: number }>(),
    ]);

    const orderCounts = { pickup: 0, delivery: 0 };
    for (const row of counts.results ?? []) {
      if (row.order_type === 'pickup' || row.order_type === 'delivery') orderCounts[row.order_type] = Number(row.orders);
    }
    return ok({ orderCounts, lines: lines.results ?? [] });
  } catch (e) {
    console.error('Production summary error:', e);
    return fail('Failed to load production summary', 500);
  }
}
