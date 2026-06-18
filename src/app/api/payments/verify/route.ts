import { NextRequest } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
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
    if (!isSupabaseConfigured()) {
      return fail('Not configured', 503);
    }

    const { sessionId } = await request.json();
    if (!sessionId) {
      return fail('Missing sessionId', 400);
    }

    const { data: session, error } = await getSupabase()
      .from('payment_sessions')
      .select('id, payment_status, order_id, expires_at')
      .eq('id', sessionId)
      .single();

    if (error || !session) {
      return fail('Session not found', 404);
    }

    // Check if session expired
    if (session.payment_status === 'pending' && new Date(session.expires_at) < new Date()) {
      await getSupabase()
        .from('payment_sessions')
        .update({ payment_status: 'expired' })
        .eq('id', session.id);
      return ok({ status: 'expired' });
    }

    // If completed, fetch order number
    if (session.payment_status === 'completed' && session.order_id) {
      const { data: order } = await getSupabase()
        .from('orders')
        .select('order_number')
        .eq('id', session.order_id)
        .single();

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
