import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { utcTimestamp } from '@/lib/tax-records';

export interface RefundFacts {
  id?: string; payment_id?: string; status?: string;
  amount_money?: { amount?: number; currency?: string };
  updated_at?: string;
}

export function prepareRefundFacts(db: D1Database, orderId: string, refund: RefundFacts): D1PreparedStatement[] {
  const amount = refund.amount_money?.amount;
  if (!refund.id || !refund.payment_id || refund.amount_money?.currency !== 'USD' ||
      !Number.isSafeInteger(amount) || (amount ?? 0) <= 0) {
    throw new Error('Completed website refund is missing its amount or identity');
  }
  const providerDate = utcTimestamp(refund.updated_at);
  return [
    db.prepare(`INSERT INTO order_refunds
      (square_refund_id, order_id, square_payment_id, amount_cents, refunded_at, date_source)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(square_refund_id) DO NOTHING`)
      .bind(refund.id, orderId, refund.payment_id, amount!,
        providerDate ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
        providerDate ? 'square_refund_completed_update' : 'refund_observed_at'),
    // Only a single refund of the entire payment proves the full breakdown.
    // Partial/multiple refunds require an explicit allocation from the receipt.
    db.prepare(`INSERT INTO refund_allocations (square_refund_id, taxable_merchandise_cents,
      exempt_merchandise_cents, shipping_cents, taxable_shipping_cents, tax_cents, note, recorded_by)
      SELECT r.square_refund_id, t.taxable_merchandise_cents, t.exempt_merchandise_cents,
        t.shipping_cents, t.taxable_shipping_cents, t.tax_cents,
        'Full payment refunded; original receipt breakdown restored.', 'system_full_refund'
      FROM order_refunds r JOIN order_tax_records t ON t.order_id = r.order_id
      WHERE r.square_refund_id = ? AND r.amount_cents = t.total_cents
        AND NOT EXISTS (SELECT 1 FROM order_refunds other WHERE other.order_id = r.order_id
          AND other.square_refund_id <> r.square_refund_id)
        AND NOT EXISTS (SELECT 1 FROM refund_allocations a WHERE a.square_refund_id = r.square_refund_id)`)
      .bind(refund.id),
  ];
}

export interface RefundAllocation {
  refundId: string;
  taxableMerchandiseCents: number;
  exemptMerchandiseCents: number;
  shippingCents: number;
  taxableShippingCents: number;
  taxCents: number;
  note: string;
}
export const allocationFields = ['taxableMerchandiseCents', 'exemptMerchandiseCents', 'shippingCents',
  'taxableShippingCents', 'taxCents'] as const;

/** Append-only, with all totals/cross-refund limits checked in the INSERT itself. */
export async function saveRefundAllocation(db: D1Database, input: RefundAllocation): Promise<boolean> {
  if (typeof input.refundId !== 'string' || !input.refundId || input.refundId.length > 192 || typeof input.note !== 'string' ||
      input.note.trim().length < 5 || input.note.length > 500 ||
      allocationFields.some(field => !Number.isSafeInteger(input[field]) || input[field] < 0) ||
      input.taxableShippingCents > input.shippingCents) {
    throw new Error('Enter valid refund amounts and a note identifying the source receipt.');
  }
  const result = await db.prepare(`
    WITH others AS (
      SELECT COALESCE(SUM(a.taxable_merchandise_cents), 0) AS taxable,
        COALESCE(SUM(a.exempt_merchandise_cents), 0) AS exempt,
        COALESCE(SUM(a.shipping_cents), 0) AS shipping,
        COALESCE(SUM(a.taxable_shipping_cents), 0) AS taxable_shipping,
        COALESCE(SUM(a.tax_cents), 0) AS tax
      FROM order_refunds r JOIN refund_allocations a ON a.id =
        (SELECT MAX(id) FROM refund_allocations WHERE square_refund_id = r.square_refund_id)
      WHERE r.order_id = (SELECT order_id FROM order_refunds WHERE square_refund_id = ?)
        AND r.square_refund_id <> ?
    )
    INSERT INTO refund_allocations (square_refund_id, taxable_merchandise_cents,
      exempt_merchandise_cents, shipping_cents, taxable_shipping_cents, tax_cents, note, recorded_by)
    SELECT r.square_refund_id, ?, ?, ?, ?, ?, ?, 'admin'
    FROM order_refunds r JOIN order_tax_records t ON t.order_id = r.order_id CROSS JOIN others x
    WHERE r.square_refund_id = ? AND r.amount_cents = ?
      AND x.taxable + ? <= t.taxable_merchandise_cents
      AND x.exempt + ? <= t.exempt_merchandise_cents
      AND x.shipping + ? <= t.shipping_cents
      AND x.taxable_shipping + ? <= t.taxable_shipping_cents
      AND (x.shipping - x.taxable_shipping) + ? <= t.shipping_cents - t.taxable_shipping_cents
      AND x.tax + ? <= t.tax_cents`)
    .bind(input.refundId, input.refundId,
      input.taxableMerchandiseCents, input.exemptMerchandiseCents, input.shippingCents,
      input.taxableShippingCents, input.taxCents, input.note.trim(), input.refundId,
      input.taxableMerchandiseCents + input.exemptMerchandiseCents + input.shippingCents + input.taxCents,
      input.taxableMerchandiseCents, input.exemptMerchandiseCents, input.shippingCents,
      input.taxableShippingCents, input.shippingCents - input.taxableShippingCents, input.taxCents).run();
  return (result.meta.changes ?? 0) === 1;
}
