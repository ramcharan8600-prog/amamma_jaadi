/** Finalize a verified Square payment atomically: receipt, items and email intent. */
import type { D1Database, D1PreparedStatement, Queue } from '@cloudflare/workers-types';
import { generateOrderNumber, newId, parseJson } from '@/lib/db';
import { buildOrderConfirmationEmail, buildOwnerOrderAlertEmail } from '@/lib/email-service';
import { prepareEmailOutboxInsert, publishPersistedEmail, type EmailQueueMessage } from '@/lib/email-outbox';
import { getPickupLocationById, getProductById, TRACKED_CATEGORY } from '@/data/products';
import type { DeliveryShippingMethod } from '@/types';

export interface PaymentSessionRow {
  id: string;
  order_id: string | null;
  customer_name: string;
  phone_number: string;
  email: string | null;
  cart_data: CartLine[];
  fulfillment_data: FulfillmentData | null;
  total_amount: number;
  tax: number | null;
  shipping: number | null;
  coupon_code: string | null;
}

interface FulfillmentData {
  type?: 'pickup' | 'delivery';
  shippingMethod?: DeliveryShippingMethod;
  date?: string;
  locationId?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

interface CartLine {
  productId?: string;
  product?: { name?: string };
  quantity: number;
  selectedTier?: number | null;
  selectedVariant?: string | null;
  lineTotal: number;
}

interface CanonicalLine {
  productId: string;
  name: string;
  quantity: number;
  selectedTier: number | null;
  lineTotal: number;
  tracked: boolean;
}

interface FinalizedOrder {
  id: string;
  order_number: string;
  finalization_attempt_id: string | null;
  payment_session_id: string | null;
  legacy_repair: number | null;
}

export interface CreateOrderResult {
  orderNumber: string;
  orderId: string;
  duplicate: boolean;
}

export function mapSessionRow(raw: Record<string, unknown>): PaymentSessionRow {
  return {
    id: String(raw.id),
    order_id: (raw.order_id as string) ?? null,
    customer_name: String(raw.customer_name ?? ''),
    phone_number: String(raw.phone_number ?? ''),
    email: (raw.email as string) ?? null,
    cart_data: parseJson<CartLine[]>(raw.cart_data) ?? [],
    fulfillment_data: parseJson<FulfillmentData>(raw.fulfillment_data),
    total_amount: Number(raw.total_amount ?? 0),
    tax: raw.tax == null ? 0 : Number(raw.tax),
    shipping: raw.shipping == null ? 0 : Number(raw.shipping),
    coupon_code: (raw.coupon_code as string) ?? null,
  };
}

function cents(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) {
    throw new Error(`Paid session has invalid ${field}; manual review required`);
  }
  return Math.round(value * 100);
}

/**
 * New sessions contain a server-built cart. Older paid sessions can contain
 * browser snapshots: ignore their names, validate IDs/options/quantities, and
 * reconcile cents to the paid receipt. Never reprice an already-paid receipt
 * using today's catalog price, or guess missing/invalid order contents.
 */
function canonicalPaidLines(session: PaymentSessionRow): CanonicalLine[] {
  if (!Array.isArray(session.cart_data) || session.cart_data.length === 0 || session.cart_data.length > 50) {
    throw new Error('Paid session has invalid cart; manual review required');
  }
  const quantities = new Map<string, number>();
  const lines = session.cart_data.map((item): CanonicalLine => {
    const product = item && typeof item.productId === 'string' ? getProductById(item.productId) : undefined;
    if (!product || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) {
      throw new Error('Paid session has invalid product or quantity; manual review required');
    }
    const quantity = (quantities.get(product.id) ?? 0) + item.quantity;
    if (quantity > 1000) throw new Error('Paid session exceeds product quantity limit; manual review required');
    quantities.set(product.id, quantity);
    const tier = product.quantityOptions?.length ? item.selectedTier ?? product.quantityOptions[0] : null;
    if ((tier !== null && (!Number.isSafeInteger(tier) || !product.quantityOptions?.includes(tier))) ||
        (tier === null && item.selectedTier != null)) {
      throw new Error('Paid session has invalid product tier; manual review required');
    }
    const variant = product.variantOptions?.length
      ? item.selectedVariant ?? product.variantOptions[0] : null;
    if ((variant !== null && !product.variantOptions?.includes(variant)) ||
        (variant === null && item.selectedVariant != null)) {
      throw new Error('Paid session has invalid product variant; manual review required');
    }
    const amount = cents(item.lineTotal, 'cart amount');
    if (amount <= 0) throw new Error('Paid session has empty item amount; manual review required');
    return { productId: product.id, name: variant ? `${product.name} (${variant})` : product.name,
      quantity: item.quantity, selectedTier: tier, lineTotal: amount / 100,
      tracked: product.category === TRACKED_CATEGORY };
  });
  const merchandise = lines.reduce((total, line) => total + cents(line.lineTotal, 'cart amount'), 0);
  const total = cents(session.total_amount, 'payment total');
  if (total <= 0 || merchandise + cents(session.tax ?? 0, 'tax') + cents(session.shipping ?? 0, 'shipping') !== total) {
    throw new Error('Paid session cart does not match charged total; manual review required');
  }
  return lines;
}

