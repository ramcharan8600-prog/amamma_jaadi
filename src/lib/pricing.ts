/**
 * Order pricing — the SINGLE source of truth for money math.
 *
 * Both the checkout UI (what the customer is shown) and the server
 * (`create-session`, which computes the authoritative amount actually charged)
 * import from here, so the displayed total and the charged total can never
 * drift apart.
 */

import {
  STANDARD_SHIPPING_THRESHOLD,
  FAR_SHIPPING_MINIMUM,
  SHIPPING_TX,
  SHIPPING_PICKLES_SINGLE,
  SHIPPING_PICKLES_DOUBLE,
  SHIPPING_PICKLES_THREE_PLUS,
  SHIPPING_NEARBY_BELOW,
  SHIPPING_NEARBY_ABOVE,
  SHIPPING_FAR,
} from '@/lib/constants';
import type { DeliveryShippingMethod } from '@/types';

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

/** States in the nearby shipping region. */
export const NEARBY_STATE_CODES = ['AL', 'AR', 'CO', 'LA', 'NM', 'OK'] as const;

/**
 * Supported delivery destinations. Alaska and Hawaii intentionally remain
 * unavailable until a separate rate is approved.
 */
export const DELIVERY_STATE_OPTIONS = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
] as const;

const DELIVERY_STATE_CODES = new Set<string>(DELIVERY_STATE_OPTIONS.map(({ code }) => code));
const NEARBY_STATES = new Set<string>(NEARBY_STATE_CODES);

export type ShippingZone = 'texas' | 'nearby' | 'far';

export function normalizeStateCode(state: unknown): string {
  return typeof state === 'string' ? state.trim().toUpperCase() : '';
}

export function isSupportedDeliveryState(state: unknown): boolean {
  return DELIVERY_STATE_CODES.has(normalizeStateCode(state));
}

export function getShippingZone(state: string | undefined | null): ShippingZone {
  const code = normalizeStateCode(state);
  if (code === 'TX') return 'texas';
  if (NEARBY_STATES.has(code)) return 'nearby';
  return 'far';
}

export function shippingMethodLabel(method: DeliveryShippingMethod | null | undefined, picklesOnly = false): string {
  if (method === 'expedited') return 'Expedited — estimated 2 business days in transit';
  if (method === 'ground') return 'Ground — estimated 2–5 business days in transit';
  return picklesOnly ? 'Standard shipping' : 'UPS 2nd Day Air';
}

/** Pickle-only carts have no minimum; other far-state orders require $80. */
export function getDeliveryMinimumSubtotal(state: string | undefined | null, picklesOnly = false): number {
  return !picklesOnly && getShippingZone(state) === 'far' ? FAR_SHIPPING_MINIMUM : 0;
}

export function getDeliveryMinimumShortfall(
  subtotal: number,
  state: string | undefined | null,
  picklesOnly = false
): number {
  return roundMoney(Math.max(0, getDeliveryMinimumSubtotal(state, picklesOnly) - Math.max(0, subtotal)));
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
 * Pickle-only, all supported states, no minimum: $6.99 for one jar,
 * $5.99 for two jars, $4.99 for three or more jars.
 * Texas sweets and mixed carts: $6.99.
 * Current sandbox policy (mixed shipping treatment unconfirmed): taxable merchandise plus the whole delivery fee is
 * taxed when taxable merchandise is present; exempt-only carts have zero tax.
 * Sweets/mixed in nearby states (AL/AR/CO/LA/NM/OK): $11.99 below $60, otherwise $8.99.
 * Sweets/mixed in far states: $11.99 flat, with an $80 merchandise minimum.
 *
 * Pickup is always free. `subtotal + tax + shipping === total` exactly.
 */
export function calculateOrderTotals(
  subtotal: number,
  opts: {
    fulfillmentType?: 'pickup' | 'delivery';
    taxableSubtotal?: number;
    picklesOnly?: boolean;
    pickleJarCount?: number;
    deliveryState?: string;
    shippingMethod?: DeliveryShippingMethod;
    freeDelivery?: boolean;
  } = {}
): OrderTotals {
  const safeSubtotal = roundMoney(Math.max(0, Number(subtotal) || 0));
  const taxable = roundMoney(
    Math.min(safeSubtotal, Math.max(0, Number(opts.taxableSubtotal ?? safeSubtotal) || 0))
  );

  let shipping = 0;
  if (opts.fulfillmentType === 'delivery') {
    const zone = getShippingZone(opts.deliveryState);
    if (opts.picklesOnly) {
      const jars = Number.isSafeInteger(opts.pickleJarCount) ? (opts.pickleJarCount ?? 1) : 1;
      shipping = jars >= 3 ? SHIPPING_PICKLES_THREE_PLUS
        : jars === 2 ? SHIPPING_PICKLES_DOUBLE : SHIPPING_PICKLES_SINGLE;
    } else if (zone === 'texas') {
      shipping = SHIPPING_TX;
    } else if (zone === 'nearby') {
      shipping = safeSubtotal >= STANDARD_SHIPPING_THRESHOLD
        ? SHIPPING_NEARBY_ABOVE
        : SHIPPING_NEARBY_BELOW;
    } else {
      shipping = SHIPPING_FAR;
    }
  }

  // Waive the fee before calculating tax so a free fee is never taxed.
  if (opts.freeDelivery) shipping = 0;

  const taxableShipping = opts.fulfillmentType === 'delivery' && isTexas(opts.deliveryState) && taxable > 0
    ? shipping : 0;
  const tax = roundMoney((taxable + taxableShipping) * SALES_TAX_RATE);

  return { subtotal: safeSubtotal, tax, shipping, total: roundMoney(safeSubtotal + tax + shipping) };
}
