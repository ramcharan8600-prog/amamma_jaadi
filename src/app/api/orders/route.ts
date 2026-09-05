import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { businessDateOffset, businessDateUtcRange } from '@/lib/date';
import { ok, fail } from '@/lib/api';
import { sanitize } from '@/lib/sanitize';
import { PICKUP_LOCATIONS } from '@/data/products';
import {
  isShipmentStatus,
  updateShipmentDetails,
  updateShipmentDetailsBatch,
  type ShipmentUpdate,
} from '@/lib/shipment';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseShipmentUpdate(value: unknown): ShipmentUpdate | null {
  if (!isRecord(value)) return null;

  const orderId = sanitize(value.orderId, 100);
  const shipmentStatus = sanitize(value.shipmentStatus, 30);
  const trackingId = sanitize(value.trackingId, 120);
  if (!orderId || !isShipmentStatus(shipmentStatus)) return null;

  return { orderId, shipmentStatus, trackingId: trackingId || null };
}

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
    // `pickupDate` remains accepted for compatibility with an open dashboard
    // tab from the previous release; `date` covers both order types.
    const dateFilter = sanitize(
      searchParams.get('date') ?? searchParams.get('pickupDate'),
      10
    );
    const shipmentStatusFilter = sanitize(searchParams.get('shipmentStatus'), 30);
    const pickupLocation = sanitize(searchParams.get('pickupLocation'), 100);
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

    if (dateFilter) {
      const deliveryDateRange = businessDateUtcRange(dateFilter);
      if (!deliveryDateRange) return fail('Invalid date filter', 400);
      where.push(`(
        (order_type = 'pickup' AND pickup_date = ?)
        OR
        (order_type = 'delivery' AND created_at >= ? AND created_at < ?)
      )`);
      binds.push(dateFilter, deliveryDateRange.start, deliveryDateRange.end);
    }

    if (shipmentStatusFilter) {
      if (shipmentStatusFilter === 'pickup') {
        where.push("order_type = 'pickup'");
      } else {
        if (!isShipmentStatus(shipmentStatusFilter)) {
          return fail('Invalid shipment status filter', 400);
        }
        where.push("order_type = 'delivery'");
        where.push('shipment_status = ?');
        binds.push(shipmentStatusFilter);
        if (shipmentStatusFilter === 'yet_to_ship') {
          // The outstanding-dispatch view is a work queue, not audit history.
          // Fully refunded or cancelled orders must never be packed.
          where.push("payment_status != 'refunded'");
          where.push("status != 'cancelled'");
        }
      }
    }

    if (pickupLocation) {
      const knownLocation = PICKUP_LOCATIONS.some((location) => location.id === pickupLocation);
      if (!knownLocation) return fail('Invalid pickup location filter', 400);
      where.push("order_type = 'pickup'");
      where.push('pickup_location = ?');
      binds.push(pickupLocation);
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

/** PATCH /api/orders — Admin only: update one or many delivery shipment rows. */
export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return fail('Unauthorized', 401);
  }

  try {
    if (!isDbConfigured()) return fail('Database not configured', 503);

    const body: unknown = await request.json();
    if (!isRecord(body)) return fail('Invalid shipment update', 400);

    if (Array.isArray(body.updates)) {
      if (body.updates.length === 0) return fail('At least one update is required', 400);
      if (body.updates.length > 200) return fail('A maximum of 200 updates is allowed', 400);

      const parsed: ShipmentUpdate[] = [];
      for (const value of body.updates) {
        const update = parseShipmentUpdate(value);
        if (!update) return fail('One or more shipment updates are invalid', 400);
        parsed.push(update);
      }

      // Last edit wins if a malformed/replayed client sends the same order twice.
      const uniqueUpdates = Array.from(
        new Map(parsed.map((update) => [update.orderId, update])).values()
      );
      const result = await updateShipmentDetailsBatch(getDb(), uniqueUpdates);
      return ok({
        success: result.notUpdatedOrderIds.length === 0,
        ...result,
      });
    }

    const update = parseShipmentUpdate(body);
    if (!update) return fail('Invalid shipment update', 400);

    const updated = await updateShipmentDetails(getDb(), update);
    if (!updated) return fail('Delivery order not found', 404);

    return ok({
      success: true,
      orderId: update.orderId,
      shipmentStatus: update.shipmentStatus,
      trackingId: update.trackingId,
    });
  } catch (e) {
    console.error('Shipment update error:', e);
    return fail('Failed to update shipment', 500);
  }
}
