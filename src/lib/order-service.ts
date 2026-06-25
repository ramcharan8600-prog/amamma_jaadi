/**
 * Order creation service.
 *
 * The SINGLE place an order is created from a paid payment session. Called by
 * both the synchronous payment path (/api/payments/create-payment) and the
 * asynchronous Square webhook (/api/payments/webhook), so the two can never
 * drift. Idempotent: a session that already produced an order returns that
 * order instead of creating a duplicate.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { generateOrderNumber, newId, parseJson } from '@/lib/db';
import { isEmailConfigured, sendOrderConfirmation } from '@/lib/email-service';
import { getPickupLocationById } from '@/data/products';

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
}

interface FulfillmentData {
  type?: 'pickup' | 'delivery';
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
  product?: { name?: string };
  quantity: number;
  selectedTier?: number | null;
  lineTotal: number;
}

export interface CreateOrderResult {
  orderNumber: string;
  orderId: string;
  duplicate: boolean;
}

/** Map a raw D1 payment_sessions row (JSON columns are text) into a typed session. */
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
  };
}

function buildDeliveryAddress(f: FulfillmentData): string | null {
  if (f.type !== 'delivery') return null;
  return (
    [
      f.addressLine1,
      f.addressLine2,
      f.city && `${f.city}, ${f.state} ${f.zip}`,
      f.country,
    ]
      .filter(Boolean)
      .join('\n') || null
  );
}

/**
 * Look up an order already created for this payment, link the session to it,
 * and return it as a duplicate. Used by every idempotency short-circuit so a
 * repeated webhook never creates a second order or sends a second email.
 */
async function returnExistingOrder(
  db: D1Database,
  sessionId: string,
  squarePaymentId: string,
  reason: string
): Promise<CreateOrderResult | null> {
  const existing = await db
    .prepare('SELECT id, order_number FROM orders WHERE square_payment_id = ?')
    .bind(squarePaymentId)
    .first<{ id: string; order_number: string }>();
  if (!existing) return null;

  console.log(
    `[order-service] DUPLICATE webhook ignored (${reason}) — payment ${squarePaymentId} → order ${existing.order_number}`
  );
  // Best-effort: ensure the session points at the existing order.
  await db
    .prepare("UPDATE payment_sessions SET payment_status = 'completed', order_id = ? WHERE id = ?")
    .bind(existing.id, sessionId)
    .run();

  return { orderNumber: existing.order_number, orderId: existing.id, duplicate: true };
}

/**
 * Create an order (+ items) from a verified-paid session.
 *
 * Idempotency is enforced at THREE layers, keyed on the Square payment id:
 *   1. session.order_id already set            → return existing
 *   2. an order already has this payment id     → return existing
 *   3. UNIQUE(orders.square_payment_id) violated on insert (concurrent race)
 *                                               → return the winner
 * The confirmation email is sent ONLY on a genuine first creation.
 * Never throws for email failures — those are logged.
 */
export async function createOrderFromSession(
  db: D1Database,
  session: PaymentSessionRow,
  squarePaymentId: string
): Promise<CreateOrderResult> {
  // ── Layer 1: session already linked to an order ─────────────────────
  if (session.order_id) {
    const dup = await returnExistingOrder(db, session.id, squarePaymentId, 'session already linked');
    if (dup) return dup;
  }

  // ── Layer 2: an order already exists for this payment id ────────────
  const preExisting = await returnExistingOrder(db, session.id, squarePaymentId, 'payment id already processed');
  if (preExisting) return preExisting;

  const fulfillment: FulfillmentData = session.fulfillment_data ?? {};
  const orderNumber = await generateOrderNumber(db);
  const orderId = newId();

  try {
    await db
      .prepare(
        `INSERT INTO orders
          (id, order_number, customer_name, phone_number, email, order_type,
           pickup_date, pickup_location, delivery_address,
           total_price, tax, square_payment_id, status, payment_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'paid')`
      )
      .bind(
        orderId,
        orderNumber,
        session.customer_name,
        session.phone_number,
        session.email,
        fulfillment.type || 'pickup',
        fulfillment.date || null,
        fulfillment.locationId || null,
        buildDeliveryAddress(fulfillment),
        session.total_amount,
        session.tax || 0,
        squarePaymentId
      )
      .run();
  } catch (e) {
    // ── Layer 3: concurrent delivery won the race on the UNIQUE index ──
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) {
      const raced = await returnExistingOrder(db, session.id, squarePaymentId, 'lost insert race (unique constraint)');
      if (raced) return raced;
    }
    console.error('[order-service] order insert failed:', e);
    throw new Error('Order creation failed');
  }

  // ── Order items (batched) ───────────────────────────────────────────
  const cartItems = Array.isArray(session.cart_data) ? session.cart_data : [];
  if (cartItems.length > 0) {
    const stmt = db.prepare(
      `INSERT INTO order_items (id, order_id, product_name, quantity, product_price, selected_tier, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const batch = cartItems.map((item) => {
      const qty = Math.max(1, Math.floor(Number(item.quantity)));
      const lineTotal = Math.round(Number(item.lineTotal) * 100) / 100;
      return stmt.bind(
        newId(),
        orderId,
        item.product?.name || 'Unknown',
        qty,
        Math.round((lineTotal / qty) * 100) / 100,
        item.selectedTier ?? null,
        lineTotal
      );
    });
    try {
      await db.batch(batch);
    } catch (e) {
      console.error('[order-service] order_items insert failed:', e);
    }
  }

  // ── Link session → order ────────────────────────────────────────────
  await db
    .prepare("UPDATE payment_sessions SET payment_status = 'completed', order_id = ?, square_payment_id = ? WHERE id = ?")
    .bind(orderId, squarePaymentId, session.id)
    .run();

  // ── Confirmation email (best-effort) ────────────────────────────────
  if (isEmailConfigured() && session.email) {
    try {
      const pickupLoc =
        fulfillment.type === 'pickup' && fulfillment.locationId
          ? getPickupLocationById(fulfillment.locationId)
          : null;

      await sendOrderConfirmation({
        email: session.email,
        orderNumber,
        squarePaymentId,
        customerName: session.customer_name,
        phone: session.phone_number,
        total: session.total_amount,
        items: cartItems.map((i) => ({
          name: i.product?.name || 'Item',
          quantity: i.quantity,
          price: i.lineTotal,
        })),
        fulfillmentType: fulfillment.type || 'pickup',
        pickupLocation: pickupLoc
          ? `${pickupLoc.name} — ${pickupLoc.address}, ${pickupLoc.city}, ${pickupLoc.state} ${pickupLoc.zip}`
          : undefined,
        deliveryAddress:
          fulfillment.type === 'delivery'
            ? buildDeliveryAddress(fulfillment) ?? undefined
            : undefined,
      });
    } catch (e) {
      console.error('[order-service] confirmation email failed:', e);
    }
  }

  console.log('[order-service] order created:', orderNumber, squarePaymentId);
  return { orderNumber, orderId, duplicate: false };
}
