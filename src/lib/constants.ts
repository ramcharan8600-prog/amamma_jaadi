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

/**
 * Free-shipping threshold, INCLUSIVE: a delivery order of exactly this amount
 * ships free, and the fee applies only strictly BELOW it. Customer-facing copy
 * must say "$50 and above" — "over $50" would wrongly imply $50 is charged.
 */
export const FREE_SHIPPING_THRESHOLD = 50;

/** Flat delivery fee charged on delivery orders below the free-shipping threshold. */
export const DELIVERY_FEE = 4;
