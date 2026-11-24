/**
 * Single source of truth for brand-wide constants.
 * Import from here instead of re-declaring literals across files.
 */

export const BRAND_NAME = 'Amamma Jaadi';
export const BRAND_TAGLINE = 'Flavors of Home';

/**
 * Closes the online shop: every customer-facing page becomes the ShopClosed
 * notice and the checkout API refuses to start a payment. Nothing is deleted
 * and nothing is hidden — it simply says we are not taking orders.
 *
 * The admin portal (/admin) and everything it needs are UNAFFECTED, so orders
 * already paid for can still be prepared, shipped and emailed.
 *
 * CLOSED below is the switch, and one deploy either way: true closes the shop,
 * false opens it.
 *
 * The SHOP_CLOSED environment variable overrides it, and only the test run sets
 * it: 'off' for the suite at large, which checks the open shop, and 'on' in
 * shop-closed.test.ts, which checks the closed one. It is deliberately NOT a
 * NEXT_PUBLIC variable, so it never reaches the browser bundle — don't set it on
 * a deployed Worker, where the pages and the API would then disagree. To open or
 * close the real shop, change CLOSED.
 */
const CLOSED = false;
export const SHOP_CLOSED =
  process.env.SHOP_CLOSED === 'on' ? true
    : process.env.SHOP_CLOSED === 'off' ? false
      : CLOSED;

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

/** The $60 boundary used by nearby-state Malpuri / Malai Khaja shipping. */
export const STANDARD_SHIPPING_THRESHOLD = 60;

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

/** Nearby-state sweets/mixed orders: flat at any order value (owner, 2026-11-03; was $7.99 under $60, $6.99 from $60). */
export const SHIPPING_NEARBY = 9.99;

/** Far-state sweets/mixed orders (with the $60 minimum). */
export const SHIPPING_FAR = 11.99;

/** Malai Khaja-only carts to a far state: flat, any number of pieces, no minimum. */
export const SHIPPING_MALAI_KHAJA_FAR = 10.99;
/**
 * Carts of only loose Guntur Malpuri and/or Nellore Malai Khaja (one of them, or a mix)
 * to a nearby state: under $60, and from $60 (owner, 2026-11-03). Other states keep their rates.
 */
export const SHIPPING_MALPURI_KHAJA_NEARBY_BELOW = 10.99;
export const SHIPPING_MALPURI_KHAJA_NEARBY = 9.99;
/** 10:10 Assorted Box-only carts (any number of boxes, with or without the Taste Pack); no minimum. */
export const SHIPPING_ASSORTED_BOX_TX = 3.99;
export const SHIPPING_ASSORTED_BOX_NEARBY = 6.99;
export const SHIPPING_ASSORTED_BOX_FAR = 7.99;
/** 8:8 Assorted Bobbatlu Box-only carts (nearby $9.99, owner 2026-11-03); far states keep the $60 minimum (one box can't ship there). */
export const SHIPPING_BOBBATLU_BOX_TX = 4.99;
export const SHIPPING_BOBBATLU_BOX_NEARBY = 9.99;
export const SHIPPING_BOBBATLU_BOX_FAR = 9.99;
/** Mini Combo Pack-only carts: Texas, and nearby states flat at any number of packs (owner, 2026-11-03); far states aren't served. */
export const SHIPPING_MINI_COMBO_TX = 3.99;
export const SHIPPING_MINI_COMBO_NEARBY = 7.99;
/**
 * Extra on every delivery rate to these states (California, New York, New Jersey,
 * Virginia, Washington), which cost more to reach (owner, 2026-10-23). A 10:10
 * box-only cart keeps its flat rate.
 */
export const SHIPPING_SURCHARGE_STATE_CODES: readonly string[] = ['CA', 'NY', 'NJ', 'VA', 'WA'];
export const SHIPPING_STATE_SURCHARGE = 1;
/**
 * Flat-rate states (owner, 2026-11-24; Delaware first): every delivery order pays
 * one flat rate and needs a minimum product subtotal, whatever is in the cart
 * (the 10:10 box and Mini Combo Pack included). They stay in the "far" zone for
 * service labels and delivery pauses.
 */
export const FLAT_RATE_STATE_CODES: readonly string[] = ['DE'];
export const SHIPPING_FLAT_RATE_STATE = 12.99;
export const FLAT_RATE_STATE_MINIMUM = 48;

/**
 * Notice on the checkout delivery details step (Step 3; it sat under the Delivery choice until 2026-10-18). Since 2026-10-17 delivery runs as a
 * weekly batch (capped in Admin → Settings, shipped every Monday/Tuesday).
 * Set to null to remove it.
 */
export const DELIVERY_QUEUE_NOTICE: string | null =
  'Delivery orders are freshly prepared and shipped every Monday/Tuesday, so your sweets never sit in a UPS truck over the weekend.';

/** Smallest event (bulk) order, in pieces. The Events form and /api/events both use it. */
export const EVENT_MIN_PIECES = 75;
