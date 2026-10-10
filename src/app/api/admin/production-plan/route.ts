import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { businessDateOffset } from '@/lib/date';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { PLAN_DAYS, type PlanOrder, type ProductionPlan } from '@/lib/production-plan';

const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

/**
 * GET /api/admin/production-plan — Admin only: what to make for the next three
 * days. Pickup orders by pickup date (today, tomorrow, the day after) and
 * delivery orders still waiting to ship, each with their items. Paid and
 * partially refunded orders only; fully refunded, cancelled and owner-confirmed
 * test orders are left out.
 */
export async function GET() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session || !verifySessionToken(session)) return json({ error: 'Unauthorized' }, 401);
  if (!isDbConfigured()) return json({ error: 'Database unavailable' }, 503);

  try {
    const dates = Array.from({ length: PLAN_DAYS }, (_, i) => businessDateOffset(i));
    const kept = `o.payment_status IN ('paid', 'partially_refunded') AND o.status != 'cancelled'
      AND NOT EXISTS (SELECT 1 FROM order_reporting_exclusions x WHERE x.order_id = o.id)`;
    const planned = `${kept} AND (
      (o.order_type = 'pickup' AND o.pickup_date IN (${dates.map(() => '?').join(', ')}))
      OR (o.order_type = 'delivery' AND COALESCE(o.shipment_status, 'yet_to_ship') = 'yet_to_ship')
    )`;
    const db = getDb();
    const [orders, items] = await Promise.all([
      db.prepare(
        `SELECT o.id, o.order_number, o.customer_name, o.order_type, o.pickup_date, o.pickup_location, o.created_at
         FROM orders o WHERE ${planned}
         ORDER BY o.pickup_date, o.pickup_location, o.created_at, o.id`
      ).bind(...dates).all<Omit<PlanOrder, 'items'>>(),
      db.prepare(
        `SELECT oi.order_id, oi.product_name, oi.quantity, oi.selected_tier
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE ${planned}
         ORDER BY oi.rowid`
      ).bind(...dates).all<{ order_id: string; product_name: string; quantity: number; selected_tier: number | null }>(),
    ]);

    const itemsByOrder = new Map<string, PlanOrder['items']>();
    for (const { order_id, ...item } of items.results ?? []) {
      itemsByOrder.set(order_id, [...(itemsByOrder.get(order_id) ?? []), item]);
    }
    const withItems = (orders.results ?? []).map((order) => ({ ...order, items: itemsByOrder.get(order.id) ?? [] }));

    const plan: ProductionPlan = {
      days: dates.map((date) => ({ date, orders: withItems.filter((o) => o.order_type === 'pickup' && o.pickup_date === date) })),
      delivery: withItems.filter((o) => o.order_type === 'delivery'),
    };
    return json(plan);
  } catch (e) {
    console.error('Production plan error:', e);
    return json({ error: 'Failed to load the production plan' }, 500);
  }
}
