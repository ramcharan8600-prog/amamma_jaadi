import { NextRequest } from 'next/server';
import { getDb, isDbConfigured } from '@/lib/db';
import { ok, fail } from '@/lib/api';

/**
 * POST /api/payments/verify
 *
 * Frontend polls this after initiating payment.
 * Returns the payment session status.
 * If payment is completed, returns the order number.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isDbConfigured()) {
      return fail('Not configured', 503);
    }

    const { sessionId } = await request.json();
    if (!sessionId) {
      return fail('Missing sessionId', 400);
    }

    const db = getDb();
    const session = await db
      .prepare('SELECT id, payment_status, order_id, expires_at FROM payment_sessions WHERE id = ?')
      .bind(sessionId)
      .first<{ id: string; payment_status: string; order_id: string | null; expires_at: string }>();

    if (!session) {
      return fail('Session not found', 404);
    }

    // Check if session expired
    if (session.payment_status === 'pending' && new Date(session.expires_at) < new Date()) {
      await db
        .prepare("UPDATE payment_sessions SET payment_status = 'expired' WHERE id = ?")
        .bind(session.id)
        .run();
      return ok({ status: 'expired' });
    }

    // If completed, fetch order number
    if (session.payment_status === 'completed' && session.order_id) {
      const order = await db
        .prepare('SELECT order_number FROM orders WHERE id = ?')
        .bind(session.order_id)
        .first<{ order_number: string }>();

      return ok({
        status: 'completed',
        orderNumber: order?.order_number,
      });
    }

    return ok({ status: session.payment_status });
  } catch (e) {
    console.error('Payment verify error:', e);
    return fail('Verification failed', 500);
  }
}
