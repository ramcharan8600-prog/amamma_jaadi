/**
 * Single source of truth for brand-wide constants.
 * Import from here instead of re-declaring literals across files.
 */

export const BRAND_NAME = 'Amamma Jaadi';
export const BRAND_TAGLINE = 'Flavors of Home';

export const PHONE_NUMBER = '510-574-5578';
export const PHONE_E164 = '+1-510-574-5578';
export const INSTAGRAM_HANDLE = 'AMAMMA_JAADI';

// wa.me requires international format with no '+' or punctuation (e.g. US: 1 + 10 digits).
// Falls back to the business line so the link works even without the env var set.
export const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '15105745578';
/**
 * Canonical public site origin. Deliberately a CONSTANT, not an env var.
 *
 * This is used for absolute URLs that leave the site — the logo in transactional
 * emails and the SEO/JSON-LD metadata — where the production domain is the only
 * correct value. It used to read `NEXT_PUBLIC_SITE_URL`, which Next.js inlines at
 * BUILD time: a local build picked up `http://localhost:3000` from .env.local and
 * shipped it, so order confirmation emails asked the recipient's own machine for
 * the logo and showed a broken image. Same failure mode as the Square sandbox
 * config leak — a build-time env value must never decide a production URL.
 */
export const SITE_URL = 'https://amammajaadi.com';

/** The shop operates in Dallas, TX (US Central). Used for all business-date math. */
export const BUSINESS_TZ = 'America/Chicago';

// Shipping rate card (owner, 2026-10-12). The private copy lives in
// docs/internal/shipping-rules.md; never publish these numbers in customer copy.

/** The $60 boundary used by nearby-state shipping. */
export const STANDARD_SHIPPING_THRESHOLD = 60;

/** At or above this subtotal, nearby-state sweets/mixed orders ship for SHIPPING_NEARBY_100. */
export const NEARBY_SHIPPING_TOP_THRESHOLD = 100;

/** Minimum merchandise subtotal for far-state delivery when sweets are included. */
export const FAR_SHIPPING_MINIMUM = 60;

/** Texas delivery under TEXAS_DISCOUNTED_SHIPPING_MINIMUM. */
export const SHIPPING_TX = 5.99;
/** Texas deliveries at or above this merchandise subtotal pay SHIPPING_TX_DISCOUNTED. */
export const TEXAS_DISCOUNTED_SHIPPING_MINIMUM = 100;
export const SHIPPING_TX_DISCOUNTED = 3.99;

/** Pickle-only orders outside Texas (Texas pickle-only orders pay the Texas rates). */
export const SHIPPING_PICKLES_SINGLE = 6.99;
/** Only for quotes saved before the flat pickle rate. */
export const SHIPPING_PICKLES_DOUBLE = 5.99;
export const SHIPPING_PICKLES_THREE_PLUS = 4.99;

/** Nearby-state sweets/mixed orders: under $60, $60-$99.99, $100+. */
export const SHIPPING_NEARBY_BELOW = 6.99;
export const SHIPPING_NEARBY_ABOVE = 5.99;
export const SHIPPING_NEARBY_100 = 4.99;

/** Far-state sweets/mixed orders (with the $60 minimum). */
export const SHIPPING_FAR = 11.99;

/** Malai Khaja-only carts to a far state: flat, any number of pieces, no minimum. */
export const SHIPPING_MALAI_KHAJA_FAR = 10.99;
/** 10:10 Assorted Box-only carts (any number of boxes, with or without the Taste Pack); no minimum. */
export const SHIPPING_ASSORTED_BOX_TX = 3.99;
export const SHIPPING_ASSORTED_BOX_NEARBY = 5.99;
export const SHIPPING_ASSORTED_BOX_FAR = 6.99;
/** 8:8 Assorted Bobbatlu Box-only carts; far states keep the $60 minimum (one box can't ship there). */
export const SHIPPING_BOBBATLU_BOX_TX = 4.99;
export const SHIPPING_BOBBATLU_BOX_NEARBY = 7.99;
export const SHIPPING_BOBBATLU_BOX_FAR = 9.99;
/** Mini Combo Pack-only carts in Texas (nearby states pay the regular rates; far states aren't served). */
export const SHIPPING_MINI_COMBO_TX = 3.99;

/**
 * Temporary notice under Delivery at checkout while the kitchen works through
 * a backlog (owner, 2026-10-14). Set to null to remove it.
 */
export const DELIVERY_QUEUE_NOTICE: string | null =
  'Currently we are sold out and have a queue of orders ahead. We are freshly preparing, so please allow us 3–4 days of preparation time. Thanks for understanding.';
