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

/** The $60 boundary used by nearby-state shipping. */
export const STANDARD_SHIPPING_THRESHOLD = 60;

/** At or above this subtotal, nearby-state sweets/mixed orders ship for SHIPPING_NEARBY_100. */
export const NEARBY_SHIPPING_TOP_THRESHOLD = 100;

/** Minimum merchandise subtotal for far-state delivery when sweets are included. */
export const FAR_SHIPPING_MINIMUM = 60;

/** Flat UPS shipping within Texas. */
export const SHIPPING_TX = 6.99;

/** Texas deliveries at or above this merchandise subtotal pay the discounted delivery fee. */
export const TEXAS_DISCOUNTED_SHIPPING_MINIMUM = 120;
/** Texas delivery fee from TEXAS_DISCOUNTED_SHIPPING_MINIMUM, instead of SHIPPING_TX. */
export const SHIPPING_TX_DISCOUNTED = 3.99;
/** Texas deliveries from $100 up to TEXAS_DISCOUNTED_SHIPPING_MINIMUM pay SHIPPING_TX_MID. */
export const TEXAS_MID_SHIPPING_MINIMUM = 100;
export const SHIPPING_TX_MID = 4.99;

/** Shipping to any supported state for orders containing only pickle jars. */
export const SHIPPING_PICKLES_SINGLE = 6.99;
export const SHIPPING_PICKLES_DOUBLE = 5.99;
export const SHIPPING_PICKLES_THREE_PLUS = 4.99;

/** Shipping rates for the configured nearby-state region: under $60, $60-$99.99, $100+. */
export const SHIPPING_NEARBY_BELOW = 10.99;
export const SHIPPING_NEARBY_ABOVE = 8.99;
export const SHIPPING_NEARBY_100 = 7.99;

/** Flat shipping for eligible far-state orders. */
export const SHIPPING_FAR = 11.99;

/**
 * Out-of-state cap for carts holding only Malai Khaja, or only the Assorted
 * Box (shipped UPS Ground). No minimum applies. Deliberately not advertised.
 */
export const SHIPPING_GROUND_OUT_OF_STATE = 9.99;
/** Malai Khaja-only carts by total pieces: 50+ ship for $5.99 anywhere; 25+ ship to far states for $8.99. */
export const SHIPPING_MALAI_KHAJA_50 = 5.99;
export const SHIPPING_MALAI_KHAJA_FAR_25 = 8.99;
/** Flat rate for an Assorted Box-only cart to a nearby state (far states pay SHIPPING_GROUND_OUT_OF_STATE). */
export const SHIPPING_ASSORTED_BOX_NEARBY = 8.99;

/** Flat rates for a Mini Combo Pack-only cart, per order (it isn't delivered to far states). */
export const SHIPPING_MINI_COMBO_TX = 0;
export const SHIPPING_MINI_COMBO_NEARBY = 3.99;
/** A Texas order with the Mini Combo Pack plus other items ships free too. */
export const SHIPPING_MINI_COMBO_TX_MIXED = 0;
