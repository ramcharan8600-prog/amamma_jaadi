import type { D1Database } from '@cloudflare/workers-types';
import { createOrderFromSession, mapSessionRow } from '@/lib/order-service';
import { validateCart } from '@/lib/cart-validation';
import { getTotalPieces } from '@/data/products';
import { getPickupDateError } from '@/lib/pickup-date';
import { calculateOrderTotals, getDeliveryMinimumShortfall, isSupportedDeliveryState, normalizeStateCode } from '@/lib/pricing';
import {
  buildSquarePaymentRequest,
  executeSquarePaymentRequest,
  SquarePaymentError,
  type SquarePaymentRequest,
  type SquarePaymentResult,
} from '@/lib/square';

interface AttemptRow {
  session_id: string;
  idempotency_key: string;
  request_json: string | null;
  state: 'processing' | 'unknown' | 'completed' | 'declined';
  square_payment_id: string | null;
  lease_token: string | null;
  lease_until: string | null;
  last_error_code: string | null;
  created_at: string;
  attempt_count: number;
}

export interface PaymentReply {
  httpStatus: number;
  success: boolean;
  status: 'pending' | 'processing' | 'unknown' | 'completed' | 'declined' | 'expired';
  code: string;
  canStartNewSession: boolean;
  retryAfterSeconds?: number;
  error?: string;
  orderNumber?: string;
}

export interface PaymentAttemptDependencies {
  execute?: (request: SquarePaymentRequest) => Promise<SquarePaymentResult>;
  finalize?: typeof createOrderFromSession;
}

export function pendingPaymentReply(code = 'PAYMENT_PENDING'): PaymentReply {
  return {
    httpStatus: 202, success: false, status: 'unknown', code,
    canStartNewSession: false, retryAfterSeconds: 5,
    error: 'We are confirming your payment. Please check its status before trying another payment.',
  };
}

function declinedReply(): PaymentReply {
  return {
    httpStatus: 402, success: false, status: 'declined', code: 'PAYMENT_DECLINED',
    canStartNewSession: true,
    error: 'Your card was declined. Please try a different card or contact your bank.',
  };
}

function expiredReply(): PaymentReply {
  return {
    httpStatus: 409, success: false, status: 'expired', code: 'SESSION_EXPIRED',
    canStartNewSession: true,
    error: 'This checkout was not charged. Please return to your details to start again.',
  };
}

const MAX_REPLAYS = 12;
const REPLAY_WINDOW_MS = 30 * 60_000;

function replayAllowed(attempt: AttemptRow): boolean {
  const created = Date.parse(attempt.created_at.replace(' ', 'T') + 'Z');
  return Number.isFinite(created) && Date.now() - created < REPLAY_WINDOW_MS &&
    attempt.attempt_count < MAX_REPLAYS;
}

function reviewReply(): PaymentReply {
  return {
    ...pendingPaymentReply('PAYMENT_REVIEW_REQUIRED'), retryAfterSeconds: undefined,
    error: 'Your payment needs to be checked. Please contact us before making another payment.',
  };
}

/** Old unattempted sessions must not preserve a pre-fix price/quantity exploit. */
function validateUnattemptedSession(session: Record<string, unknown>) {
  try {
    const cart = validateCart(typeof session.cart_data === 'string' ? JSON.parse(session.cart_data) : session.cart_data);
    if (!cart.ok) return null;
    const fulfillment = typeof session.fulfillment_data === 'string' ? JSON.parse(session.fulfillment_data) : session.fulfillment_data;
    if (!fulfillment || typeof fulfillment !== 'object' || Array.isArray(fulfillment) ||
        (fulfillment.type !== 'pickup' && fulfillment.type !== 'delivery')) return null;
    const delivery = fulfillment?.type === 'delivery';
    // Recheck only before the FIRST charge, including sessions opened before
    // midnight or this fix. Never interrupt an existing payment's recovery.
    if (!delivery && getPickupDateError(fulfillment.date, getTotalPieces(cart.items))) return null;
    const state = normalizeStateCode(fulfillment.state);
    if (delivery && (!isSupportedDeliveryState(state) ||
        getDeliveryMinimumShortfall(cart.subtotal, state) > 0 ||
        cart.items.some(item => item.product.deliveryStateCodes?.length &&
          !item.product.deliveryStateCodes.includes(state) &&
          cart.subtotal < (item.product.deliveryOutsideStateMinimum ?? Number.POSITIVE_INFINITY)))) return null;
    const expected = calculateOrderTotals(cart.subtotal, {
      taxableSubtotal: cart.taxableSubtotal, fulfillmentType: delivery ? 'delivery' : 'pickup',
      deliveryState: delivery ? state : undefined,
    });
    for (const [stored, current] of [[session.total_amount, expected.total],
      [session.tax ?? 0, expected.tax], [session.shipping ?? 0, expected.shipping]]) {
      if (typeof stored !== 'number' || !Number.isFinite(stored) ||
          Math.round(stored * 100) !== Math.round(Number(current) * 100)) return null;
    }
    return cart.items;
  } catch {
    return null;
  }
}

