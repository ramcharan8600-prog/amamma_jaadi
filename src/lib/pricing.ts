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
  NEARBY_SHIPPING_TOP_THRESHOLD,
  FAR_SHIPPING_MINIMUM,
  SHIPPING_TX,
  TEXAS_DISCOUNTED_SHIPPING_MINIMUM,
  SHIPPING_TX_DISCOUNTED,
  SHIPPING_PICKLES_SINGLE,
  SHIPPING_PICKLES_DOUBLE,
  SHIPPING_PICKLES_THREE_PLUS,
  SHIPPING_NEARBY_BELOW,
  SHIPPING_NEARBY_ABOVE,
  SHIPPING_NEARBY_100,
  SHIPPING_FAR,
  SHIPPING_MALAI_KHAJA_FAR,
  SHIPPING_ASSORTED_BOX_TX,
  SHIPPING_ASSORTED_BOX_NEARBY,
  SHIPPING_ASSORTED_BOX_FAR,
  SHIPPING_BOBBATLU_BOX_TX,
  SHIPPING_BOBBATLU_BOX_NEARBY,
  SHIPPING_BOBBATLU_BOX_FAR,
  SHIPPING_MINI_COMBO_TX,
} from '@/lib/constants';
import type { DeliveryShippingMethod, Product } from '@/types';
import {
  ASSORTED_BOBBATLU_BOX_PRODUCT_ID, ASSORTED_BOX_PRODUCT_ID, BOBBATLU_TASTE_PACK_PRODUCT_ID, MINI_COMBO_PACK_PRODUCT_ID,
} from '@/data/products';

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
export const NEARBY_STATE_CODES = ['AL', 'AR', 'CO', 'FL', 'GA', 'IA', 'IL', 'KS', 'LA', 'MO', 'MS', 'NE', 'NM', 'OK', 'TN'] as const;

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

/**
 * `standardShipping` is true for carts that do not go UPS 2nd Day Air:
 * pickle-only carts and ground-shipped carts (see isGroundShippingCart).
 */
export function shippingMethodLabel(method: DeliveryShippingMethod | null | undefined, standardShipping = false): string {
  if (method === 'expedited') return 'Expedited — estimated 2 business days in transit';
  if (method === 'ground') return 'Ground — estimated 2–5 business days in transit';
  // Customers never see "Standard shipping" (owner, 2026-10-10).
  return standardShipping ? 'Express shipping' : 'UPS 2nd Day Air';
}

export type DeliveryService = 'texas' | 'standard' | 'express' | 'second-day-air';

/**
 * The delivery service customers are told about, in checkout and emails:
 * - Texas: about 1 business day after dispatch.
 * - Pickle-only outside Texas, and Ground-shipped boxes to far states: "Express shipping"
 *   (customers never see "Standard shipping", owner 2026-10-10).
 * - Nearby states: Express shipping (2-day ETA).
 * - Other states: UPS 2nd Day Air, except Malai Khaja-only and Assorted
 *   Box-only carts, which ship Standard at their lower rate.
 */
export function deliveryService(
  state: string | undefined | null,
  picklesOnly: boolean,
  groundShipping: GroundShippingKind | boolean | undefined
): DeliveryService {
  const zone = getShippingZone(state);
  if (zone === 'texas') return 'texas';
  if (picklesOnly) return 'standard';
  if (zone === 'nearby') return 'express';
  return groundShipping ? 'standard' : 'second-day-air';
}

const DELIVERY_SERVICE_LABELS: Record<DeliveryService, string> = {
  texas: 'Shipping (estimated 1 business day after dispatch)',
  standard: 'Express shipping',
  express: 'Express shipping (2-day ETA)',
  'second-day-air': 'UPS 2nd Day Air',
};

/** The shipping line's label. Orders recorded with a legacy method keep its wording. */
export function deliveryServiceLabel(
  service: DeliveryService,
  method?: DeliveryShippingMethod | null
): string {
  return method === 'expedited' || method === 'ground' ? shippingMethodLabel(method) : DELIVERY_SERVICE_LABELS[service];
}

/** Shown under the shipping charge on every delivery order with sweets; not on pickle-only orders (owner, 2026-10-10). */
export const EXPRESS_SWEETS_NOTE =
  'Our sweets have ZERO preservatives and are made with ghee, so express shipping is mandatory to enjoy them fresh and delicious. Thanks for understanding.';

export function isExpressDeliveryService(service: DeliveryService): boolean {
  return service === 'express' || service === 'second-day-air';
}

const ZONE_NAMES: Record<ShippingZone, string> = { texas: 'Texas', nearby: 'nearby states', far: 'other states' };

/**
 * Why `product` can't be delivered to `state` with this merchandise subtotal,
 * or null when it can. One rule for checkout, create-session and the first charge.
 */
