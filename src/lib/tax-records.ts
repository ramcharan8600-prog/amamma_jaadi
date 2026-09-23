/** Historical tax facts, not a tax engine. Never reprice a paid order here. */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { getPickupLocationById, isProductTaxExempt } from '@/data/products';
import { SALES_TAX_RATE, isTexas, type OrderTotals } from '@/lib/pricing';
import type { CartItem } from '@/types';

export const TAX_POLICY_VERSION = '2026-09-23-texas-coupon-v5';
export const toCents = (value: number) => Math.round(value * 100);

export interface TaxSnapshot {
  version: 1;
  currency: 'USD';
  environment: string;
  policyVersion: string;
  rateBasisPoints: number;
  shippingTaxRule: 'none' | 'full_shipping' | 'legacy_out_of_state';
  reviewReason: string | null;
  merchandiseCents: number;
  taxableMerchandiseCents: number;
  exemptMerchandiseCents: number;
  /** Total delivery charges, including any maintenance fee, for tax/refund reconciliation. */
  shippingCents: number;
  maintenanceFeeCents?: number;
  taxableShippingCents: number;
  taxCents: number;
  totalCents: number;
  destination: { state: string; city: string; zip: string; country: string };
  fulfillment: Record<string, unknown>;
  items: Array<{
    productId: string; name: string; category: string; quantity: number;
    tier: number | null; variant: string | null; lineCents: number;
    treatment: 'exempt' | 'taxable'; classification: string;
  }>;
}

/** Only pass the server-validated cart and normalized fulfillment. */
export function buildTaxSnapshot(
  items: CartItem[], totals: OrderTotals, fulfillment: Record<string, unknown>, environment: string
): TaxSnapshot {
  const lines: TaxSnapshot['items'] = items.map(item => ({
    productId: item.productId, name: item.product.name, category: item.product.category,
    quantity: item.quantity, tier: item.selectedTier ?? null, variant: item.selectedVariant ?? null,
    lineCents: toCents(item.lineTotal), treatment: isProductTaxExempt(item.product) ? 'exempt' : 'taxable',
    classification: isProductTaxExempt(item.product) ? 'catalog_bakery_exemption' : 'catalog_prepared_food',
  }));
  const merchandiseCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
  const taxableMerchandiseCents = lines.filter(line => line.treatment === 'taxable')
    .reduce((sum, line) => sum + line.lineCents, 0);
  const pickup = fulfillment.type === 'pickup' && typeof fulfillment.locationId === 'string'
    ? getPickupLocationById(fulfillment.locationId) : undefined;
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const state = pickup?.state ?? text(fulfillment.state);
  const taxableShippingCents = fulfillment.type === 'delivery' && isTexas(state) && taxableMerchandiseCents > 0
    ? toCents(totals.shipping + (totals.maintenanceFee ?? 0)) : 0;
  const outsideTexas = fulfillment.type === 'delivery' && !isTexas(state);
  const mixed = taxableMerchandiseCents > 0 && taxableMerchandiseCents < merchandiseCents;
  const reviewReason = outsideTexas ? 'Out-of-state sourcing and product taxability require review.'
    : !state ? 'Pickup location missing; tax location requires review.'
      : mixed && taxableShippingCents > 0 ? 'Texas mixed-order shipping treatment requires confirmation.' : null;
  return {
    version: 1, currency: 'USD', environment, policyVersion: TAX_POLICY_VERSION,
    rateBasisPoints: Math.round(SALES_TAX_RATE * 10000),
    shippingTaxRule: outsideTexas ? 'legacy_out_of_state' : taxableShippingCents > 0 ? 'full_shipping' : 'none',
    reviewReason, merchandiseCents, taxableMerchandiseCents,
    exemptMerchandiseCents: merchandiseCents - taxableMerchandiseCents,
    ...(totals.maintenanceFee ? { maintenanceFeeCents: toCents(totals.maintenanceFee) } : {}),
    shippingCents: toCents(totals.shipping + (totals.maintenanceFee ?? 0)), taxableShippingCents,
    taxCents: toCents(totals.tax), totalCents: toCents(totals.total),
    destination: { state, city: pickup?.city ?? text(fulfillment.city), zip: pickup?.zip ?? text(fulfillment.zip), country: 'USA' },
    // Includes pickup address as it existed when the customer ordered.
    fulfillment: { ...fulfillment, ...(pickup ? { pickupAddress: { ...pickup } } : {}) }, items: lines,
  };
}

