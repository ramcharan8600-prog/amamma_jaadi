import type { D1Database } from '@cloudflare/workers-types';

/**
 * Anonymous checkout step counts, kept in our own D1 so the owner can see where
 * shoppers leave: which of pickup or delivery they choose, whether the soonest
 * pickup day was sold out, and whether a delivery fee or block was shown.
 *
 * GA cannot answer this (no fulfillment type, ad blockers) and Workers Logs are
 * sampled. Rows hold a random per-checkout id, a step and a short code — never a
 * name, email, phone, address or IP.
 */
export const CHECKOUT_FUNNEL_STEPS = [
  'method_viewed', // reached "How would you like to receive your order?"
  'pickup_chosen',
  'delivery_chosen',
  'pickup_soonest_sold_out', // detail: days until the first open pickup day
  'pickup_date_chosen', // detail: days ahead of today
  'delivery_fee_shown', // detail: texas | nearby | far
  'delivery_blocked', // detail: paused | minimum | restricted | unsupported
  'address_suggestions_shown', // Google address suggestions appeared
  'address_suggestion_used', // the customer tapped one and the form filled in
  'payment_reached', // detail: pickup | delivery
  'order_completed', // detail: pickup | delivery
] as const;

export type CheckoutFunnelStep = (typeof CHECKOUT_FUNNEL_STEPS)[number];

const VISIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DETAIL = /^[a-z0-9-]{0,16}$/;

export function isCheckoutFunnelStep(value: unknown): value is CheckoutFunnelStep {
  return typeof value === 'string' && (CHECKOUT_FUNNEL_STEPS as ReadonlyArray<string>).includes(value);
}

/** Validated report, or null for anything malformed. */
export function parseFunnelReport(body: unknown): { visitId: string; step: CheckoutFunnelStep; detail: string } | null {
  if (!body || typeof body !== 'object') return null;
  const { visitId, step, detail = '' } = body as Record<string, unknown>;
  if (typeof visitId !== 'string' || !VISIT_ID.test(visitId)) return null;
  if (!isCheckoutFunnelStep(step)) return null;
  if (typeof detail !== 'string' || !DETAIL.test(detail)) return null;
  return { visitId, step, detail };
}

/** First report per checkout and step wins; repeats are ignored. */
export async function recordFunnelStep(db: D1Database, visitId: string, step: CheckoutFunnelStep, detail: string): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO checkout_funnel (visit_id, step, detail) VALUES (?, ?, ?)')
    .bind(visitId, step, detail)
    .run();
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