export function deliveryRestriction(
  product: Pick<Product, 'name' | 'pickupOnly' | 'deliveryZones' | 'deliveryStateCodes' | 'deliveryOutsideStateMinimum'>,
  state: string | undefined | null,
  subtotal: number
): string | null {
  if (product.pickupOnly) {
    return `${product.name} is pickup only. Choose pickup, or remove it from your cart to have your order delivered.`;
  }
  if (product.deliveryZones && !product.deliveryZones.includes(getShippingZone(state))) {
    const zones = product.deliveryZones.map((zone) => ZONE_NAMES[zone]).join(' and ');
    return `${product.name} is delivered within ${zones} only. Choose pickup, remove it from your cart, or select an address in ${zones}.`;
  }
  const code = normalizeStateCode(state);
  if (product.deliveryStateCodes?.length && !product.deliveryStateCodes.includes(code) &&
      subtotal < (product.deliveryOutsideStateMinimum ?? Number.POSITIVE_INFINITY)) {
    const minimum = product.deliveryOutsideStateMinimum;
    return minimum === undefined
      ? `${product.name} can't be delivered to this state. Choose pickup or remove it from your cart.`
      : `${product.name} can be delivered outside Texas when the product subtotal is $${minimum.toFixed(2)} or more. Add $${roundMoney(minimum - subtotal).toFixed(2)} more, remove it, or select a Texas address.`;
  }
  return null;
}

export const MALAI_KHAJA_PRODUCT_ID = 'sweet-malai-khaja';

export type GroundShippingKind = 'malai-khaja' | 'assorted-box' | 'bobbatlu-box' | 'mini-combo';

/**
 * Carts made only of one of these get their own rate (see calculateShippingQuote);
 * adding anything else restores the regular rates. Intentionally quiet: no
 * banner or copy mentions these rates.
 * - Only Malai Khaja: regular Texas and nearby rates; far states a flat $10.99, no minimum.
 * - Only the 10:10 Assorted Box (any number, with or without the Bobbatlu Taste Pack
 *   add-on, which ships at the box's rate): $3.99 Texas, $5.99 nearby, $6.99 far, no minimum.
 * - Only the 8:8 Assorted Bobbatlu Box: $4.99 Texas, $7.99 nearby, $9.99 far (far keeps the $60 minimum).
 * - Only the Mini Combo Pack: $3.99 Texas, regular nearby and far rates (far keeps the $60 minimum).
 */
export function groundShippingKind(items: ReadonlyArray<{ productId: string; quantity?: number }>): GroundShippingKind | undefined {
  if (items.length === 0) return undefined;
  const only = (...ids: string[]) => items.every(({ productId }) => ids.includes(productId));
  if (only(MALAI_KHAJA_PRODUCT_ID)) return 'malai-khaja';
  if (only(MINI_COMBO_PACK_PRODUCT_ID)) return 'mini-combo';
  if (only(ASSORTED_BOBBATLU_BOX_PRODUCT_ID)) return 'bobbatlu-box';
  if (items.some(({ productId }) => productId === ASSORTED_BOX_PRODUCT_ID) &&
      only(ASSORTED_BOX_PRODUCT_ID, BOBBATLU_TASTE_PACK_PRODUCT_ID)) {
    return 'assorted-box';
  }
  return undefined;
}

/** A 10:10 box mixed with other items: the cart pays the higher of its regular and box rates (owner, 2026-10-12). */
export function containsAssortedBox(items: ReadonlyArray<{ productId: string }>): boolean {
  return items.some(({ productId }) => productId === ASSORTED_BOX_PRODUCT_ID);
}

export function isGroundShippingCart(items: ReadonlyArray<{ productId: string; quantity?: number }>): boolean {
  return groundShippingKind(items) !== undefined;
}

/**
 * Pickle-only and box/product-only carts have no minimum, except the 8:8
 * Bobbatlu Box and the Mini Combo Pack (one can't ship to a far state alone);
 * other far-state orders require $60.
 */
export function getDeliveryMinimumSubtotal(
  state: string | undefined | null,
  picklesOnly = false,
  groundShipping: GroundShippingKind | boolean | undefined = false
): number {
  const waived = picklesOnly || (!!groundShipping && groundShipping !== 'bobbatlu-box' && groundShipping !== 'mini-combo');
  return !waived && getShippingZone(state) === 'far' ? FAR_SHIPPING_MINIMUM : 0;
}

export function getDeliveryMinimumShortfall(
  subtotal: number,
  state: string | undefined | null,
  picklesOnly = false,
  groundShipping: GroundShippingKind | boolean | undefined = false
): number {
  return roundMoney(Math.max(0, getDeliveryMinimumSubtotal(state, picklesOnly, groundShipping) - Math.max(0, subtotal)));
}

export interface OrderTotals {
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
}

export interface ShippingOptions {
  fulfillmentType?: 'pickup' | 'delivery';
  picklesOnly?: boolean;
  /** The cart is only one product or box with its own rate (see groundShippingKind). */
  groundShipping?: GroundShippingKind;
  /** The cart holds a 10:10 box mixed with other items (see containsAssortedBox). */
  assortedBoxInCart?: boolean;
  pickleJarCount?: number;
  deliveryState?: string;
  shippingMethod?: DeliveryShippingMethod;
  freeDelivery?: boolean;
  /** Only for quotes saved before the flat pickle rate was introduced. */
  legacyPickleRates?: boolean;
}