async function readSession(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM payment_sessions WHERE id = ?')
    .bind(id).first<Record<string, unknown>>();
}

async function readAttempt(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM payment_attempts WHERE session_id = ?')
    .bind(id).first<AttemptRow>();
}

function paymentNote(session: Record<string, unknown>): string {
  const cart: Array<{ product?: { name?: string }; selectedVariant?: string; quantity?: number }> =
    typeof session.cart_data === 'string' ? JSON.parse(session.cart_data) : [];
  const labels = cart.map(item => {
    const name = item.product?.name || 'Item';
    return `${name}${item.selectedVariant ? ` (${item.selectedVariant})` : ''}${(item.quantity ?? 1) > 1 ? ` x${item.quantity}` : ''}`;
  });
  return `amammajaadi.com — ${labels.join(', ') || 'online order'}`.slice(0, 500);
}

/** Status checks never initiate a new charge. A saved completed payment can finish its order. */
export async function getPaymentAttemptStatus(
  db: D1Database,
  sessionId: string,
  dependencies: PaymentAttemptDependencies = {}
): Promise<PaymentReply> {
  const session = await readSession(db, sessionId);
  if (!session) return { ...pendingPaymentReply('SESSION_NOT_FOUND'), httpStatus: 404 };
  const attempt = await readAttempt(db, sessionId);
  let paymentId = attempt?.state === 'completed' ? attempt.square_payment_id :
    session.order_id || ['completed', 'partially_refunded', 'refunded'].includes(String(session.payment_status))
      ? session.square_payment_id as string | null : null;
  if (!paymentId && session.order_id) {
    const order = await db.prepare('SELECT square_payment_id FROM orders WHERE id = ?')
      .bind(session.order_id).first<{ square_payment_id: string | null }>();
    paymentId = order?.square_payment_id ?? null;
  }

  if (paymentId) {
    try {
      const result = await (dependencies.finalize ?? createOrderFromSession)(
        db, mapSessionRow(session), paymentId
      );
      // Covers webhook completion arriving before our response or a browser reload.
      await db.prepare(
        `UPDATE payment_attempts SET state = 'completed', square_payment_id = ?,
         request_json = NULL, lease_token = NULL, lease_until = NULL,
         resolved_at = COALESCE(resolved_at, datetime('now')), updated_at = datetime('now')
         WHERE session_id = ?`
      ).bind(paymentId, sessionId).run();
      return {
        httpStatus: 200, success: true, status: 'completed', code: 'PAYMENT_COMPLETED',
        canStartNewSession: false, orderNumber: result.orderNumber,
      };
    } catch {
      // Payment is already accepted. An order write failure must never invite a new charge.
      return pendingPaymentReply('ORDER_FINALIZING');
    }
  }
  if (attempt?.state === 'declined') return declinedReply();
  if (attempt) return replayAllowed(attempt)
    ? { ...pendingPaymentReply(), status: attempt.state === 'processing' ? 'processing' : 'unknown' }
    : reviewReply();
  if (session.payment_status === 'expired') return expiredReply();
  // Legacy failed rows were not distinguished from network errors. Do not assume
  // they are safe to recharge. A pending row may also have a request in flight.
  return pendingPaymentReply(session.payment_status === 'pending' ? 'PAYMENT_NOT_STARTED' : 'PAYMENT_REVIEW_REQUIRED');
}

/**
 * Save once, then replay exactly. A lease limits concurrent work; Square's original
 * idempotency key is the final guard if a Worker stops after sending the request.
 */
