import { NextRequest } from 'next/server';
import { getDb, isDbConfigured, newId } from '@/lib/db';
import { isSquareEnabled, getSquarePublicConfig } from '@/lib/square';
import { PRODUCTS, getTotalPieces, isBobbatluProduct } from '@/data/products';
import { validateCart } from '@/lib/cart-validation';
import { getPickupDateError, requiresNextDayPickup } from '@/lib/pickup-date';
import {
  calculateOrderTotals,
  getDeliveryMinimumSubtotal,
  getDeliveryMinimumShortfall,
  isSupportedDeliveryState,
  normalizeStateCode,
} from '@/lib/pricing';
import { getStockMap } from '@/lib/inventory';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { sanitize } from '@/lib/sanitize';
import { validateRequiredContact } from '@/lib/contact-validation';
import { buildTaxSnapshot } from '@/lib/tax-records';
import { ok, fail } from '@/lib/api';
import { couponBenefit, type CouponBenefit, type CouponRow } from '@/lib/coupons';

/**
 * POST /api/payments/create-session
 *
 * Creates a TEMPORARY payment session. Does NOT create an order.
 * The order is only created after Square webhook confirms payment.
 *
 * Flow:
 * 1. Frontend calls this with cart data
 * 2. We create a payment_session in DB (status: pending)
 * 3. Frontend uses session ID + Square Web Payments SDK to tokenize card
 * 4. Frontend sends token to Square for payment
 * 5. Square webhook confirms payment → order created
 */

