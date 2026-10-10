import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { ok, fail } from '@/lib/api';
import { sanitize } from '@/lib/sanitize';
import { buildOrderFilters } from '@/lib/order-filters';
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

/** Largest page the API returns (analytics reads every order in pages this size). */
const MAX_ORDERS_PAGE_SIZE = 1000;

function boundedInt(value: string | null, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return value !== null && Number.isSafeInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  return Boolean(session?.value && verifySessionToken(session.value));
}

/**
 * GET /api/orders — Admin only: one page of paid and refunded orders (newest
 * first, `page` / `pageSize`) with the matching `total`.
 * Pending, failed, and canceled orders remain excluded.
 */
export async function GET(request: NextRequest) {
  // Verify admin session
  if (!(await isAuthenticated())) {
    return fail('Unauthorized', 401);
  }

  try {
    if (!isDbConfigured()) {
      return ok({ orders: [], total: 0, page: 1, pageSize: 0 });
    }

    const { searchParams } = new URL(request.url);
    const filters = buildOrderFilters(searchParams);
    if ('error' in filters) return fail(filters.error, 400);
    const { where, binds, orderBy } = filters;
    // One page of orders, with the total so the dashboard can page through all
    // of them. Without page/pageSize: the first 200 (an open tab from an older release).
    const pageSize = boundedInt(searchParams.get('pageSize'), 1, MAX_ORDERS_PAGE_SIZE, 200);
    const page = boundedInt(searchParams.get('page'), 1, 1_000_000, 1);
    const offset = (page - 1) * pageSize;
    const db = getDb();

    const totalRes = await db
      .prepare(`SELECT COUNT(*) AS total FROM orders WHERE ${where.join(' AND ')}`)
      .bind(...binds)
      .first<{ total: number }>();
    const total = Number(totalRes?.total ?? 0);

    const ordersRes = await db
      .prepare(`SELECT orders.*, EXISTS (
        SELECT 1 FROM order_reporting_exclusions x WHERE x.order_id = orders.id
      ) AS is_test_order FROM orders WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .bind(...binds, pageSize, offset)
      .all<Record<string, unknown>>();
    const orders = ordersRes.results ?? [];

    // Attach nested order_items (one query joined to all paid orders) so the
    // analytics page can compute product breakdowns — mirrors the old shape.
    if (orders.length > 0) {
      // Repeat the page's order selection as a subquery instead of binding every
      // ID. D1 accepts at most 100 bound parameters per statement.
      const itemsRes = await db
        .prepare(
          `SELECT oi.* FROM order_items oi
           JOIN (
             SELECT id FROM orders
             WHERE ${where.join(' AND ')}
             ORDER BY ${orderBy}
             LIMIT ? OFFSET ?
           ) selected ON selected.id = oi.order_id`
        )
        .bind(...binds, pageSize, offset)
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

    return ok({ orders, total, page, pageSize });
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
