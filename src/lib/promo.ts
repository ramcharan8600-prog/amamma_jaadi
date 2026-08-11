/**
 * Promo codes.
 *
 * There are NO active codes today — the checkout field exists so campaigns can
 * be switched on later by adding entries to `PROMO_CODES` below.
 *
 * ⚠️ When real codes go live, the discount MUST also be applied server-side in
 * `create-session` (which computes the authoritative charged amount), exactly
 * like prices and tax already are. Never let the client decide a discount: the
 * checkout UI is display only and can be tampered with.
 */

export interface PromoCode {
  /** Uppercase, no spaces — compared against the normalized user input. */
  code: string;
  /** Shown to the customer when the code applies, e.g. "10% off". */
  label: string;
  /** 'percent' = value is 0-100; 'fixed' = value is a dollar amount. */
  type: 'percent' | 'fixed';
  value: number;
  /** Optional minimum order subtotal for the code to apply. */
  minSubtotal?: number;
  /** Optional last valid date, inclusive, as YYYY-MM-DD. */
  expiresAt?: string;
}

/** Active promo codes. Empty by design — add entries here to launch a campaign. */
export const PROMO_CODES: PromoCode[] = [];

/** Trim, strip spaces and uppercase, so " save10 " matches "SAVE10". */
export function normalizePromoCode(input: string): string {
  return (input || '').trim().replace(/\s+/g, '').toUpperCase();
}

export type PromoResult =
  | { ok: true; promo: PromoCode; discount: number }
  | { ok: false; reason: string };

/**
 * Validate a code against the active list for a given subtotal.
 * Returns a customer-safe `reason` when it doesn't apply.
 */
export function validatePromoCode(
  input: string,
  subtotal: number,
  today = new Date()
): PromoResult {
  const code = normalizePromoCode(input);
  if (!code) return { ok: false, reason: 'Enter a promo code.' };

  const promo = PROMO_CODES.find((p) => p.code === code);
  if (!promo) return { ok: false, reason: "That promo code isn't valid." };

  if (promo.expiresAt) {
    // Compare as YYYY-MM-DD strings to avoid any timezone drift.
    const todayStr = today.toISOString().slice(0, 10);
    if (todayStr > promo.expiresAt) {
      return { ok: false, reason: 'That promo code has expired.' };
    }
  }

  const safeSubtotal = Math.max(0, Number(subtotal) || 0);
  if (promo.minSubtotal != null && safeSubtotal < promo.minSubtotal) {
    return { ok: false, reason: `This code requires a minimum order of $${promo.minSubtotal}.` };
  }

  const raw = promo.type === 'percent' ? (safeSubtotal * promo.value) / 100 : promo.value;
  // Never discount more than the order is worth.
  const discount = Math.round(Math.min(raw, safeSubtotal) * 100) / 100;

  return { ok: true, promo, discount };
}
