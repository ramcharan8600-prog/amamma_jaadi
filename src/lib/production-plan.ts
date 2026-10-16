import type { D1Database } from '@cloudflare/workers-types';

/** Days the production plan looks ahead: today, tomorrow and the day after. */
export const PLAN_DAYS = 3;

/** One order in the production plan, with its items (GET /api/admin/production-plan). */
export interface PlanOrder {
  id: string;
  order_number: string;
  customer_name: string;
  order_type: 'pickup' | 'delivery';
  pickup_date: string | null;
  pickup_location: string | null;
  created_at: string;
  /** Delivery orders only: the ship-to address (several lines). */
  delivery_address?: string | null;
  /** Owner's private note (admin only). */
  admin_note?: string | null;
  items: Array<{ product_name: string; quantity: number; selected_tier: number | null }>;
}

export interface ProductionPlan {
  /** Pickup orders by pickup date: today, tomorrow, the day after. */
  days: Array<{ date: string; orders: PlanOrder[] }>;
  /** Delivery orders still waiting to ship (any order date). */
  delivery: PlanOrder[];
}

/**
 * Paid pickup orders for the given dates plus every delivery order still
 * waiting to ship, each with its items. Fully refunded, cancelled and
 * owner-confirmed test orders are left out.
 */
export async function loadProductionPlan(db: D1Database, dates: string[]): Promise<ProductionPlan> {
  const kept = `o.payment_status IN ('paid', 'partially_refunded') AND o.status != 'cancelled'
    AND NOT EXISTS (SELECT 1 FROM order_reporting_exclusions x WHERE x.order_id = o.id)`;
  const planned = `${kept} AND (
    (o.order_type = 'pickup' AND o.pickup_date IN (${dates.map(() => '?').join(', ')}))
    OR (o.order_type = 'delivery' AND COALESCE(o.shipment_status, 'yet_to_ship') = 'yet_to_ship')
  )`;
  const [orders, items] = await Promise.all([
    db.prepare(
      `SELECT o.id, o.order_number, o.customer_name, o.order_type, o.pickup_date, o.pickup_location, o.created_at,
              o.delivery_address, o.admin_note
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
  return {
    days: dates.map((date) => ({ date, orders: withItems.filter((o) => o.order_type === 'pickup' && o.pickup_date === date) })),
    delivery: withItems.filter((o) => o.order_type === 'delivery'),
  };
}
