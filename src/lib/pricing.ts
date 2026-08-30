/**
 * Order pricing — the SINGLE source of truth for money math.
 *
 * Both the checkout UI (what the customer is shown) and the server
 * (`create-session`, which computes the authoritative amount actually charged)
 * import from here, so the displayed total and the charged total can never
 * drift apart.
 */

import {
  FREE_SHIPPING_THRESHOLD,
  SHIPPING_TX_BELOW,
  SHIPPING_TX_ABOVE,
  SHIPPING_OOS_BELOW,
  SHIPPING_OOS_ABOVE,
  PICKLE_DELIVERY_FEES,
} from '@/lib/constants';

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

/** True when the delivery state (2-letter code) is Texas. */
export function isTexas(state: string | undefined | null): boolean {
  return (state ?? '').trim().toUpperCase() === 'TX';
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
 * Shipping depends on the delivery state:
 *   Texas, under $60:       $4.99   |  $60+:  free
 *   Out-of-state, under $60: $6.99  |  $60+:  $2.99
 *
 * Pickup is always free. Pickle-only carts use the jar-based fee scale when
 * it exceeds the base fee (Texas, below threshold only). Mixed carts pay the
 * base fee. `subtotal + tax + shipping === total` exactly.
 */
export function calculateOrderTotals(
  subtotal: number,
  opts: {
    fulfillmentType?: 'pickup' | 'delivery';
    taxableSubtotal?: number;
    pickleJars?: number;
    deliveryState?: string;
  } = {}
): OrderTotals {
  const safeSubtotal = roundMoney(Math.max(0, Number(subtotal) || 0));
  const taxable = roundMoney(
    Math.min(safeSubtotal, Math.max(0, Number(opts.taxableSubtotal ?? safeSubtotal) || 0))
  );
  const tax = roundMoney(taxable * SALES_TAX_RATE);

  let shipping = 0;
  if (opts.fulfillmentType === 'delivery') {
    const tx = isTexas(opts.deliveryState);
    const aboveThreshold = safeSubtotal >= FREE_SHIPPING_THRESHOLD;

    if (tx) {
      if (aboveThreshold) {
        shipping = SHIPPING_TX_ABOVE; // free
      } else {
        const jars = opts.pickleJars ?? 0;
        const isMixedCart = jars > 0 && safeSubtotal > taxable;
        const baseFee = SHIPPING_TX_BELOW;
        shipping = isMixedCart
          ? baseFee
          : roundMoney(Math.max(pickleDeliveryFee(jars), baseFee));
      }
    } else {
      shipping = aboveThreshold ? SHIPPING_OOS_ABOVE : SHIPPING_OOS_BELOW;
    }
  }

  return { subtotal: safeSubtotal, tax, shipping, total: roundMoney(safeSubtotal + tax + shipping) };
}
