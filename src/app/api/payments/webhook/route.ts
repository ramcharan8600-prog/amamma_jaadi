import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { getDb, isDbConfigured } from '@/lib/db';
import { createOrderFromSession, mapSessionRow } from '@/lib/order-service';
import { ok, fail } from '@/lib/api';

/**
 * Verify Square webhook signature to prevent forged requests.
 * Uses HMAC-SHA256 with the webhook signature key.
 * Secrets read at REQUEST time (not module load) for Cloudflare/OpenNext.
 */
function verifySquareSignature(rawBody: string, signature: string): boolean {
  const SQUARE_WEBHOOK_SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';
  const SQUARE_WEBHOOK_URL = process.env.SQUARE_WEBHOOK_URL || '';
  if (!SQUARE_WEBHOOK_SIGNATURE_KEY) {
    // No key configured — reject all webhook requests in every environment
    console.error('SQUARE_WEBHOOK_SIGNATURE_KEY not set — rejecting webhook');
    return false;
  }

  const hmac = crypto
    .createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(SQUARE_WEBHOOK_URL + rawBody)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(hmac),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

/**
 * POST /api/payments/webhook
 *
 * Square webhook callback. This is the SOURCE OF TRUTH for payments.
 *
 * ONLY on verified COMPLETED payment:
 *   → Create order in orders table
 *   → Create order_items
 *   → Update payment_session with order_id
 *
 * On FAILED/DECLINED/CANCELED:
 *   → Mark payment_session as failed
 *   → Do NOT create any order
 */
export async function POST(request: NextRequest) {
  try {
    if (!isDbConfigured()) {
      return fail('Not configured', 503);
    }

    const rawBody = await request.text();
    const signature = request.headers.get('x-square-hmacsha256-signature') || '';

    // Verify webhook authenticity
    if (!verifySquareSignature(rawBody, signature)) {
      console.error('Webhook signature verification FAILED — rejecting');
      return fail('Invalid signature', 403);
    }

    const body = JSON.parse(rawBody);
    const eventType = body.type;
    const payment = body.data?.object?.payment;

    if (!payment?.id) {
      return fail('No payment data', 400);
    }

    const squarePaymentId = payment.id;
    const db = getDb();
    // Square echoes our session id back as reference_id.
    const referenceId: string | undefined = payment.reference_id;

    // Square sends payment.created / payment.updated (there is no
    // payment.completed event) — completion is signaled by payment.status.
    if (['payment.created', 'payment.updated'].includes(eventType) && payment.status === 'COMPLETED') {
      // Match on either the already-stamped square_payment_id (set synchronously
      // by create-payment) OR the reference_id — so the webhook works whether it
      // arrives before or after the synchronous payment call.
      const raw = await db
        .prepare('SELECT * FROM payment_sessions WHERE square_payment_id = ? OR id = ? LIMIT 1')
        .bind(squarePaymentId, referenceId ?? '')
        .first<Record<string, unknown>>();

      if (!raw) {
        console.error('[webhook] No payment session found for:', squarePaymentId, referenceId);
        return fail('Session not found', 404);
      }

      // createOrderFromSession is idempotent (3-layer dedup on the payment id)
      // — a duplicate webhook returns the existing order rather than creating
      // another. Always 200 so Square does not retry.
      const { orderNumber, duplicate } = await createOrderFromSession(
        db,
        mapSessionRow(raw),
        squarePaymentId
      );
      if (duplicate) {
        console.log(`[webhook] duplicate delivery for payment ${squarePaymentId} → order ${orderNumber} (no new records)`);
      }
      return ok({ received: true, orderNumber, duplicate });
    }

    // ── FAILED / DECLINED / CANCELED ─────────────────────────
    if (['FAILED', 'DECLINED', 'CANCELED'].includes(payment.status)) {
      await db
        .prepare("UPDATE payment_sessions SET payment_status = 'failed', square_payment_id = ? WHERE square_payment_id = ? OR id = ?")
        .bind(squarePaymentId, squarePaymentId, referenceId ?? '')
        .run();

      console.log('Payment failed/declined:', squarePaymentId);
      return ok({ received: true });
    }

    // ── REFUND ───────────────────────────────────────────────
    if (eventType === 'refund.created') {
      const refundPaymentId = body.data?.object?.refund?.payment_id;
      if (refundPaymentId) {
        await db
          .prepare("UPDATE orders SET payment_status = 'refunded' WHERE square_payment_id = ?")
          .bind(refundPaymentId)
          .run();
      }
      return ok({ received: true });
    }

    return ok({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return fail('Webhook failed', 500);
  }
}
