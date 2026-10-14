import type { D1Database } from '@cloudflare/workers-types';
import { getPaymentRefundSummary } from '@/lib/square';

import { prepareRefundFacts, type RefundFacts } from '@/lib/tax-refunds';
import { buildRefundEmail, refundDestinationLabel } from '@/lib/email-service';
import { prepareEmailOutboxInsert, publishPersistedEmail } from '@/lib/email-outbox';

export type RefundPaymentLookup = (paymentId: string) => Promise<{
  totalAmount: number;
  refundedAmount: number;
  referenceId?: string;
  cardBrand?: string;
  cardLast4?: string;
}>;

interface RefundOrderRow {
  id: string;
  order_number?: string;
  customer_name?: string;
  email?: string | null;
  total_price?: number;
}

/**
 * The customer's "refund initiated" email, sent once per Square refund on the
 * first PENDING or COMPLETED event (card refunds can sit PENDING for hours).
 * An email problem never fails the refund webhook: it is logged and skipped.
 */
async function queueRefundEmail(
  db: D1Database,
  order: RefundOrderRow,
  refund: RefundFacts,
  lookupPayment: RefundPaymentLookup
): Promise<void> {
  try {
    const cents = refund.amount_money?.amount;
    if (!refund.id || !order.email || !order.order_number || !Number.isSafeInteger(cents) || (cents ?? 0) <= 0) return;
    const items = await db
      .prepare('SELECT product_name, quantity, selected_tier FROM order_items WHERE order_id = ? ORDER BY rowid')
      .bind(order.id)
      .all<{ product_name: string; quantity: number; selected_tier: number | null }>();
    let card: { cardBrand?: string; cardLast4?: string } = {};
    try { card = await lookupPayment(refund.payment_id!); } catch { /* Fall back to "original payment method". */ }
    const amount = (cents as number) / 100;
    const email = buildRefundEmail({
      to: order.email,
      refundId: refund.id,
      orderNumber: order.order_number,
      customerName: order.customer_name ?? '',
      items: (items.results ?? []).map((i) => ({ name: i.product_name, quantity: Number(i.quantity) || 1, selectedTier: i.selected_tier })),
      amount,
      full: amount + 0.005 >= Number(order.total_price ?? Infinity),
      refundedTo: refundDestinationLabel(card.cardBrand, card.cardLast4),
      initiatedOn: new Date(),
    });
    await prepareEmailOutboxInsert(db, email).statement.run();
    await publishPersistedEmail(db, email.dedupeKey);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'refund_email_failed',
      refundId: refund.id ?? null,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

const REFUND_ORDER_SQL =
  'SELECT id, order_number, customer_name, email, total_price FROM orders WHERE square_payment_id = ? LIMIT 1';

/**
 * Apply Square refund events before attempting to parse a payment object.
 * Refund webhook payloads contain `data.object.refund`, not
 * `data.object.payment`. Only COMPLETED refunds change the order: created
 * events may still be PENDING, with the final outcome arriving on updated.
 */
export async function processRefundEvent(
  db: D1Database,
  eventType: string,
  refund: RefundFacts | undefined,
  lookupPayment: RefundPaymentLookup = getPaymentRefundSummary
): Promise<{
  handled: boolean;
  updated: boolean;
  paymentStatus?: 'partially_refunded' | 'refunded';
  reason?: string;
}> {
  if (!['refund.created', 'refund.updated'].includes(eventType)) {
    return { handled: false, updated: false };
  }

  if (!refund?.payment_id) {
    console.warn(JSON.stringify({ event: 'square_refund_ignored', reason: 'missing_payment_id' }));
    return { handled: true, updated: false, reason: 'missing payment id' };
  }

  if (refund.status === 'PENDING') {
    const order = await db.prepare(REFUND_ORDER_SQL).bind(refund.payment_id).first<RefundOrderRow>();
    if (order) await queueRefundEmail(db, order, refund, lookupPayment);
  }

  if (refund.status !== 'COMPLETED') {
    console.log(JSON.stringify({
      event: 'square_refund_pending',
      refundId: refund.id ?? null,
      paymentId: refund.payment_id,
      status: refund.status ?? 'UNKNOWN',
    }));
    return { handled: true, updated: false, reason: `refund ${refund.status ?? 'UNKNOWN'}` };
  }

  // Square's Payment object reports the cumulative amount refunded across one
  // or many partial refunds. A single refund event cannot safely tell us
  // whether the entire payment has now been refunded.
  const payment = await lookupPayment(refund.payment_id);
  if (payment.refundedAmount <= 0) {
    throw new Error('Completed refund is not yet reflected on the Square payment');
  }
  const paymentStatus = payment.refundedAmount >= payment.totalAmount
    ? 'refunded'
    : 'partially_refunded';

  const order = await db
    .prepare(REFUND_ORDER_SQL)
    .bind(refund.payment_id)
    .first<RefundOrderRow>();

  if (!order) {
    // A refund for another Square sales channel is not a website order and can
    // be acknowledged. If a matching website session exists, however, order
    // creation and refund delivery raced; throw so Square retries the webhook.
    const session = await db
      .prepare(
        'SELECT id FROM payment_sessions WHERE square_payment_id = ? OR id = ? LIMIT 1'
      )
      .bind(refund.payment_id, payment.referenceId ?? '')
      .first<{ id: string }>();
    if (session) {
      throw new Error('Refund arrived before the website order was available');
    }

    console.log(JSON.stringify({
      event: 'square_refund_ignored',
      reason: 'not_website_payment',
      refundId: refund.id ?? null,
      paymentId: refund.payment_id,
    }));
    return { handled: true, updated: false, reason: 'not website payment' };
  }

  await db.batch([
    ...prepareRefundFacts(db, order.id, refund),
    db.prepare(
      'UPDATE orders SET payment_status = ?, refunded_amount = MAX(refunded_amount, ?) WHERE square_payment_id = ? AND refunded_amount <= ?'
    ).bind(paymentStatus, payment.refundedAmount / 100, refund.payment_id, payment.refundedAmount / 100),
    db.prepare(
      `UPDATE payment_sessions SET payment_status = (SELECT payment_status FROM orders WHERE id = ?)
       WHERE square_payment_id = ? OR id = ?`
    ).bind(order.id, refund.payment_id, payment.referenceId ?? ''),
  ]);

  // Refunds that complete without a PENDING event still get their email (deduplicated per refund).
  await queueRefundEmail(db, order, refund, lookupPayment);

  console.log(JSON.stringify({
    event: paymentStatus === 'refunded'
      ? 'square_refund_completed'
      : 'square_refund_partially_completed',
    refundId: refund.id ?? null,
    paymentId: refund.payment_id,
    refundedAmount: payment.refundedAmount,
    totalAmount: payment.totalAmount,
  }));
  return { handled: true, updated: true, paymentStatus };
}
