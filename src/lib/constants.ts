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
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://amammajaadi.com';

/** The shop operates in Dallas, TX (US Central). Used for all business-date math. */
export const BUSINESS_TZ = 'America/Chicago';
