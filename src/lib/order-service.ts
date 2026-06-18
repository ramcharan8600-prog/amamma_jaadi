/**
 * Order creation service.
 *
 * The SINGLE place an order is created from a paid payment session. Called by
 * both the synchronous payment path (/api/payments/create-payment) and the
 * asynchronous Square webhook (/api/payments/webhook), so the two can never
 * drift. Idempotent: a session that already produced an order returns that
 * order instead of creating a duplicate.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateOrderNumber } from '@/lib/supabase';
import { isEmailConfigured, sendOrderConfirmation } from '@/lib/email-service';
import { getPickupLocationById } from '@/data/products';
import type { NormalizedAddress } from '@/types';

export interface PaymentSessionRow {
  id: string;
  order_id: string | null;
  customer_name: string;
  phone_number: string;
  email: string | null;
  cart_data: unknown;
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
  normalized?: NormalizedAddress;
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

function buildDeliveryAddress(f: FulfillmentData): string | null {
  if (f.type !== 'delivery') return null;
  if (f.normalized?.formatted) return f.normalized.formatted;
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

/** Postgres unique_violation — raised when two deliveries race on square_payment_id. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Look up an order already created for this payment, link the session to it,
 * and return it as a duplicate. Used by every idempotency short-circuit so a
 * repeated webhook never creates a second order or sends a second email.
 */
async function returnExistingOrder(
  db: SupabaseClient,
  sessionId: string,
  squarePaymentId: string,
  reason: string
): Promise<CreateOrderResult | null> {
  const { data: existing } = await db
    .from('orders')
    .select('id, order_number')
    .eq('square_payment_id', squarePaymentId)
    .maybeSingle();
  if (!existing) return null;

  console.log(
    `[order-service] DUPLICATE webhook ignored (${reason}) — payment ${squarePaymentId} → order ${existing.order_number}`
  );
  // Best-effort: ensure the session points at the existing order.
  await db
    .from('payment_sessions')
    .update({ payment_status: 'completed', order_id: existing.id })
    .eq('id', sessionId);

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
  db: SupabaseClient,
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
  const normalized = fulfillment.normalized ?? null;
  const orderNumber = await generateOrderNumber();

  const { data: order, error: orderError } = await db
    .from('orders')
    .insert({
      order_number: orderNumber,
      customer_name: session.customer_name,
      phone_number: session.phone_number,
      email: session.email,
      order_type: fulfillment.type || 'pickup',
      pickup_date: fulfillment.date || null,
      pickup_location: fulfillment.locationId || null,
      delivery_address: buildDeliveryAddress(fulfillment),
      delivery_address_normalized: normalized,
      total_price: session.total_amount,
      tax: session.tax || 0,
      square_payment_id: squarePaymentId,
      status: 'confirmed',
      payment_status: 'paid',
    })
    .select('id, order_number')
    .single();

  if (orderError || !order) {
    // ── Layer 3: concurrent delivery won the race on the UNIQUE index ──
    if (orderError?.code === PG_UNIQUE_VIOLATION) {
      const raced = await returnExistingOrder(db, session.id, squarePaymentId, 'lost insert race (unique constraint)');
      if (raced) return raced;
    }
    console.error('[order-service] order insert failed:', orderError);
    throw new Error('Order creation failed');
  }

  // ── Order items ─────────────────────────────────────────────────────
  const cartItems = Array.isArray(session.cart_data) ? (session.cart_data as CartLine[]) : [];
  if (cartItems.length > 0) {
    const orderItems = cartItems.map((item) => {
      const qty = Math.max(1, Math.floor(Number(item.quantity)));
      const lineTotal = Math.round(Number(item.lineTotal) * 100) / 100;
      return {
        order_id: order.id,
        product_name: item.product?.name || 'Unknown',
        quantity: qty,
        product_price: Math.round((lineTotal / qty) * 100) / 100,
        selected_tier: item.selectedTier || null,
        line_total: lineTotal,
      };
    });
    const { error: itemsError } = await db.from('order_items').insert(orderItems);
    if (itemsError) console.error('[order-service] order_items insert failed:', itemsError);
  }

  // ── Link session → order ────────────────────────────────────────────
  await db
    .from('payment_sessions')
    .update({ payment_status: 'completed', order_id: order.id, square_payment_id: squarePaymentId })
    .eq('id', session.id);

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
  return { orderNumber, orderId: order.id, duplicate: false };
}