export async function runPaymentAttempt(
  db: D1Database,
  input: { sessionId: string; sourceId?: string; verificationToken?: string; retry?: boolean },
  dependencies: PaymentAttemptDependencies = {}
): Promise<PaymentReply> {
  const { sessionId } = input;
  let session = await readSession(db, sessionId);
  if (!session) return { ...pendingPaymentReply('SESSION_NOT_FOUND'), httpStatus: 404 };
  let attempt = await readAttempt(db, sessionId);
  if (session.order_id || attempt?.state === 'completed' || attempt?.state === 'declined') {
    return getPaymentAttemptStatus(db, sessionId, dependencies);
  }

  if (!attempt && input.retry) {
    // A disconnected initial POST might not have reached INSERT yet. Closing its
    // session with this atomic guard makes even a late original POST harmless.
    await db.prepare(
      `UPDATE payment_sessions SET payment_status = 'expired'
       WHERE id = ? AND payment_status = 'pending' AND order_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM payment_attempts WHERE session_id = ?)`
    ).bind(sessionId, sessionId).run();
    attempt = await readAttempt(db, sessionId);
    if (!attempt) return getPaymentAttemptStatus(db, sessionId, dependencies);
  }

  if (!attempt) {
    if (!input.sourceId) return { ...pendingPaymentReply('MISSING_PAYMENT_DETAILS'), httpStatus: 400 };
    const canonicalItems = validateUnattemptedSession(session);
    if (!canonicalItems) {
      await db.prepare(
        `UPDATE payment_sessions SET payment_status = 'expired'
         WHERE id = ? AND payment_status = 'pending' AND order_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM payment_attempts WHERE session_id = ?)`
      ).bind(sessionId, sessionId).run();
      return getPaymentAttemptStatus(db, sessionId, dependencies);
    }
    const amount = Math.round(Number(session.total_amount) * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return { ...pendingPaymentReply('INVALID_ORDER_AMOUNT'), httpStatus: 400 };
    }
    const request = buildSquarePaymentRequest({
      sourceId: input.sourceId, verificationToken: input.verificationToken,
      amount, orderId: sessionId,
      idempotencyKey: String(session.idempotency_key || sessionId),
      customerEmail: typeof session.email === 'string' ? session.email : undefined,
      note: paymentNote(session),
    });
    await db.batch([
      db.prepare(
        `INSERT INTO payment_attempts (session_id, idempotency_key, request_json, state)
         SELECT id, ?, ?, 'processing' FROM payment_sessions
         WHERE id = ? AND payment_status = 'pending' AND order_id IS NULL
           AND datetime(expires_at) > datetime('now')
         ON CONFLICT(session_id) DO NOTHING`
      ).bind(request.body.idempotency_key, JSON.stringify(request), sessionId),
      db.prepare(
        `UPDATE payment_sessions SET payment_status = 'processing', cart_data = ?
         WHERE id = ? AND payment_status = 'pending' AND order_id IS NULL
           AND EXISTS (SELECT 1 FROM payment_attempts WHERE session_id = ?)`
      ).bind(JSON.stringify(canonicalItems), sessionId, sessionId),
    ]);
    attempt = await readAttempt(db, sessionId);
    if (!attempt) {
      await db.prepare(
        `UPDATE payment_sessions SET payment_status = 'expired'
         WHERE id = ? AND payment_status = 'pending' AND datetime(expires_at) <= datetime('now')
           AND NOT EXISTS (SELECT 1 FROM payment_attempts WHERE session_id = ?)`
      ).bind(sessionId, sessionId).run();
      return getPaymentAttemptStatus(db, sessionId, dependencies);
    }
  }

  if (!attempt.request_json) return getPaymentAttemptStatus(db, sessionId, dependencies);
  if (!replayAllowed(attempt)) return reviewReply();
  const request = JSON.parse(attempt.request_json) as SquarePaymentRequest;
  if ((input.sourceId !== undefined && input.sourceId !== request.body.source_id) ||
      (input.verificationToken !== undefined && input.verificationToken !== request.body.verification_token)) {
    return { ...pendingPaymentReply('PAYMENT_ATTEMPT_MISMATCH'), httpStatus: 409 };
  }
  const leaseToken = crypto.randomUUID();
  const claimed = await db.prepare(
    `UPDATE payment_attempts SET state = 'processing', lease_token = ?,
       lease_until = datetime('now', '+45 seconds'), attempt_count = attempt_count + 1,
       updated_at = datetime('now')
     WHERE session_id = ? AND state IN ('processing', 'unknown')
       AND (lease_until IS NULL OR lease_until <= datetime('now'))
       AND datetime(created_at, '+30 minutes') > datetime('now') AND attempt_count < ?
     RETURNING session_id`
  ).bind(leaseToken, sessionId, MAX_REPLAYS).first<{ session_id: string }>();
  if (!claimed) return getPaymentAttemptStatus(db, sessionId, dependencies);

  let payment: SquarePaymentResult;
  try {
    payment = await (dependencies.execute ?? executeSquarePaymentRequest)(request);
    if (payment.status === 'FAILED' || payment.status === 'CANCELED') {
      throw new SquarePaymentError('PAYMENT_DECLINED', true, payment.paymentId);
    }
    if (payment.status !== 'COMPLETED') throw new SquarePaymentError('PAYMENT_NOT_COMPLETED');
  } catch (error) {
    const confirmedDecline = error instanceof SquarePaymentError && error.confirmedDecline;
    const code = error instanceof SquarePaymentError ? error.code : 'PAYMENT_RESPONSE_UNKNOWN';
    try {
      await db.batch([
        db.prepare(
          `UPDATE payment_attempts SET state = ?, last_error_code = ?,
             request_json = CASE WHEN ? = 1 THEN NULL ELSE request_json END,
             lease_token = NULL, lease_until = NULL, updated_at = datetime('now'),
             resolved_at = CASE WHEN ? = 1 THEN datetime('now') ELSE resolved_at END
           WHERE session_id = ? AND lease_token = ? AND state IN ('processing', 'unknown')`
        ).bind(confirmedDecline ? 'declined' : 'unknown', code, confirmedDecline ? 1 : 0,
          confirmedDecline ? 1 : 0, sessionId, leaseToken),
        db.prepare(
          `UPDATE payment_sessions SET payment_status = ? WHERE id = ? AND order_id IS NULL
           AND payment_status IN ('pending', 'processing', 'unknown', 'failed')
           AND EXISTS (SELECT 1 FROM payment_attempts WHERE session_id = ? AND state = ?)`
        ).bind(confirmedDecline ? 'failed' : 'unknown', sessionId, sessionId,
          confirmedDecline ? 'declined' : 'unknown'),
      ]);
      return getPaymentAttemptStatus(db, sessionId, dependencies);
    } catch {
      // If persistence failed, the saved processing attempt remains recoverable.
      return pendingPaymentReply();
    }
  }

  try {
    await db.batch([
      db.prepare(
        `UPDATE payment_attempts SET state = 'completed', square_payment_id = ?, request_json = NULL,
         lease_token = NULL, lease_until = NULL, resolved_at = datetime('now'), updated_at = datetime('now')
         WHERE session_id = ?`
      ).bind(payment.paymentId, sessionId),
      db.prepare(
        `UPDATE payment_sessions SET square_payment_id = ?, payment_status = CASE
         WHEN payment_status IN ('completed', 'partially_refunded', 'refunded') THEN payment_status
         ELSE 'processing' END WHERE id = ?`
      ).bind(payment.paymentId, sessionId),
    ]);
  } catch {
    // The exact original request remains durable if this transaction rolled back.
    return pendingPaymentReply('ORDER_FINALIZING');
  }
  session = await readSession(db, sessionId);
  if (!session) return pendingPaymentReply('ORDER_FINALIZING');
  return getPaymentAttemptStatus(db, sessionId, dependencies);
}