export interface ShippingQuote {
  shipping: number;
  regularShipping: number;
  /** Shipping before the Texas $100 step; shown struck through when the step applies. */
  referenceShipping: number;
  /** Shipping saved by the Texas $100 step. */
  savings: number;
  /** Set when the Texas $100 step lowered the delivery fee. */
  discountedShippingMinimum?: number;
}

/** One quote for the checkout display, session amount, tax, and first charge. */
export function calculateShippingQuote(subtotal: number, opts: ShippingOptions = {}): ShippingQuote {
  let regularShipping = 0;
  let texasStep = false;
  const zone = getShippingZone(opts.deliveryState);
  if (opts.fulfillmentType === 'delivery') {
    // The regular rates (owner's rate card, 2026-10-12); Texas steps down to $3.99 from $100.
    const texasRegular = zone === 'texas';
    const regular = zone === 'texas' ? SHIPPING_TX
      : zone === 'nearby' ? subtotal >= NEARBY_SHIPPING_TOP_THRESHOLD ? SHIPPING_NEARBY_100
        : subtotal >= STANDARD_SHIPPING_THRESHOLD ? SHIPPING_NEARBY_ABOVE : SHIPPING_NEARBY_BELOW
      : SHIPPING_FAR;
    const box = { texas: SHIPPING_ASSORTED_BOX_TX, nearby: SHIPPING_ASSORTED_BOX_NEARBY, far: SHIPPING_ASSORTED_BOX_FAR }[zone];
    if (opts.picklesOnly) {
      const jars = Number.isSafeInteger(opts.pickleJarCount) ? (opts.pickleJarCount ?? 1) : 1;
      regularShipping = opts.legacyPickleRates ? jars >= 3 ? SHIPPING_PICKLES_THREE_PLUS
        : jars === 2 ? SHIPPING_PICKLES_DOUBLE : SHIPPING_PICKLES_SINGLE
        : zone === 'texas' ? SHIPPING_TX : SHIPPING_PICKLES_SINGLE;
      texasStep = zone === 'texas';
    } else if (opts.groundShipping === 'assorted-box') {
      regularShipping = box;
    } else if (opts.groundShipping === 'bobbatlu-box') {
      regularShipping = { texas: SHIPPING_BOBBATLU_BOX_TX, nearby: SHIPPING_BOBBATLU_BOX_NEARBY, far: SHIPPING_BOBBATLU_BOX_FAR }[zone];
    } else if (opts.groundShipping === 'mini-combo' && zone === 'texas') {
      regularShipping = SHIPPING_MINI_COMBO_TX;
    } else if (opts.groundShipping === 'malai-khaja' && zone === 'far') {
      regularShipping = SHIPPING_MALAI_KHAJA_FAR;
    } else if (opts.assortedBoxInCart && zone !== 'texas') {
      // A 10:10 box mixed with other items pays the higher of the two rates.
      regularShipping = Math.max(regular, box);
    } else {
      regularShipping = regular;
      texasStep = texasRegular;
    }
  }
  // Texas regular-rate orders pay $3.99 from $100 (shown as savings on the $5.99 rate).
  const stepped = texasStep && subtotal >= TEXAS_DISCOUNTED_SHIPPING_MINIMUM && regularShipping > SHIPPING_TX_DISCOUNTED;
  let shipping = stepped ? SHIPPING_TX_DISCOUNTED : regularShipping;
  if (opts.freeDelivery) shipping = 0;
  return {
    shipping,
    regularShipping,
    referenceShipping: regularShipping,
    savings: roundMoney(regularShipping - shipping),
    ...(stepped ? { discountedShippingMinimum: TEXAS_DISCOUNTED_SHIPPING_MINIMUM } : {}),
  };
}

/**
 * Break a subtotal into subtotal + tax + shipping + total (rates: calculateShippingQuote).
 *
 * Taxable merchandise plus the whole delivery fee is taxed when taxable
 * merchandise is present in a Texas delivery; exempt-only carts have zero tax.
 * Pickup is always free. `subtotal + tax + shipping === total` exactly.
 */
export function calculateOrderTotals(
  subtotal: number,
  opts: ShippingOptions & { taxableSubtotal?: number } = {}
): OrderTotals {
  const safeSubtotal = roundMoney(Math.max(0, Number(subtotal) || 0));
  const taxable = roundMoney(
    Math.min(safeSubtotal, Math.max(0, Number(opts.taxableSubtotal ?? safeSubtotal) || 0))
  );

  const { shipping } = calculateShippingQuote(safeSubtotal, opts);

  const taxableShipping = opts.fulfillmentType === 'delivery' && isTexas(opts.deliveryState) && taxable > 0 ? shipping : 0;
  const tax = roundMoney((taxable + taxableShipping) * SALES_TAX_RATE);

  return { subtotal: safeSubtotal, tax, shipping, total: roundMoney(safeSubtotal + tax + shipping) };
}
