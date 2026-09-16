import type { D1Database } from '@cloudflare/workers-types';
import { businessDateUtcRange, d1TimestampToBusinessDate } from '@/lib/date';
import type { TaxSnapshot } from '@/lib/tax-records';

export interface TaxReportRow {
  event_id: string;
  event_type: 'sale' | 'refund';
  order_id: string;
  order_number: string;
  square_payment_id: string;
  occurred_at: string;
  date_source: string;
  order_type: string;
  payment_status: string;
  environment: string;
  destination_state: string | null;
  destination_city: string | null;
  destination_zip: string | null;
  merchandise_cents: number | null;
  taxable_merchandise_cents: number | null;
  exempt_merchandise_cents: number | null;
  shipping_cents: number | null;
  taxable_shipping_cents: number | null;
  tax_cents: number | null;
  total_cents: number;
  rate_basis_points: number | null;
  shipping_tax_rule: string | null;
  policy_version: string | null;
  review_reason: string | null;
  snapshot_json: string | null;
  allocation_note: string | null;
  issues: string[];
}
export interface RefundGap {
  order_id: string; order_number: string; square_payment_id: string;
  refunded_cents: number; recorded_refunds_cents: number;
}
export interface ReportingExclusion {
  order_id: string; order_number: string; reason: string; recorded_by: string; recorded_at: string;
}
export interface TaxReportSummary {
  salesCount: number; refundCount: number; collectedTaxCents: number;
  allocatedRefundTaxCents: number; netRecordedTaxCents: number;
  merchandiseCents: number; taxableMerchandiseCents: number; exemptMerchandiseCents: number;
  shippingCents: number; taxableShippingCents: number; grossReceiptsCents: number;
  refundCents: number; unallocatedRefundCount: number; reviewCount: number;
  refundedTaxableMerchandiseCents: number; refundedExemptMerchandiseCents: number;
  refundedShippingCents: number; refundedTaxableShippingCents: number;
}
export interface TaxReport {
  year: number; quarter: number; start: string; end: string; timeZone: string; environment: string;
  generatedAt: string; rows: TaxReportRow[]; summary: TaxReportSummary;
  refundGaps: RefundGap[]; byState: Array<{ state: string; taxCollectedCents: number; taxRefundedCents: number }>;
  allocationHistory: Array<Record<string, unknown>>;
  // Global audit list; exclusions apply regardless of the selected quarter.
  reportingExclusions: ReportingExclusion[];
}

