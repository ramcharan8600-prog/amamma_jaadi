import { NextRequest } from 'next/server';
import { getDb, isDbConfigured, newId } from '@/lib/db';
import { isSquareEnabled, getSquarePublicConfig } from '@/lib/square';
import { PRODUCTS, calculateSweetPrice, isProductTaxExempt } from '@/data/products';
import { calculateOrderTotals } from '@/lib/pricing';
import { getStockMap } from '@/lib/inventory';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { sanitize } from '@/lib/sanitize';
import { ok, fail } from '@/lib/api';

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

    const body = await request.json();

    // Validate required fields
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return fail('Cart is empty', 400);
    }
    // Cap the number of line items to bound work and prevent abuse.
    if (body.items.length > 50) {
      return fail('Too many items in cart.', 400);
    }
    if (!body.phone || typeof body.phone !== 'string' || body.phone.length < 7) {
      return fail('Valid phone number required', 400);
    }

    // Stock for tracked products (pickles). Products with no row are untracked
    // and always available. Quantities are summed across cart lines so the same
    // pickle added twice can't slip past the check.
    const stock = await getStockMap(getDb());
    const requestedByProduct = new Map<string, number>();
    for (const item of body.items) {
      const id = String(item.productId);
      requestedByProduct.set(
        id,
        (requestedByProduct.get(id) ?? 0) + Math.max(1, Math.floor(Number(item.quantity) || 1))
      );
    }

    // Recompute total server-side from authoritative product prices.
    // Never trust the client-sent total — prevents price manipulation.
    let serverTotal = 0;
    let taxableTotal = 0;
    for (const item of body.items) {
      const product = PRODUCTS.find((p) => p.id === item.productId);
      if (!product) {
        return fail(`Unknown product: ${item.productId}`, 400);
      }
      // Sold-out items can never be purchased, even if a stale cart (persisted
      // in localStorage) still holds one from before it went out of stock.
      if (!product.inStock) {
        return fail(`${product.name} is currently out of stock.`, 409);
      }
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
      const qty = Math.max(1, Math.floor(Number(item.quantity)));

      let lineTotal: number;
      if (product.category === 'sweets') {
        // Sweets are priced by tier (pieces). The tier MUST be one of the
        // product's allowed quantityOptions — never trust an arbitrary or
        // missing tier, or the price could be manipulated downward.
        const tier = Number(item.selectedTier);
        const allowedTiers = product.quantityOptions || [];
        if (!allowedTiers.includes(tier)) {
          return fail(`Invalid quantity option for ${product.name}`, 400);
        }
        lineTotal = calculateSweetPrice(product.unitPrice, tier) * qty;
      } else {
        lineTotal = product.unitPrice * qty;
      }
      serverTotal += lineTotal;
      // Only non-exempt lines (pickles) are taxed — bakery items are exempt.
      if (!isProductTaxExempt(product)) taxableTotal += lineTotal;
    }

    // Fulfillment is stored as the customer entered it (no address validation).
    const fulfillment = body.fulfillment || null;
    const fulfillmentType = fulfillment?.type === 'delivery' ? 'delivery' : 'pickup';

    // Subtotal → + Texas sales tax → + delivery fee → charged total. Same helper
    // the checkout UI uses, so the amount shown always matches the amount charged.
    // Shipping applies only to delivery orders below the free-shipping threshold.
    const { subtotal, tax, shipping, total } = calculateOrderTotals(serverTotal, {
      fulfillmentType,
      taxableSubtotal: taxableTotal,
    });

    if (total <= 0) {
      return fail('Invalid order total', 400);
    }

    const sessionId = newId();
    const idempotencyKey = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // Create payment session (NOT an order). JSON columns are stored as text.
    await getDb()
      .prepare(
        `INSERT INTO payment_sessions
          (id, customer_name, email, phone_number, cart_data, fulfillment_data,
           total_amount, tax, shipping, payment_status, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .bind(
        sessionId,
        sanitize(body.customerName, 100) || 'Guest',
        sanitize(body.email, 200) || null,
        sanitize(body.phone, 20),
        JSON.stringify(body.items),
        fulfillment ? JSON.stringify(fulfillment) : null,
        total,
        tax,
        shipping,
        idempotencyKey
      )
      .run();

    // Read the Square public config from the Worker env at runtime, so the app
    // id / location id / environment flow from the Cloudflare dashboard vars
    // (not from build-time-inlined NEXT_PUBLIC_* values).
    const squarePublic = getSquarePublicConfig();
    return ok({
      sessionId,
      subtotal,
      tax,
      shipping,
      totalAmount: total,
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