export function utcTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 19).replace('T', ' ') : null;
}

export interface PaymentDateFields {
  card_details?: { card_payment_timeline?: { captured_at?: string } };
  updated_at?: string;
}
export function paymentDate(fields?: PaymentDateFields): { paidAt: string; dateSource: string } {
  const captured = utcTimestamp(fields?.card_details?.card_payment_timeline?.captured_at);
  if (captured) return { paidAt: captured, dateSource: 'square_captured_at' };
  const updated = utcTimestamp(fields?.updated_at);
  return { paidAt: updated ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
    dateSource: updated ? 'square_completed_update' : 'completion_observed_at' };
}
export function preparePaymentReceipt(db: D1Database, sessionId: string, paymentId: string,
  date: ReturnType<typeof paymentDate> = paymentDate()): D1PreparedStatement {
  return db.prepare(`INSERT INTO payment_receipts (session_id, square_payment_id, paid_at, date_source)
    VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO NOTHING`)
    .bind(sessionId, paymentId, date.paidAt, date.dateSource);
}

/** Guarded by the same atomic finalization claim as the order and email. */
export async function prepareOrderTaxRecord(db: D1Database, sessionId: string, attemptId: string,
  totals: { total: number; tax: number; shipping: number; maintenanceFee?: number }): Promise<D1PreparedStatement | null> {
  const quote = await db.prepare('SELECT snapshot_json FROM payment_tax_quotes WHERE session_id = ?')
    .bind(sessionId).first<{ snapshot_json: string }>();
  // Legacy sessions have no historical classification. Reports flag them.
  if (!quote) return null;
  const s: TaxSnapshot = JSON.parse(quote.snapshot_json);
  if (s.version !== 1 || s.totalCents !== toCents(totals.total) || s.taxCents !== toCents(totals.tax) ||
      (s.maintenanceFeeCents ?? 0) !== toCents(totals.maintenanceFee ?? 0) ||
      s.shippingCents !== toCents(totals.shipping + (totals.maintenanceFee ?? 0)) ||
      s.merchandiseCents + s.shippingCents + s.taxCents !== s.totalCents ||
      s.taxableMerchandiseCents + s.exemptMerchandiseCents !== s.merchandiseCents) {
    throw new Error('Tax snapshot does not reconcile to the paid receipt');
  }
  return db.prepare(`INSERT INTO order_tax_records (
    order_id, session_id, paid_at, date_source, environment, destination_state, destination_city, destination_zip,
    merchandise_cents, taxable_merchandise_cents, exempt_merchandise_cents, shipping_cents, taxable_shipping_cents,
    tax_cents, total_cents, rate_basis_points, shipping_tax_rule, policy_version, review_reason, snapshot_json)
    SELECT f.order_id, ?, COALESCE(r.paid_at, f.finalized_at), COALESCE(r.date_source, 'completion_observed_at'),
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM order_finalizations f LEFT JOIN payment_receipts r ON r.session_id = f.payment_session_id
    WHERE f.attempt_id = ? ON CONFLICT(order_id) DO NOTHING`)
    .bind(sessionId, s.environment, s.destination.state, s.destination.city, s.destination.zip,
      s.merchandiseCents, s.taxableMerchandiseCents, s.exemptMerchandiseCents, s.shippingCents, s.taxableShippingCents,
      s.taxCents, s.totalCents, s.rateBasisPoints, s.shippingTaxRule, s.policyVersion, s.reviewReason, quote.snapshot_json, attemptId);
}