export async function POST(request: NextRequest) {
  try {
    // Throttle abuse: 10 session creations per minute per IP.
    if (!rateLimit(`create-session:${getClientIp(request)}`, 10, 60_000)) {
      return fail('Too many requests. Please slow down.', 429);
    }

    if (!isDbConfigured()) {
      return fail('Payment system not configured. Contact us via WhatsApp.', 503);
    }

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return fail('Invalid checkout request.', 400);
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return fail('Invalid checkout request.', 400);
    }
    const body = input as Record<string, unknown>;
    const cart = validateCart(body.items);
    if (!cart.ok) return fail(cart.error, cart.status);
    const picklesOnly = cart.items.every(({ product }) => product.category === 'pickles');
    const customerName = sanitize(body.customerName, 100);
    const email = sanitize(body.email, 200).toLowerCase();
    const phone = sanitize(body.phone, 20);
    const contactError = validateRequiredContact({ name: customerName, email, phone });
    if (contactError) return fail(contactError, 400);

    // Stock for tracked products (pickles). Products with no row are untracked
    // and always available. Quantities are summed across cart lines so the same
    // pickle added twice can't slip past the check.
    const stock = await getStockMap(getDb());
    const { requestedByProduct, subtotal: serverTotal, taxableSubtotal: taxableTotal } = cart;
    for (const { product } of cart.items) {
      // Both Bobbatlu products stay purchasable when ready stock runs out.
      if (isBobbatluProduct(product.id)) continue;
      // Stock check for tracked products (untracked products aren't in the map).
      if (Object.prototype.hasOwnProperty.call(stock, product.id)) {
        const available = stock[product.id];
        const wanted = requestedByProduct.get(product.id) ?? 0;
        if (available <= 0) {
          return fail(`${product.name} is sold out.`, 409);
        }
        if (wanted > available) {
          return fail(
            `Only ${available} ${product.name} left — please reduce the quantity.`,
            409
          );
        }
      }
    }

    // Normalize delivery inputs before pricing or persistence. The browser is
    // never trusted to choose its own zone/rate.
    const rawFulfillment = body.fulfillment && typeof body.fulfillment === 'object' && !Array.isArray(body.fulfillment)
      ? body.fulfillment as Record<string, unknown>
      : null;
    const fulfillmentType = rawFulfillment?.type === 'delivery' ? 'delivery' : 'pickup';
    let fulfillment = rawFulfillment;
    let deliveryState: string | undefined;
    let shippingMethod: 'standard' | 'ground' | 'expedited' | undefined;

    if (fulfillmentType === 'pickup') {
      const dateError = getPickupDateError(rawFulfillment?.date, getTotalPieces(cart.items), new Date(),
        requiresNextDayPickup(cart.items));
      if (dateError) return fail(dateError, 400);
    }

    if (fulfillmentType === 'delivery') {
      const normalizedDeliveryState = normalizeStateCode(rawFulfillment?.state);
      deliveryState = normalizedDeliveryState;
      if (normalizedDeliveryState === 'AK' || normalizedDeliveryState === 'HI') {
        return fail(
          'Delivery to Alaska or Hawaii requires a manual shipping quote. Please contact us.',
          400
        );
      }
      if (!isSupportedDeliveryState(normalizedDeliveryState)) {
        return fail('Please select a valid delivery state.', 400);
      }

      // Pickle-only orders have no minimum. For sweets/mixed carts, check the
      // destination minimum before the gift-box minimum to give one requirement.
      const minimumSubtotal = getDeliveryMinimumSubtotal(normalizedDeliveryState, picklesOnly);
      const minimumShortfall = getDeliveryMinimumShortfall(serverTotal, normalizedDeliveryState, picklesOnly);
      if (minimumShortfall > 0) {
        return fail(
          `A minimum product subtotal of $${minimumSubtotal.toFixed(2)} is required for delivery to this state. Add $${minimumShortfall.toFixed(2)} more to continue.`,
          400
        );
      }

      const stateRestrictedProduct = PRODUCTS.find(
        (product) =>
          requestedByProduct.has(product.id) &&
          product.deliveryStateCodes?.length &&
          !product.deliveryStateCodes.includes(normalizedDeliveryState) &&
          serverTotal < (product.deliveryOutsideStateMinimum ?? Number.POSITIVE_INFINITY)
      );
      if (stateRestrictedProduct) {
        const requiredSubtotal = stateRestrictedProduct.deliveryOutsideStateMinimum ?? 0;
        const shortfall = Math.max(0, requiredSubtotal - serverTotal);
        return fail(
          `${stateRestrictedProduct.name} can be delivered outside Texas when the product subtotal is $${requiredSubtotal.toFixed(2)} or more. Add $${shortfall.toFixed(2)} more, remove it, or select a Texas address.`,
          400
        );
      }

      const addressLine1 = sanitize(rawFulfillment?.addressLine1, 200);
      const addressLine2 = sanitize(rawFulfillment?.addressLine2, 200);
      const city = sanitize(rawFulfillment?.city, 100);
      const zip = sanitize(rawFulfillment?.zip, 10);
      if (!addressLine1 || !city) {
        return fail('Please enter a complete delivery address.', 400);
      }
      if (!/^\d{5}(?:-\d{4})?$/.test(zip)) {
        return fail('Please enter a valid 5-digit ZIP code.', 400);
      }

      shippingMethod = 'standard';
      fulfillment = {
        type: 'delivery',
        shippingMethod,
        customerName,
        phone,
        email,
        addressLine1,
        addressLine2,
        city,
        state: normalizedDeliveryState,
        zip,
        country: 'USA',
      };
    }

    // Only the stored coupon and catalog subtotal determine eligibility.
    const rawCoupon = typeof body.couponCode === 'string'
      ? body.couponCode.trim().replace(/\s+/g, '').toUpperCase() : '';
    let benefit: CouponBenefit | null = null;
    if (rawCoupon) {
      const coupon = await getDb()
        .prepare('SELECT code, coupon_type, bonus_item, bonus_qty, active, min_subtotal FROM influencer_coupons WHERE code = ?')
        .bind(rawCoupon).first<CouponRow>();
      benefit = coupon?.active ? couponBenefit(coupon) : null;
      if (!benefit) return fail('That promo code is no longer valid. Please remove it or apply another code.', 400);
      if (benefit.type === 'free_delivery') {
        if (fulfillmentType !== 'delivery') return fail('This promo code is only valid for delivery orders.', 400);
        if (serverTotal < benefit.minSubtotal) {
          return fail(`This code requires a minimum cart value of $${benefit.minSubtotal.toFixed(2)} before tax and delivery.`, 400);
        }
      }
    }

    // Price merchandise and shipping, then tax the applicable base. Same helper
    // the checkout UI uses, so the amount shown always matches the amount charged.
    const { subtotal, tax, shipping, total } = calculateOrderTotals(serverTotal, {
      fulfillmentType,
      taxableSubtotal: taxableTotal,
      picklesOnly,
      pickleJarCount: cart.items.reduce((sum, item) => sum + (item.product.category === 'pickles' ? item.quantity : 0), 0),
      deliveryState,
      shippingMethod,
      freeDelivery: benefit?.type === 'free_delivery',
    });

    if (
      !Number.isFinite(subtotal) || subtotal <= 0 ||
      !Number.isFinite(tax) || tax < 0 ||
      !Number.isFinite(shipping) || shipping < 0 ||
      !Number.isFinite(total) || total <= 0 ||
      !Number.isSafeInteger(Math.round(total * 100))
    ) {
      return fail('Invalid order total', 400);
    }

    const sessionId = newId();
    const idempotencyKey = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const squarePublic = getSquarePublicConfig();
    const taxSnapshot = buildTaxSnapshot(cart.items, { subtotal, tax, shipping, total },
      fulfillment ?? { type: fulfillmentType }, squarePublic.environment);
    const db = getDb();
    // The payable session and its immutable tax quote must commit together.
    await db.batch([db.prepare(
        `INSERT INTO payment_sessions
          (id, customer_name, email, phone_number, cart_data, fulfillment_data,
           total_amount, tax, shipping, coupon_code, payment_status, idempotency_key, coupon_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .bind(
        sessionId,
        customerName,
        email,
        phone,
        JSON.stringify(cart.items),
        fulfillment ? JSON.stringify(fulfillment) : null,
        total,
        tax,
        shipping,
        benefit?.code ?? null,
        idempotencyKey,
        benefit ? JSON.stringify(benefit) : null
      ),
      db.prepare('INSERT INTO payment_tax_quotes (session_id, snapshot_json) VALUES (?, ?)')
        .bind(sessionId, JSON.stringify(taxSnapshot)),
    ]);

    // Read the Square public config from the Worker env at runtime, so the app
    // id / location id / environment flow from the Cloudflare dashboard vars
    // (not from build-time-inlined NEXT_PUBLIC_* values).
    return ok({
      sessionId,
      subtotal,
      tax,
      shipping,
      shippingMethod: shippingMethod || null,
      totalAmount: total,
      coupon: benefit,
      idempotencyKey,
      squareEnabled: isSquareEnabled(),
      squareAppId: squarePublic.appId || null,
      squareLocationId: squarePublic.locationId || null,
      squareEnvironment: squarePublic.environment,
    }, 201);
  } catch (e) {
    console.error('Payment session error:', e);
    return fail('Failed to create payment session', 500);
  }
}
