import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { businessDateOffset } from '@/lib/date';
import { ok, fail } from '@/lib/api';
import { sanitize } from '@/lib/sanitize';
import { isShipmentStatus, updateShipmentDetails } from '@/lib/shipment';

async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  return Boolean(session?.value && verifySessionToken(session.value));
}

/**
 * GET /api/orders — Admin only: fetch paid and refunded orders.
 * Pending, failed, and canceled orders remain excluded.
 */
export async function GET(request: NextRequest) {
  // Verify admin session
  if (!(await isAuthenticated())) {
    return fail('Unauthorized', 401);
  }

  try {
    if (!isDbConfigured()) {
      return ok({ orders: [] });
    }

    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';
    const db = getDb();

    // Paid and refunded orders remain visible so the dashboard reflects Square.
    const where = ["payment_status IN ('paid', 'partially_refunded', 'refunded')"];
    const binds: unknown[] = [];
    // Include a stable id tiebreaker so the order list and item subquery select
    // the same 200 rows even when multiple orders share a timestamp.
    let orderBy = 'created_at DESC, id DESC';

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
        orderBy = 'pickup_date ASC, created_at ASC, id ASC';
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
      // Repeat the bounded order selection as a subquery instead of binding up
      // to 200 IDs. D1 accepts at most 100 bound parameters per statement.
      const itemsRes = await db
        .prepare(
          `SELECT oi.* FROM order_items oi
           JOIN (
             SELECT id FROM orders
             WHERE ${where.join(' AND ')}
             ORDER BY ${orderBy}
             LIMIT 200
           ) selected ON selected.id = oi.order_id`
        )
        .bind(...binds)
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
      }
    }

    return ok({ orders });
  } catch (e) {
    console.error('Order fetch error:', e);
    return fail('Failed to fetch orders', 500);
  }
}

/** PATCH /api/orders — Admin only: update delivery shipment details. */
export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return fail('Unauthorized', 401);
  }

  try {
    if (!isDbConfigured()) return fail('Database not configured', 503);

    const body = await request.json();
    const orderId = sanitize(body.orderId, 100);
    const shipmentStatus = sanitize(body.shipmentStatus, 30);
    const trackingId = sanitize(body.trackingId, 120);

    if (!orderId) return fail('Order id is required', 400);
    if (!isShipmentStatus(shipmentStatus)) {
      return fail('Invalid shipment status', 400);
    }

    const updated = await updateShipmentDetails(getDb(), {
      orderId,
      shipmentStatus,
      trackingId: trackingId || null,
    });
    if (!updated) return fail('Delivery order not found', 404);

    return ok({
      success: true,
      orderId,
      shipmentStatus,
      trackingId: trackingId || null,
    });
  } catch (e) {
    console.error('Shipment update error:', e);
    return fail('Failed to update shipment', 500);
  }
}
