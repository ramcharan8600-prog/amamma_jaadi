import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { getServiceClient, isSupabaseConfigured } from '@/lib/supabase';
import { createOrderFromSession } from '@/lib/order-service';
import { ok, fail } from '@/lib/api';

const SQUARE_WEBHOOK_SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';
const SQUARE_WEBHOOK_URL = process.env.SQUARE_WEBHOOK_URL || '';

/**
 * Verify Square webhook signature to prevent forged requests.
 * Uses HMAC-SHA256 with the webhook signature key.
 */
function verifySquareSignature(rawBody: string, signature: string): boolean {
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
    if (!isSupabaseConfigured()) {
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
    const db = getServiceClient();

    if (eventType === 'payment.completed' && payment.status === 'COMPLETED') {
      // Square echoes our session id back as reference_id. Match on either the
      // already-stamped square_payment_id (set synchronously by create-payment)
      // OR the reference_id — so the webhook works whether it arrives before or
      // after the synchronous payment call.
      const referenceId: string | undefined = payment.reference_id;

      const { data: session } = await db
        .from('payment_sessions')
        .select('*')
        .or(
          [
            `square_payment_id.eq.${squarePaymentId}`,
            referenceId ? `id.eq.${referenceId}` : '',
          ]
            .filter(Boolean)
            .join(',')
        )
        .limit(1)
        .maybeSingle();

      if (!session) {
        console.error('[webhook] No payment session found for:', squarePaymentId, referenceId);
        return fail('Session not found', 404);
      }

      // createOrderFromSession is idempotent (3-layer dedup on the payment id)
      // — a duplicate webhook returns the existing order rather than creating
      // another. Always 200 so Square does not retry.
      const { orderNumber, duplicate } = await createOrderFromSession(db, session, squarePaymentId);
      if (duplicate) {
        console.log(`[webhook] duplicate delivery for payment ${squarePaymentId} → order ${orderNumber} (no new records)`);
      }
      return ok({ received: true, orderNumber, duplicate });
    }

    // ── FAILED / DECLINED / CANCELED ─────────────────────────
    if (['payment.failed', 'payment.canceled'].includes(eventType) ||
        ['FAILED', 'DECLINED', 'CANCELED'].includes(payment.status)) {
      await db
        .from('payment_sessions')
        .update({ payment_status: 'failed', square_payment_id: squarePaymentId })
        .eq('square_payment_id', squarePaymentId);

      console.log('Payment failed/declined:', squarePaymentId);
      return ok({ received: true });
    }

    // ── REFUND ───────────────────────────────────────────────
    if (eventType === 'refund.created') {
      const refundPaymentId = body.data?.object?.refund?.payment_id;
      if (refundPaymentId) {
        await db
          .from('orders')
          .update({ payment_status: 'refunded' })
          .eq('square_payment_id', refundPaymentId);
      }
      return ok({ received: true });
    }

    return ok({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return fail('Webhook failed', 500);
  }
}
