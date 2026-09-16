import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1 } from '@/lib/test-utils/d1';
import { validateCart } from '@/lib/cart-validation';
import { calculateOrderTotals } from '@/lib/pricing';
import { buildTaxSnapshot, preparePaymentReceipt, paymentDate } from '@/lib/tax-records';
import { createOrderFromSession, type PaymentSessionRow } from '@/lib/order-service';
import { getTaxReport, quarterRange, taxReportCsv } from '@/lib/tax-report';
import { processRefundEvent } from '@/lib/square-webhook';
import { saveRefundAllocation } from '@/lib/tax-refunds';

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => ({ env: { EMAIL_QUEUE: { send: async () => {} } } }) }));
const schema = readFileSync(new URL('./d1-schema.sql', import.meta.url), 'utf8');
const legacyMigration = readFileSync(new URL('./migrations/012-legacy-exempt-sweets.sql', import.meta.url), 'utf8');
let f: ReturnType<typeof createTestD1>;
beforeEach(() => { f = createTestD1(); f.sqlite.exec(schema); });
afterEach(() => { f.sqlite.close(); vi.unstubAllEnvs(); });

async function sale(id = 'test', paidAt = '2026-09-15T18:00:00Z', finalize = true) {
  const cart = validateCart([
    { productId: 'gift-box-sweet-memories', quantity: 1, selectedVariant: '12 pcs Guntur Malpuri' },
    { productId: 'pickle-gongura-chicken', quantity: 1 },
  ]);
  if (!cart.ok) throw new Error(cart.error);
  const fulfillment = { type: 'delivery' as const, addressLine1: '123 Test St', city: 'Plano', state: 'TX', zip: '75093', country: 'USA' };
  const totals = calculateOrderTotals(cart.subtotal, { taxableSubtotal: cart.taxableSubtotal, fulfillmentType: 'delivery', deliveryState: 'TX' });
  const snapshot = buildTaxSnapshot(cart.items, totals, fulfillment, 'sandbox');
  const session: PaymentSessionRow = { id, order_id: null, customer_name: 'Test', email: 'test@example.invalid', phone_number: '2145550100',
    cart_data: cart.items, fulfillment_data: fulfillment, total_amount: totals.total, tax: totals.tax, shipping: totals.shipping, coupon_code: null };
  f.sqlite.prepare(`INSERT INTO payment_sessions (id,customer_name,email,phone_number,cart_data,fulfillment_data,total_amount,tax,shipping)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, session.customer_name, session.email, session.phone_number, JSON.stringify(cart.items), JSON.stringify(fulfillment), totals.total, totals.tax, totals.shipping);
  f.sqlite.prepare('INSERT INTO payment_tax_quotes (session_id,snapshot_json) VALUES (?,?)').run(id, JSON.stringify(snapshot));
  await preparePaymentReceipt(f.db, id, `pay-${id}`, paymentDate({ card_details: { card_payment_timeline: { captured_at: paidAt } } })).run();
  const result = finalize ? await createOrderFromSession(f.db, session, `pay-${id}`) : null;
  return { session, snapshot, result };
}
async function refund(id: string, amount: number, totalRefunded: number, at = '2026-10-03T18:00:00Z', paymentId = 'pay-test') {
  return processRefundEvent(f.db, 'refund.updated', { id, payment_id: paymentId, status: 'COMPLETED',
    amount_money: { amount, currency: 'USD' }, updated_at: at },
  async () => ({ totalAmount: 5813, refundedAmount: totalRefunded }));
}
function legacy(id: string, created = '2026-08-01 18:00:00', tax = 0) {
  f.sqlite.prepare(`INSERT INTO orders (id,order_number,customer_name,phone_number,order_type,total_price,tax,square_payment_id,payment_status,created_at)
    VALUES (?,?, 'Test', '555', 'delivery',36.99,?,?, 'paid',?)`).run(id, `AJ-${id}`, tax, `oldpay-${id}`, created);
  f.sqlite.prepare(`INSERT INTO order_items (id,order_id,product_name,quantity,product_price,line_total) VALUES (?,?, 'Baked sweets',1,30,30)`).run(`item-${id}`, id);
}

describe('historical tax records', () => {
  it('saves the charged base, classifications, destination and policy atomically and only once', async () => {
    const { session, result } = await sale();
    expect(f.sqlite.prepare('SELECT * FROM order_tax_records').get()).toMatchObject({
      order_id: result?.orderId, merchandise_cents: 4900, taxable_merchandise_cents: 1900,
      exempt_merchandise_cents: 3000, shipping_cents: 699, taxable_shipping_cents: 699,
      tax_cents: 214, total_cents: 5813, rate_basis_points: 825, destination_state: 'TX', destination_zip: '75093',
      paid_at: '2026-09-15 18:00:00', date_source: 'square_captured_at',
    });
    await createOrderFromSession(f.db, session, 'pay-test');
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM order_tax_records').get()?.n).toBe(1);
    expect(() => f.sqlite.exec('UPDATE order_tax_records SET tax_cents = 1')).toThrow('immutable');
    expect(() => f.sqlite.exec("UPDATE payment_tax_quotes SET snapshot_json = '{}' ")).toThrow('immutable');
  });
  it('rolls back the order if the tax record cannot be committed and safely recovers', async () => {
    const { session } = await sale('test', undefined, false);
    f.faults.failOnSql = /INSERT INTO order_tax_records/; f.faults.failuresRemaining = 1;
    await expect(createOrderFromSession(f.db, session, 'pay-test')).rejects.toThrow('Injected');
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM orders').get()?.n).toBe(0);
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM email_outbox').get()?.n).toBe(0);
    await createOrderFromSession(f.db, session, 'pay-test');
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM order_tax_records').get()?.n).toBe(1);
  });
  it('does not count unpaid quotes as sales', async () => {
    await sale('unpaid', undefined, false);
    expect((await getTaxReport(f.db, 2026, 3, 'sandbox')).summary.salesCount).toBe(0);
  });
  it('uses Central quarter boundaries and provider capture dates rather than order finalization dates', async () => {
    expect(quarterRange(2026, 1)).toEqual({ start: '2026-01-01 06:00:00', end: '2026-04-01 05:00:00' });
    expect(quarterRange(2026, 4)).toEqual({ start: '2026-10-01 05:00:00', end: '2027-01-01 06:00:00' });
    await sale('q1', '2026-04-01T04:59:59Z'); await sale('q2', '2026-04-01T05:00:00Z');
    expect((await getTaxReport(f.db, 2026, 1, 'sandbox')).rows.map(r => r.square_payment_id)).toEqual(['pay-q1']);
    expect((await getTaxReport(f.db, 2026, 2, 'sandbox')).rows.map(r => r.square_payment_id)).toEqual(['pay-q2']);
    expect(() => quarterRange(2026, 5)).toThrow();
  });
  it('records owner-confirmed old sweets as exempt without changing receipts, including more than 200 orders', async () => {
    for (let i = 0; i < 215; i++) legacy(`old-${i}`);
    legacy('tax-conflict', undefined, 1);
    legacy('after-cutoff', '2026-09-17 00:00:00');
    f.sqlite.exec(legacyMigration); f.sqlite.exec(legacyMigration);
    const report = await getTaxReport(f.db, 2026, 3, 'sandbox');
    expect(report.rows).toHaveLength(217);
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM order_tax_records').get()?.n).toBe(215);
    expect(report.rows.find(r => r.order_number === 'AJ-old-0')).toMatchObject({
      tax_cents: 0, taxable_merchandise_cents: 0, exempt_merchandise_cents: 3000, shipping_cents: 699, issues: [],
    });
    expect(f.sqlite.prepare("SELECT tax,total_price FROM orders WHERE id = 'old-0'").get()).toEqual({ tax: 0, total_price: 36.99 });
    expect(report.rows.find(r => r.order_number === 'AJ-tax-conflict')?.issues.length).toBeGreaterThan(0);
  });
  it('keeps pending/failed orders out and flags unmatched historical refund totals', async () => {
    legacy('old'); f.sqlite.exec("UPDATE orders SET payment_status='pending'");
    expect((await getTaxReport(f.db, 2026, 3, 'sandbox')).rows).toHaveLength(0);
    f.sqlite.exec("UPDATE orders SET payment_status='partially_refunded',refunded_amount=10");
    const report = await getTaxReport(f.db, 2026, 3, 'sandbox');
    expect(report.refundGaps).toHaveLength(1);
    expect(report.summary.refundCount).toBe(0);
  });
  it('captures known exempt, full taxable, and out-of-state policies without inventing a jurisdiction rule', () => {
    const cart = validateCart([{ productId: 'pickle-gongura-chicken', quantity: 1 }]);
    if (!cart.ok) throw new Error(cart.error);
    const totals = calculateOrderTotals(19, { taxableSubtotal: 19, picklesOnly: true, fulfillmentType: 'delivery', deliveryState: 'TX' });
    expect(buildTaxSnapshot(cart.items, totals, { type: 'delivery', state: 'TX' }, 'sandbox')).toMatchObject({
      taxableShippingCents: 699, taxCents: 214, reviewReason: null,
    });
    expect(buildTaxSnapshot(cart.items, totals, { type: 'delivery', state: 'OK' }, 'sandbox').reviewReason).toContain('Out-of-state');
  });
});

describe('refunds and quarterly accounting', () => {
  it('keeps Q3 sale intact and reports its Q4 full refund exactly once', async () => {
    await sale(); await refund('full', 5813, 5813); await refund('full', 5813, 5813);
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM order_refunds').get()?.n).toBe(1);
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM refund_allocations').get()?.n).toBe(1);
    const q3 = await getTaxReport(f.db, 2026, 3, 'sandbox');
    const q4 = await getTaxReport(f.db, 2026, 4, 'sandbox');
    expect(q3.summary).toMatchObject({ collectedTaxCents: 214, allocatedRefundTaxCents: 0, netRecordedTaxCents: 214 });
    expect(q4.summary).toMatchObject({ collectedTaxCents: 0, allocatedRefundTaxCents: 214, netRecordedTaxCents: -214, refundCents: 5813 });
    expect(q4.refundGaps).toHaveLength(0);
  });
  it('requires explicit partial-refund allocation, retains corrections and enforces remaining balances', async () => {
    await sale(); await refund('part1', 1000, 1000);
    let report = await getTaxReport(f.db, 2026, 4, 'sandbox');
    expect(report.summary).toMatchObject({ allocatedRefundTaxCents: 0, unallocatedRefundCount: 1 });
    const input = { refundId: 'part1', taxableMerchandiseCents: 924, exemptMerchandiseCents: 0,
      shippingCents: 0, taxableShippingCents: 0, taxCents: 76, note: 'Square receipt reference test' };
    expect(await saveRefundAllocation(f.db, input)).toBe(true);
    expect(await saveRefundAllocation(f.db, { ...input, taxableMerchandiseCents: 925, taxCents: 75, note: 'Corrected allocation from receipt' })).toBe(true);
    expect(await saveRefundAllocation(f.db, { ...input, taxCents: 900 })).toBe(false);
    await refund('part2', 4813, 5813);
    expect(await saveRefundAllocation(f.db, { refundId: 'part2', taxableMerchandiseCents: 975,
      exemptMerchandiseCents: 3000, shippingCents: 699, taxableShippingCents: 699, taxCents: 139, note: 'Remaining amount refunded' })).toBe(true);
    expect(await saveRefundAllocation(f.db, { ...input, taxableMerchandiseCents: 924, taxCents: 76 })).toBe(false);
    report = await getTaxReport(f.db, 2026, 4, 'sandbox');
    expect(report.summary).toMatchObject({ unallocatedRefundCount: 0, allocatedRefundTaxCents: 214 });
    expect(report.allocationHistory).toHaveLength(3);
    expect(() => f.sqlite.exec('UPDATE refund_allocations SET tax_cents=0')).toThrow('correction');
  });
  it('ignores pending refunds and does not regress a full refund when a stale partial event arrives', async () => {
    await sale();
    await processRefundEvent(f.db, 'refund.created', { id: 'pending', payment_id: 'pay-test', status: 'PENDING' });
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM order_refunds').get()?.n).toBe(0);
    await refund('part2', 4813, 5813); await refund('part1', 1000, 1000);
    expect(f.sqlite.prepare('SELECT payment_status,refunded_amount FROM orders').get()).toEqual({ payment_status: 'refunded', refunded_amount: 58.13 });
    expect(f.sqlite.prepare('SELECT payment_status FROM payment_sessions').get()?.payment_status).toBe('refunded');
  });
  it('does not mark accounting facts recorded if any refund write fails', async () => {
    await sale(); f.faults.failOnSql = /INSERT INTO order_refunds/; f.faults.failuresRemaining = 1;
    await expect(refund('retry', 1000, 1000)).rejects.toThrow('Injected');
    expect(f.sqlite.prepare('SELECT payment_status FROM orders').get()?.payment_status).toBe('paid');
    await refund('retry', 1000, 1000);
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM order_refunds').get()?.n).toBe(1);
  });
  it('exports signed refunds, unknown fields as blanks and safe spreadsheet text', async () => {
    await sale(); await refund('part1', 1000, 1000);
    const report = await getTaxReport(f.db, 2026, 4, 'sandbox');
    report.rows[0].order_number = '=HYPERLINK("bad")';
    const csv = taxReportCsv(report, 'transactions');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('"-10"');
    expect(csv).toContain('Refund breakdown needs allocation');
    expect(taxReportCsv(report, 'summary')).toContain('not a completed tax return');
    expect(taxReportCsv(await getTaxReport(f.db, 2026, 3, 'sandbox'), 'items')).toContain('Gongura Chicken Pickle');
  });
});