function buildDeliveryAddress(f: FulfillmentData): string | null {
  if (f.type !== 'delivery') return null;
  return [f.addressLine1, f.addressLine2, f.city && `${f.city}, ${f.state} ${f.zip}`, f.country]
    .filter(Boolean).join('\n') || null;
}

async function findOrder(db: D1Database, squarePaymentId: string): Promise<FinalizedOrder | null> {
  return db.prepare(
    `SELECT o.id, o.order_number, f.attempt_id AS finalization_attempt_id,
            f.payment_session_id, f.legacy_repair
     FROM orders o LEFT JOIN order_finalizations f ON f.order_id = o.id
     WHERE o.square_payment_id = ?`
  ).bind(squarePaymentId).first<FinalizedOrder>();
}

/**
 * A unique finalization ledger claim and all dependent writes commit in ONE D1
 * transaction. Its attempt token guards each write, so racing webhook/recovery
 * calls cannot repeat stock/coupon effects or publish a losing receipt number.
 * Legacy headers without a ledger can be repaired; their historical stock and
 * coupon effects are ambiguous and are deliberately preserved for review.
 */
export async function createOrderFromSession(
  db: D1Database,
  session: PaymentSessionRow,
  squarePaymentId: string,
  options: { emailQueue?: Queue<EmailQueueMessage> } = {}
): Promise<CreateOrderResult> {
  const existing = await findOrder(db, squarePaymentId);
  if (existing?.finalization_attempt_id) {
    if (existing.payment_session_id !== session.id) throw new Error('Payment is already linked to a different session');
    return { orderNumber: existing.order_number, orderId: existing.id, duplicate: true };
  }
  const lines = canonicalPaidLines(session);
  const fulfillment = session.fulfillment_data;
  if (!fulfillment || !['pickup', 'delivery'].includes(fulfillment.type ?? '')) {
    throw new Error('Paid session has invalid fulfillment; manual review required');
  }
  const storedSession = await db.prepare('SELECT id, square_payment_id, order_id FROM payment_sessions WHERE id = ?')
    .bind(session.id).first<{ id: string; square_payment_id: string | null; order_id: string | null }>();
  if (!storedSession || (storedSession.square_payment_id && storedSession.square_payment_id !== squarePaymentId) ||
      (storedSession.order_id && storedSession.order_id !== existing?.id)) {
    throw new Error('Paid session linkage is inconsistent; manual review required');
  }
  const coupon = session.coupon_code
    ? await db.prepare('SELECT bonus_item, bonus_qty FROM influencer_coupons WHERE code = ?')
      .bind(session.coupon_code).first<{ bonus_item: string; bonus_qty: number }>() : null;
  if (session.coupon_code && (!coupon || !coupon.bonus_item || !Number.isSafeInteger(coupon.bonus_qty) || coupon.bonus_qty < 1)) {
    throw new Error('Paid session coupon cannot be resolved; manual review required');
  }
  const orderId = existing?.id ?? newId();
  const orderNumber = existing?.order_number ?? await generateOrderNumber(db);
  const attemptId = newId();
  const pickup = fulfillment.type === 'pickup' && fulfillment.locationId
    ? getPickupLocationById(fulfillment.locationId) : null;
  const emailItems = lines.map((line) => ({ name: line.name, quantity: line.quantity, price: line.lineTotal }));
  if (coupon) emailItems.push({ name: `${coupon.bonus_qty} complimentary ${coupon.bonus_item} (FREE)`, quantity: 1, price: 0 });
  const emailParams = {
    orderNumber, squarePaymentId, total: session.total_amount,
    subtotal: lines.reduce((sum, line) => sum + Math.round(line.lineTotal * 100), 0) / 100,
    tax: session.tax ?? 0, shipping: session.shipping ?? 0,
    customerName: session.customer_name, phone: session.phone_number, items: emailItems,
    fulfillmentType: fulfillment.type as 'pickup' | 'delivery',
    pickupDate: fulfillment.date,
    pickupLocation: pickup ? `${pickup.name} — ${pickup.address}, ${pickup.city}, ${pickup.state} ${pickup.zip}` : undefined,
    deliveryAddress: buildDeliveryAddress(fulfillment) ?? undefined,
    shippingMethod: fulfillment.type === 'delivery' ? fulfillment.shippingMethod ?? 'standard' : undefined,
  };
  const email = session.email
    ? buildOrderConfirmationEmail({ ...emailParams, email: session.email })
    : buildOwnerOrderAlertEmail({ ...emailParams, customerEmail: null });
  if (!email) throw new Error('Paid session has no confirmation recipient; manual review required');

  const guard = 'EXISTS (SELECT 1 FROM order_finalizations WHERE attempt_id = ?)';
  const resolvedId = '(SELECT order_id FROM order_finalizations WHERE attempt_id = ?)';
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO orders
        (id, order_number, customer_name, phone_number, email, order_type,
         pickup_date, pickup_location, delivery_address, shipping_method,
         total_price, tax, square_payment_id, coupon_code, status, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'paid')
       ON CONFLICT(square_payment_id) DO NOTHING`
    ).bind(orderId, orderNumber, session.customer_name, session.phone_number, session.email,
      fulfillment.type, fulfillment.date ?? null, fulfillment.locationId ?? null,
      buildDeliveryAddress(fulfillment), fulfillment.type === 'delivery' ? fulfillment.shippingMethod ?? 'standard' : null,
      session.total_amount, session.tax ?? 0, squarePaymentId, session.coupon_code),
    db.prepare(
      `INSERT INTO order_finalizations (order_id, payment_session_id, attempt_id, legacy_repair)
       SELECT id, ?, ?, CASE WHEN id = ? AND ? = 0 THEN 0 ELSE 1 END
       FROM orders WHERE square_payment_id = ? AND id = ?
       ON CONFLICT(order_id) DO NOTHING`
    ).bind(session.id, attemptId, orderId, existing ? 1 : 0, squarePaymentId, orderId),
    db.prepare(`DELETE FROM order_items WHERE order_id = ${resolvedId}`).bind(attemptId),
  ];
  for (const line of lines) {
    statements.push(db.prepare(
      `INSERT INTO order_items (id, order_id, product_name, quantity, product_price, selected_tier, line_total)
       SELECT ?, ${resolvedId}, ?, ?, ?, ?, ? WHERE ${guard}`
    ).bind(newId(), attemptId, line.name, line.quantity,
      Math.round((line.lineTotal / line.quantity) * 100) / 100, line.selectedTier, line.lineTotal, attemptId));
  }
  if (coupon) {
    statements.push(db.prepare(
      `INSERT INTO order_items (id, order_id, product_name, quantity, product_price, selected_tier, line_total)
       SELECT ?, ${resolvedId}, ?, ?, 0, NULL, 0 WHERE ${guard}`
    ).bind(newId(), attemptId, `${coupon.bonus_item} (Complimentary)`, coupon.bonus_qty, attemptId));
    statements.push(db.prepare(
      `UPDATE influencer_coupons SET times_used = times_used + 1 WHERE code = ?
       AND EXISTS (SELECT 1 FROM order_finalizations WHERE attempt_id = ? AND legacy_repair = 0)`
    ).bind(session.coupon_code, attemptId));
  }
  const trackedQuantities = new Map<string, number>();
  for (const line of lines) {
    if (line.tracked) trackedQuantities.set(line.productId, (trackedQuantities.get(line.productId) ?? 0) + line.quantity);
  }
  for (const [productId, quantity] of trackedQuantities) {
    statements.push(db.prepare(
      `UPDATE inventory SET stock_count = MAX(0, stock_count - ?), updated_at = datetime('now')
       WHERE product_id = ? AND EXISTS (
         SELECT 1 FROM order_finalizations WHERE attempt_id = ? AND legacy_repair = 0
       )`
    ).bind(quantity, productId, attemptId));
  }
  statements.push(db.prepare(
    `UPDATE payment_sessions SET
       payment_status = CASE WHEN payment_status IN ('partially_refunded', 'refunded')
         THEN payment_status ELSE 'completed' END,
       order_id = ${resolvedId}, square_payment_id = ?
     WHERE id = ? AND ${guard}`
  ).bind(attemptId, squarePaymentId, session.id, attemptId));
  statements.push(prepareEmailOutboxInsert(db, email, { finalizationAttemptId: attemptId }).statement);
  statements.push(db.prepare(
    `SELECT o.id, o.order_number, f.attempt_id AS finalization_attempt_id,
            f.payment_session_id, f.legacy_repair
     FROM orders o JOIN order_finalizations f ON f.order_id = o.id
     WHERE o.square_payment_id = ?`
  ).bind(squarePaymentId));

  // Every write, including the claim, rolls back if any statement fails.
  const results = await db.batch<FinalizedOrder>(statements);
  const finalized = results[results.length - 1]?.results?.[0];
  if (!finalized || finalized.payment_session_id !== session.id) {
    // A legacy writer can insert a header after our initial read. Do not claim
    // it using email HTML prepared for a different receipt number: a replay
    // will read that actual header and safely finish its receipt instead.
    throw new Error('Order finalization did not resolve the paid session');
  }
  if (finalized.finalization_attempt_id === attemptId) {
    if (finalized.legacy_repair) {
      console.warn(JSON.stringify({ event: 'legacy_order_repaired', orderId: finalized.id,
        reviewStockAndCoupon: trackedQuantities.size > 0 || Boolean(coupon) }));
    }
    await publishPersistedEmail(db, email.dedupeKey, options.emailQueue);
  }
  return { orderNumber: finalized.order_number, orderId: finalized.id,
    duplicate: Boolean(existing) || finalized.finalization_attempt_id !== attemptId };
}
