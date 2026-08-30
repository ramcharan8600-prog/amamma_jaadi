/**
 * Order pricing — the SINGLE source of truth for money math.
 *
 * Both the checkout UI (what the customer is shown) and the server
 * (`create-session`, which computes the authoritative amount actually charged)
 * import from here, so the displayed total and the charged total can never
 * drift apart.
 */

import { FREE_SHIPPING_THRESHOLD, DELIVERY_FEE, PICKLE_DELIVERY_FEES } from '@/lib/constants';

/**
 * Texas sales tax rate.
 *
 * NOT charged on the whole order — only on the TAXABLE portion. Texas exempts
 * bakery items, so sweets are exempt while pickles are taxable; which
 * categories are exempt is defined by TAX_EXEMPT_CATEGORIES in data/products.ts.
 */
export const SALES_TAX_RATE = 0.0825;

/** Human label for the tax line, e.g. "Sales Tax (8.25%)". */
export const SALES_TAX_LABEL = `Sales Tax (${(SALES_TAX_RATE * 100).toFixed(2).replace(/\.?0+$/, '')}%)`;

/** Round to whole cents — money must never carry float dust. */
export function roundMoney(amount: number): number {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
}

/**
 * Delivery fee for a given number of pickle jars — the TOTAL for the order.
 * 0 jars is 0; counts beyond the table use the last (cheapest) tier.
 */
export function pickleDeliveryFee(jars: number): number {
  const n = Math.max(0, Math.floor(Number(jars) || 0));
  if (n === 0) return 0;
  return PICKLE_DELIVERY_FEES[Math.min(n, PICKLE_DELIVERY_FEES.length - 1)];
}

export interface OrderTotals {
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
}

/**
 * Break a subtotal into subtotal + tax + shipping + total.
 *
 * Tax is charged on `taxableSubtotal` only — the portion of the order that
 * isn't tax-exempt (Texas exempts bakery items, so sweets contribute nothing).
 * Omit it and the whole subtotal is treated as taxable. Tax is never charged
 * on shipping. Shipping is a flat DELIVERY_FEE, applied ONLY to delivery orders
 * below the free-shipping threshold — pickup, and delivery at/above the
 * threshold, ship free. `subtotal + tax + shipping === total` exactly.
 */
export function calculateOrderTotals(
  subtotal: number,
  opts: {
    fulfillmentType?: 'pickup' | 'delivery';
    taxableSubtotal?: number;
    /** Number of pickle jars in the cart — they carry their own fee scale. */
    pickleJars?: number;
  } = {}
): OrderTotals {
  const safeSubtotal = roundMoney(Math.max(0, Number(subtotal) || 0));
  const taxable = roundMoney(
    Math.min(safeSubtotal, Math.max(0, Number(opts.taxableSubtotal ?? safeSubtotal) || 0))
  );
  const tax = roundMoney(taxable * SALES_TAX_RATE);
  // Below the threshold, every delivery pays at least the base fee. Pickle-only
  // orders use the jar fee scale (heavy/fragile); mixed carts (pickles + other
  // items) pay the flat base fee — the extra weight is offset by the larger order.
  const jars = opts.pickleJars ?? 0;
  const isMixedCart = jars > 0 && safeSubtotal > taxable;
  const shipping =
    opts.fulfillmentType === 'delivery' && safeSubtotal < FREE_SHIPPING_THRESHOLD
      ? (isMixedCart ? DELIVERY_FEE : roundMoney(Math.max(pickleDeliveryFee(jars), DELIVERY_FEE)))
      : 0;
  return { subtotal: safeSubtotal, tax, shipping, total: roundMoney(safeSubtotal + tax + shipping) };
}