export function quarterRange(year: number, quarter: number) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new Error('Choose a valid year and quarter.');
  }
  const startDate = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`;
  const endDate = quarter === 4 ? `${year + 1}-01-01` : `${year}-${String(quarter * 3 + 1).padStart(2, '0')}-01`;
  return { start: businessDateUtcRange(startDate)!.start, end: businessDateUtcRange(endDate)!.start };
}

function rowIssues(row: TaxReportRow): string[] {
  const issues: string[] = [];
  if (!row.policy_version) issues.push('Historical tax breakdown unavailable');
  if (row.review_reason) issues.push(row.review_reason);
  if (!['square_captured_at', 'square_completed_update', 'square_refund_completed_update', 'historical_order_created_at'].includes(row.date_source)) {
    issues.push('Payment/refund date needs reconciliation');
  }
  if (row.event_type === 'refund' && row.tax_cents === null) issues.push('Refund breakdown needs allocation');
  if (row.event_type === 'sale' && row.tax_cents === null) issues.push('Historical tax amount unavailable');
  return issues;
}

/** One quarter of immutable sales plus refunds occurring in that quarter, regardless of sale date.
 * Deliberately independent of the dashboard's 200-order limit and pickup date filters.
 */
export async function getTaxReport(db: D1Database, year: number, quarter: number, environment: string): Promise<TaxReport> {
  const { start, end } = quarterRange(year, quarter);
  const paidDate = 'COALESCE(t.paid_at, p.paid_at, o.created_at)';
  const [sales, refunds, gaps, history, exclusions] = await db.batch([
    db.prepare(`SELECT o.id AS event_id, 'sale' AS event_type, o.id AS order_id, o.order_number,
      o.square_payment_id, ${paidDate} AS occurred_at,
      COALESCE(t.date_source, p.date_source, 'legacy_order_created_at') AS date_source,
      o.order_type, o.payment_status, COALESCE(t.environment, ?) AS environment,
      t.destination_state, t.destination_city, t.destination_zip,
      t.merchandise_cents, t.taxable_merchandise_cents, t.exempt_merchandise_cents,
      t.shipping_cents, t.taxable_shipping_cents, CAST(ROUND(o.tax * 100) AS INTEGER) AS tax_cents,
      CAST(ROUND(o.total_price * 100) AS INTEGER) AS total_cents,
      t.rate_basis_points, t.shipping_tax_rule, t.policy_version, t.review_reason, t.snapshot_json,
      NULL AS allocation_note
      FROM orders o LEFT JOIN order_tax_records t ON t.order_id = o.id
      LEFT JOIN payment_receipts p ON p.square_payment_id = o.square_payment_id
      WHERE o.payment_status IN ('paid', 'partially_refunded', 'refunded')
        AND NOT EXISTS (SELECT 1 FROM order_reporting_exclusions x WHERE x.order_id = o.id)
        AND ${paidDate} >= ? AND ${paidDate} < ? ORDER BY occurred_at, o.id`).bind(environment, start, end),
    db.prepare(`SELECT r.square_refund_id AS event_id, 'refund' AS event_type, o.id AS order_id,
      o.order_number, o.square_payment_id, r.refunded_at AS occurred_at, r.date_source,
      o.order_type, o.payment_status, COALESCE(t.environment, ?) AS environment,
      t.destination_state, t.destination_city, t.destination_zip,
      a.taxable_merchandise_cents + a.exempt_merchandise_cents AS merchandise_cents,
      a.taxable_merchandise_cents, a.exempt_merchandise_cents, a.shipping_cents, a.taxable_shipping_cents,
      a.tax_cents, r.amount_cents AS total_cents, t.rate_basis_points, t.shipping_tax_rule,
      t.policy_version, t.review_reason, NULL AS snapshot_json, a.note AS allocation_note
      FROM order_refunds r JOIN orders o ON o.id = r.order_id
      LEFT JOIN order_tax_records t ON t.order_id = o.id
      LEFT JOIN refund_allocations a ON a.id = (SELECT MAX(id) FROM refund_allocations WHERE square_refund_id = r.square_refund_id)
      WHERE r.refunded_at >= ? AND r.refunded_at < ?
        AND NOT EXISTS (SELECT 1 FROM order_reporting_exclusions x WHERE x.order_id = o.id)
      ORDER BY r.refunded_at, r.square_refund_id`).bind(environment, start, end),
    // Unknown historical refunds cannot honestly be assigned to a quarter.
    db.prepare(`SELECT o.id AS order_id, o.order_number, o.square_payment_id,
      CAST(ROUND(o.refunded_amount * 100) AS INTEGER) AS refunded_cents,
      COALESCE(SUM(r.amount_cents), 0) AS recorded_refunds_cents
      FROM orders o LEFT JOIN order_refunds r ON r.order_id = o.id
      WHERE o.refunded_amount > 0
        AND NOT EXISTS (SELECT 1 FROM order_reporting_exclusions x WHERE x.order_id = o.id)
      GROUP BY o.id
      HAVING CAST(ROUND(o.refunded_amount * 100) AS INTEGER) <> COALESCE(SUM(r.amount_cents), 0)`),
    db.prepare(`SELECT a.*, r.order_id, r.refunded_at, o.order_number
      FROM refund_allocations a JOIN order_refunds r ON r.square_refund_id = a.square_refund_id
      JOIN orders o ON o.id = r.order_id WHERE r.refunded_at >= ? AND r.refunded_at < ?
        AND NOT EXISTS (SELECT 1 FROM order_reporting_exclusions x WHERE x.order_id = o.id)
      ORDER BY a.id`).bind(start, end),
    db.prepare(`SELECT x.order_id, o.order_number, x.reason, x.recorded_by, x.recorded_at
      FROM order_reporting_exclusions x JOIN orders o ON o.id = x.order_id
      ORDER BY x.recorded_at, o.order_number`),
  ]);
  const rows = [...sales.results, ...refunds.results] as unknown as TaxReportRow[];
  for (const row of rows) row.issues = rowIssues(row);
  const summary: TaxReportSummary = {
    salesCount: 0, refundCount: 0, collectedTaxCents: 0, allocatedRefundTaxCents: 0, netRecordedTaxCents: 0,
    merchandiseCents: 0, taxableMerchandiseCents: 0, exemptMerchandiseCents: 0,
    shippingCents: 0, taxableShippingCents: 0, grossReceiptsCents: 0, refundCents: 0,
    unallocatedRefundCount: 0, reviewCount: 0, refundedTaxableMerchandiseCents: 0,
    refundedExemptMerchandiseCents: 0, refundedShippingCents: 0, refundedTaxableShippingCents: 0,
  };
  const states = new Map<string, TaxReport['byState'][number]>();
  for (const row of rows) {
    const state = row.destination_state || 'Unknown';
    const stateTotals = states.get(state) ?? { state, taxCollectedCents: 0, taxRefundedCents: 0 };
    if (row.issues.length) summary.reviewCount++;
    if (row.event_type === 'sale') {
      summary.salesCount++;
      summary.collectedTaxCents += row.tax_cents ?? 0;
      summary.grossReceiptsCents += row.total_cents;
      summary.merchandiseCents += row.merchandise_cents ?? 0;
      summary.taxableMerchandiseCents += row.taxable_merchandise_cents ?? 0;
      summary.exemptMerchandiseCents += row.exempt_merchandise_cents ?? 0;
      summary.shippingCents += row.shipping_cents ?? 0;
      summary.taxableShippingCents += row.taxable_shipping_cents ?? 0;
      stateTotals.taxCollectedCents += row.tax_cents ?? 0;
    } else {
      summary.refundCount++;
      summary.refundCents += row.total_cents;
      summary.allocatedRefundTaxCents += row.tax_cents ?? 0;
      summary.refundedTaxableMerchandiseCents += row.taxable_merchandise_cents ?? 0;
      summary.refundedExemptMerchandiseCents += row.exempt_merchandise_cents ?? 0;
      summary.refundedShippingCents += row.shipping_cents ?? 0;
      summary.refundedTaxableShippingCents += row.taxable_shipping_cents ?? 0;
      if (row.tax_cents === null) summary.unallocatedRefundCount++;
      stateTotals.taxRefundedCents += row.tax_cents ?? 0;
    }
    states.set(state, stateTotals);
  }
  summary.netRecordedTaxCents = summary.collectedTaxCents - summary.allocatedRefundTaxCents;
  return { year, quarter, start, end, timeZone: 'America/Chicago', environment,
    generatedAt: new Date().toISOString(), rows, summary,
    refundGaps: gaps.results as unknown as RefundGap[],
    byState: Array.from(states.values()).sort((a, b) => a.state.localeCompare(b.state)),
    allocationHistory: history.results as Record<string, unknown>[],
    reportingExclusions: exclusions.results as unknown as ReportingExclusion[],
  };
}

// CSV text cells cannot become spreadsheet formulas. Numeric values remain numeric.
function csvCell(value: unknown): string {
  if (value == null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function csv(rows: unknown[][]): string { return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
const dollars = (cents: number | null) => cents == null ? null : cents / 100;

export function taxReportCsv(report: TaxReport, view: 'transactions' | 'items' | 'summary' | 'refund-history'): string {
  if (view === 'summary') {
    return csv([['Year', 'Quarter', 'Time zone', 'Environment', 'Measure', 'Value'],
      ...Object.entries(report.summary).map(([key, value]) => [report.year, report.quarter, report.timeZone,
        report.environment, key.endsWith('Cents') ? key.replace(/Cents$/, ' (USD)') : key,
        key.endsWith('Cents') ? value / 100 : value]),
      [report.year, report.quarter, report.timeZone, report.environment, 'Unreconciled refund orders (all dates)', report.refundGaps.length],
      [report.year, report.quarter, report.timeZone, report.environment, 'Excluded test orders (all dates)', report.reportingExclusions.length],
      ...report.reportingExclusions.flatMap(exclusion => [
        [report.year, report.quarter, report.timeZone, report.environment, `Excluded test order ${exclusion.order_number}: reason`, exclusion.reason],
        [report.year, report.quarter, report.timeZone, report.environment, `Excluded test order ${exclusion.order_number}: order ID`, exclusion.order_id],
        [report.year, report.quarter, report.timeZone, report.environment, `Excluded test order ${exclusion.order_number}: recorded by`, exclusion.recorded_by],
        [report.year, report.quarter, report.timeZone, report.environment, `Excluded test order ${exclusion.order_number}: recorded at (UTC)`, exclusion.recorded_at],
      ]),
      [report.year, report.quarter, report.timeZone, report.environment, 'Scope', 'Website records only; not a completed tax return. Missing breakdowns excluded from component totals.'],
    ]);
  }
  if (view === 'refund-history') {
    const headers = ['id', 'square_refund_id', 'order_number', 'refunded_at', 'taxable_merchandise_cents',
      'exempt_merchandise_cents', 'shipping_cents', 'taxable_shipping_cents', 'tax_cents', 'note', 'recorded_by', 'created_at'];
    return csv([headers, ...report.allocationHistory.map(row => headers.map(key => row[key]))]);
  }
  if (view === 'items') {
    const result: unknown[][] = [['Order', 'Square payment ID', 'Paid date (Central)', 'Environment', 'Product ID', 'Product',
      'Category', 'Quantity', 'Tier', 'Variant', 'Line amount (USD)', 'Treatment', 'Classification used', 'Policy version', 'Review notes']];
    for (const row of report.rows.filter(row => row.event_type === 'sale')) {
      const s: TaxSnapshot | null = row.snapshot_json ? JSON.parse(row.snapshot_json) : null;
      if (!s) result.push([row.order_number, row.square_payment_id, d1TimestampToBusinessDate(row.occurred_at), row.environment,
        '', '', '', '', '', '', '', '', '', '', 'Historical item tax classifications unavailable']);
      else for (const line of s.items) result.push([row.order_number, row.square_payment_id,
        d1TimestampToBusinessDate(row.occurred_at), row.environment, line.productId, line.name, line.category,
        line.quantity, line.tier, line.variant, dollars(line.lineCents), line.treatment, line.classification,
        s.policyVersion, row.issues.join('; ')]);
    }
    return csv(result);
  }
  return csv([['Event', 'Event ID', 'Order', 'Square payment ID', 'Date (Central)', 'Timestamp (UTC)', 'Date source',
    'Environment', 'Fulfillment', 'Payment status', 'State', 'City', 'ZIP', 'Merchandise (USD)', 'Taxable merchandise (USD)',
    'Exempt merchandise (USD)', 'Shipping (USD)', 'Taxable shipping (USD)', 'Tax (USD)', 'Total (USD)',
    'Configured rate (%)', 'Shipping tax rule', 'Policy version', 'Review notes', 'Refund allocation note'],
  ...report.rows.map(row => {
    const signed = (amount: number | null) => amount == null ? null : dollars(amount * (row.event_type === 'refund' ? -1 : 1));
    return [row.event_type, row.event_id, row.order_number, row.square_payment_id, d1TimestampToBusinessDate(row.occurred_at),
      row.occurred_at, row.date_source, row.environment, row.order_type, row.payment_status, row.destination_state,
      row.destination_city, row.destination_zip, signed(row.merchandise_cents), signed(row.taxable_merchandise_cents),
      signed(row.exempt_merchandise_cents), signed(row.shipping_cents), signed(row.taxable_shipping_cents), signed(row.tax_cents),
      signed(row.total_cents), row.rate_basis_points == null ? null : row.rate_basis_points / 100,
      row.shipping_tax_rule, row.policy_version, row.issues.join('; '), row.allocation_note];
  })]);
}
