import { NextRequest } from 'next/server';
import { getDb, isDbConfigured } from '@/lib/db';
import { createPayment, isSquareEnabled } from '@/lib/square';
import { createOrderFromSession, mapSessionRow } from '@/lib/order-service';
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

  if (!isDbConfigured() || !isSquareEnabled()) {
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

    const db = getDb();

    // Load the session — the server total is authoritative (never trust client).
    const session = await db
      .prepare('SELECT * FROM payment_sessions WHERE id = ?')
      .bind(sessionId)
      .first<Record<string, unknown>>();

    if (!session) {
      return fail('Payment session not found', 404);
    }

    // Already paid → return the existing order (idempotent, safe to retry).
    if (session.order_id) {
      const existingOrder = await db
        .prepare('SELECT order_number FROM orders WHERE id = ?')
        .bind(session.order_id as string)
        .first<{ order_number: string }>();
      return ok({ success: true, orderNumber: existingOrder?.order_number, duplicate: true });
    }

    // Reject expired / non-pending sessions.
    if (session.payment_status !== 'pending') {
      return fail('This checkout session is no longer valid. Please start over.', 409);
    }
    if (session.expires_at && new Date(session.expires_at as string) < new Date()) {
      await db.prepare("UPDATE payment_sessions SET payment_status = 'expired' WHERE id = ?").bind(sessionId).run();
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
        orderId: sessionId, // echoed back as reference_id → webhook match key
        idempotencyKey: (session.idempotency_key as string) || sessionId,
        customerEmail: (session.email as string) || undefined,
        verificationToken,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Payment failed';
      console.error('[create-payment] Square charge failed:', message);
      await db.prepare("UPDATE payment_sessions SET payment_status = 'failed' WHERE id = ?").bind(sessionId).run();
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
      mapSessionRow(session),
      payment.paymentId
    );

    return ok({ success: true, orderNumber: result.orderNumber });
  } catch (e) {
    console.error('[create-payment] error:', e);
    return fail('Payment processing failed. Please try again.', 500);
  }
}
