import { NextRequest } from 'next/server';
import { getServiceClient, isSupabaseConfigured } from '@/lib/supabase';
import { createPayment, isSquareEnabled } from '@/lib/square';
import { createOrderFromSession, type PaymentSessionRow } from '@/lib/order-service';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { sanitize } from '@/lib/sanitize';
import { ok, fail } from '@/lib/api';

/**
 * POST /api/payments/create-payment
 *
 * Charges a tokenized card (from the Square Web Payments SDK) against an
 * existing payment session, then creates the order synchronously via the shared
 * order service. The webhook remains the asynchronous safety net and is
 * idempotent with this route.
 *
 * Body: { sessionId, sourceId, verificationToken? }
 */
export async function POST(request: NextRequest) {
  if (!rateLimit(`create-payment:${getClientIp(request)}`, 10, 60_000)) {
    return fail('Too many requests. Please slow down.', 429);
  }

  if (!isSupabaseConfigured() || !isSquareEnabled()) {
    return fail('Payments are not available right now. Please try again later.', 503);
  }

  try {
    const body = await request.json();
    const sessionId = sanitize(body.sessionId, 64);
    const sourceId = sanitize(body.sourceId, 2048);
    const verificationToken = sanitize(body.verificationToken, 2048) || undefined;

    if (!sessionId || !sourceId) {
      return fail('Missing payment details', 400);
    }

    const db = getServiceClient();

    // Load the session — the server total is authoritative (never trust client).
    const { data: session, error } = await db
      .from('payment_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    if (error || !session) {
      return fail('Payment session not found', 404);
    }

    // Already paid → return the existing order (idempotent, safe to retry).
    if (session.order_id) {
      const { data: existingOrder } = await db
        .from('orders')
        .select('order_number')
        .eq('id', session.order_id)
        .single();
      return ok({ success: true, orderNumber: existingOrder?.order_number, duplicate: true });
    }

    // Reject expired / non-pending sessions.
    if (session.payment_status !== 'pending') {
      return fail('This checkout session is no longer valid. Please start over.', 409);
    }
    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      await db.from('payment_sessions').update({ payment_status: 'expired' }).eq('id', session.id);
      return fail('Your checkout session expired. Please start over.', 409);
    }

    const amountCents = Math.round(Number(session.total_amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return fail('Invalid order amount', 400);
    }

    // ── Charge the card via Square ──────────────────────────────────────
    let payment: { paymentId: string; status: string };
    try {
      payment = await createPayment({
        sourceId,
        amount: amountCents,
        orderId: session.id, // echoed back as reference_id → webhook match key
        idempotencyKey: session.idempotency_key || session.id,
        customerEmail: session.email || undefined,
        verificationToken,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Payment failed';
      console.error('[create-payment] Square charge failed:', message);
      await db
        .from('payment_sessions')
        .update({ payment_status: 'failed' })
        .eq('id', session.id);
      // 402 Payment Required — the card was declined or could not be charged.
      return fail(message || 'Your payment could not be processed.', 402);
    }

    if (payment.status !== 'COMPLETED') {
      console.error('[create-payment] Unexpected payment status:', payment.status);
      return fail('Payment was not completed. Please try a different card.', 402);
    }

    // ── Create the order synchronously (idempotent w/ the webhook) ──────
    const result = await createOrderFromSession(
      db,
      session as PaymentSessionRow,
      payment.paymentId
    );

    return ok({ success: true, orderNumber: result.orderNumber });
  } catch (e) {
    console.error('[create-payment] error:', e);
    return fail('Payment processing failed. Please try again.', 500);
  }
}