/** New durable attempts only; no automatic charging or rewriting of legacy sessions. */
export async function recoverPendingPaymentAttempts(
  db: D1Database,
  dependencies: PaymentAttemptDependencies = {}
): Promise<number> {
  const rows = await db.prepare(
    `SELECT a.session_id FROM payment_attempts a JOIN payment_sessions s ON s.id = a.session_id
     WHERE ((a.state IN ('unknown', 'processing') AND (a.lease_until IS NULL OR a.lease_until <= datetime('now'))
       AND datetime(a.created_at, '+30 minutes') > datetime('now') AND a.attempt_count < 12)
       OR (a.state = 'completed' AND s.order_id IS NULL))
     ORDER BY a.updated_at ASC LIMIT 10`
  ).all<{ session_id: string }>();
  let resolved = 0;
  for (const row of rows.results) {
    try {
      const result = await runPaymentAttempt(db, { sessionId: row.session_id, retry: true }, dependencies);
      if (result.status === 'completed' || result.status === 'declined') resolved++;
    } catch {
      console.error(JSON.stringify({ event: 'payment_recovery_deferred', sessionId: row.session_id }));
    }
  }
  return resolved;
}

/** Square-signed terminal events resolve the same saved attempt without replaying it. */
export async function recordPaymentWebhookOutcome(
  db: D1Database,
  sessionId: string,
  paymentId: string,
  outcome: 'completed' | 'declined'
): Promise<void> {
  await db.batch([
    db.prepare(
      `UPDATE payment_attempts SET state = ?, square_payment_id = ?, request_json = NULL,
       lease_token = NULL, lease_until = NULL, resolved_at = datetime('now'), updated_at = datetime('now')
       WHERE session_id = ? AND (state <> 'completed' OR ? = 'completed')`
    ).bind(outcome, paymentId, sessionId, outcome),
    db.prepare(
      `UPDATE payment_sessions SET square_payment_id = ?, payment_status = CASE
       WHEN payment_status IN ('completed', 'partially_refunded', 'refunded') THEN payment_status
       ELSE ? END WHERE id = ? AND (? = 'completed' OR (order_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM payment_attempts WHERE session_id = ? AND state = 'completed')))`
    ).bind(paymentId, outcome === 'completed' ? 'processing' : 'failed', sessionId, outcome, sessionId),
  ]);
}
