import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, isDbConfigured, parseJson } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { businessDateOffset } from '@/lib/date';
import { ok, fail } from '@/lib/api';

/**
 * GET /api/orders — Admin only: fetch PAID orders
 *
 * Production dashboard ONLY shows payment_status = 'paid'
 * No pending, failed, or canceled orders appear.
 */
export async function GET(request: NextRequest) {
  // Verify admin session
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  if (!session?.value || !verifySessionToken(session.value)) {
    return fail('Unauthorized', 401);
  }

  try {
    if (!isDbConfigured()) {
      return ok({ orders: [] });
    }

    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';
    const db = getDb();

    // CRITICAL: only paid orders — production dashboard relies on this.
    const where = ["payment_status = 'paid'"];
    const binds: unknown[] = [];
    let orderBy = 'created_at DESC';

    switch (filter) {
      case 'today':
        where.push('pickup_date = ?');
        binds.push(businessDateOffset(0));
        break;
      case 'tomorrow':
        where.push('pickup_date = ?');
        binds.push(businessDateOffset(1));
        break;
      case 'future':
        // "Future" = the day after tomorrow onward (tomorrow has its own tab)
        where.push('pickup_date >= ?');
        binds.push(businessDateOffset(2));
        orderBy = 'pickup_date ASC';
        break;
      case 'completed':
        where.push("status = 'completed'");
        break;
    }

    const ordersRes = await db
      .prepare(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT 200`)
      .bind(...binds)
      .all<Record<string, unknown>>();
    const orders = ordersRes.results ?? [];

    // Attach nested order_items (one query joined to all paid orders) so the
    // analytics page can compute product breakdowns — mirrors the old shape.
    if (orders.length > 0) {
      const itemsRes = await db
        .prepare(
          `SELECT oi.* FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           WHERE o.payment_status = 'paid'`
        )
        .all<Record<string, unknown>>();

      const itemsByOrder = new Map<string, unknown[]>();
      for (const item of itemsRes.results ?? []) {
        const oid = String(item.order_id);
        const arr = itemsByOrder.get(oid) ?? [];
        arr.push(item);
        itemsByOrder.set(oid, arr);
      }

      for (const o of orders) {
        o.order_items = itemsByOrder.get(String(o.id)) ?? [];
        o.delivery_address_normalized = parseJson(o.delivery_address_normalized);
      }
    }

    return ok({ orders });
  } catch (e) {
    console.error('Order fetch error:', e);
    return fail('Failed to fetch orders', 500);
  }
}
