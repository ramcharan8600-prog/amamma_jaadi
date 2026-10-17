import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { ok, fail } from '@/lib/api';
import { isShipWeek } from '@/lib/delivery-limit';

async function isAuthenticated(): Promise<boolean> {
  const session = (await cookies()).get(SESSION_COOKIE);
  return Boolean(session?.value && verifySessionToken(session.value));
}

/**
 * PUT /api/orders/ship-week — Admin only: { orderId, shipWeek: 'YYYY-MM-DD' (a Monday) | null }
 * moves a delivery order to another shipment week, or clears it.
 */
export async function PUT(request: NextRequest) {
  if (!(await isAuthenticated())) return fail('Unauthorized', 401);
  try {
    if (!isDbConfigured()) return fail('Database not configured', 503);
    const body = await request.json().catch(() => null) as { orderId?: unknown; shipWeek?: unknown } | null;
    const orderId = typeof body?.orderId === 'string' ? body.orderId.trim().slice(0, 100) : '';
    const shipWeek = body?.shipWeek === null || body?.shipWeek === '' ? null : body?.shipWeek;
    if (!orderId || (shipWeek !== null && !isShipWeek(shipWeek))) return fail('Choose a shipment week (a Monday) or none.', 400);
    const result = await getDb().prepare(
      `UPDATE orders SET ship_week = ?, updated_at = datetime('now') WHERE id = ? AND order_type = 'delivery'`,
    ).bind(shipWeek, orderId).run();
    if (!result.meta.changes) return fail('Delivery order not found', 404);
    return ok({ success: true, orderId, shipWeek });
  } catch (e) {
    console.error('Ship week update error:', e);
    return fail('Failed to save the shipment week', 500);
  }
}
