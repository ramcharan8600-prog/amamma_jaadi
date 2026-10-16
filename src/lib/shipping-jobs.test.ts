import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestD1 } from '@/lib/test-utils/d1';

const shippo = vi.hoisted(() => ({ getTrackingStatus: vi.fn(), voidLabel: vi.fn() }));
vi.mock('@/lib/shippo', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/shippo')>(), ...shippo }));
vi.mock('@/lib/email-outbox', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/email-outbox')>(),
  publishPersistedEmail: vi.fn(async () => true),
}));
import { dallasClock, runShippingJobs, sendTrackingEmails, sendWaitingList, voidLabelsOfRefundedOrders } from './shipping-jobs';
import { updateShipmentDetails, updateShipmentDetailsBatch } from './shipment';

let fixture: ReturnType<typeof createTestD1>;
const env = (over = {}) => ({ apiKey: 'key', shopEmail: 'shop@example.com', trackingEmails: true, ...over });

function order(id: string, fields: Record<string, unknown> = {}, items: Array<[string, number, number | null]> = [['Guntur Malpuri', 1, 16]]) {
  const row = {
    order_number: `AJ-${id}`, customer_name: `Buyer ${id}`, phone_number: '555', email: `${id}@example.com`, order_type: 'delivery',
    delivery_address: '1 Main St\nDallas, TX 75201\nUSA', total_price: 46.99, tax: 0, payment_status: 'paid', status: 'confirmed', ...fields,
  };
  fixture.sqlite.prepare(`INSERT INTO orders (id, ${Object.keys(row).join(', ')}) VALUES (?, ${Object.keys(row).map(() => '?').join(', ')})`)
    .run(id, ...Object.values(row));
  items.forEach(([name, q, t], i) => fixture.sqlite.prepare(
    'INSERT INTO order_items (id, order_id, product_name, quantity, product_price, selected_tier, line_total) VALUES (?,?,?,?,0,?,0)',
  ).run(`${id}-${i}`, id, name, q, t));
}
function label(id: string, orderId: string, tracking: string, fields: Record<string, unknown> = {}) {
  const row = { order_id: orderId, status: 'purchased', shippo_transaction_id: `tx-${id}`, service_name: 'UPS Ground', amount: 8, tracking_number: tracking, ...fields };
  fixture.sqlite.prepare(`INSERT INTO shipping_labels (id, ${Object.keys(row).join(', ')}) VALUES (?, ${Object.keys(row).map(() => '?').join(', ')})`)
    .run(id, ...Object.values(row));
}
const emails = () => fixture.sqlite.prepare('SELECT to_json, subject, dedupe_key FROM email_outbox ORDER BY rowid').all() as Array<Record<string, string>>;
const outbox = () => fixture.sqlite.prepare('SELECT cc_json, html FROM email_outbox ORDER BY rowid').all() as Array<{ cc_json: string | null; html: string }>;
const col = (id: string, c: string) => (fixture.sqlite.prepare(`SELECT ${c} AS v FROM orders WHERE id = ?`).get(id) as { v: unknown }).v;

beforeEach(() => {
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('./d1-schema.sql', import.meta.url), 'utf8'));
  shippo.getTrackingStatus.mockReset().mockResolvedValue('PRE_TRANSIT');
  shippo.voidLabel.mockReset().mockResolvedValue({ status: 'QUEUED' });
});
afterEach(() => fixture.sqlite.close());

it('emails a Shippo-label customer only after UPS scans the box, once, and marks it shipped', async () => {
  order('s', { tracking_id: '1ZSCAN' });
  label('l1', 's', '1ZSCAN');
  expect(await sendTrackingEmails(fixture.db, env())).toEqual({ emailed: 0, waiting: 1 });
  expect(emails()).toEqual([]);

  shippo.getTrackingStatus.mockResolvedValue('TRANSIT');
  expect(await sendTrackingEmails(fixture.db, env())).toEqual({ emailed: 1, waiting: 0 });
  expect(shippo.getTrackingStatus).toHaveBeenCalledWith('key', 'ups', '1ZSCAN');
  expect(emails()).toEqual([{ to_json: '["s@example.com"]', subject: 'Amamma Jaadi: AJ-s Your Order is on its way', dedupe_key: 'tracking:s:1ZSCAN' }]);
  expect(outbox()[0].cc_json).toBeNull();
  expect(outbox()[0].html).toContain('In transit');
  expect(col('s', 'shipment_status')).toBe('shipped');
  expect(fixture.sqlite.prepare('SELECT scanned_at FROM shipping_labels').get()).not.toEqual({ scanned_at: null });

  // Never twice.
  expect(await sendTrackingEmails(fixture.db, env())).toEqual({ emailed: 0, waiting: 0 });
  expect(emails()).toHaveLength(1);
});

it('copies the shop on tracking emails when asked (production) and says Delivered once UPS has delivered', async () => {
  order('d', { tracking_id: '1ZDELIVERED' });
  label('l2', 'd', '1ZDELIVERED');
  shippo.getTrackingStatus.mockResolvedValue('DELIVERED');
  expect(await sendTrackingEmails(fixture.db, env({ trackingCc: ['amamma.jaadi@gmail.com'] }))).toEqual({ emailed: 1, waiting: 0 });
  expect(outbox()[0].cc_json).toBe('["amamma.jaadi@gmail.com"]');
  expect(outbox()[0].html).toContain('>Delivered<');
  expect(outbox()[0].html).not.toContain('In transit');
  expect(col('d', 'shipment_status')).toBe('delivered');
});

it('emails hand-shipped (Pirate Ship) orders with the saved tracking number straight away', async () => {
  order('p', { tracking_id: '9400PIRATE' });
  expect(await sendTrackingEmails(fixture.db, env())).toEqual({ emailed: 1, waiting: 0 });
  expect(shippo.getTrackingStatus).not.toHaveBeenCalled();
  expect(emails()[0].dedupe_key).toBe('tracking:p:9400PIRATE');
});

it('queues a tracking number the owner saves by hand, and again only when the number changes', async () => {
  order('m');
  const save = (trackingId: string | null) => updateShipmentDetails(fixture.db, { orderId: 'm', shipmentStatus: 'shipped', trackingId });
  await save('1ZFIRST');
  expect(await sendTrackingEmails(fixture.db, env())).toEqual({ emailed: 1, waiting: 0 });

  // Saving the same number, or clearing it, sends nothing new.
  await save('1ZFIRST');
  await save(null);
  expect(await sendTrackingEmails(fixture.db, env())).toEqual({ emailed: 0, waiting: 0 });

  // A corrected number goes into the next batch (also from the save-all sheet).
  await updateShipmentDetailsBatch(fixture.db, [{ orderId: 'm', shipmentStatus: 'shipped', trackingId: '1ZFIXED' }]);
  expect(col('m', 'tracking_emailed_at')).toBeNull();
  expect(await sendTrackingEmails(fixture.db, env())).toEqual({ emailed: 1, waiting: 0 });
  expect(emails().map((e) => e.dedupe_key)).toEqual(['tracking:m:1ZFIRST', 'tracking:m:1ZFIXED']);

  // Orders handled by hand before Shippo get an email only for a new number.
  order('old', { tracking_id: 'X9', tracking_emailed_at: 'before-shippo' });
  await updateShipmentDetails(fixture.db, { orderId: 'old', shipmentStatus: 'shipped', trackingId: 'X9' });
  expect(col('old', 'tracking_emailed_at')).toBe('before-shippo');
});

it('skips refunded orders, orders handled before this release, and sends nothing while emails are off', async () => {
  order('refunded', { tracking_id: 'X1', payment_status: 'refunded' });
  order('old', { tracking_id: 'X2', tracking_emailed_at: 'before-shippo' });
  order('off', { tracking_id: 'X3' });
  expect(await sendTrackingEmails(fixture.db, env({ trackingEmails: false }))).toEqual({ emailed: 0, waiting: 0 });
  expect(emails()).toEqual([]);
  // Marked done so turning emails on later never mails old orders.
  expect(col('off', 'tracking_emailed_at')).toBe('emails-off');
  expect(col('refunded', 'tracking_emailed_at')).toBeNull();
});

it('sends the shop a nightly waiting list (Shippo vs Pirate Ship), and an all-clear when nothing waits', async () => {
  order('w1', { created_at: '2026-10-09 15:00:00' });
  order('w2', { delivery_address: '9 Way\nNew York, NY 10001\nUSA', created_at: '2026-10-09 16:00:00' });
  order('labelled');
  label('l', 'labelled', '1ZL');
  order('typed', { tracking_id: '9400' });
  order('pickup', { order_type: 'pickup', delivery_address: null });
  expect(await sendWaitingList(fixture.db, env(), new Date('2026-10-10T03:05:00Z'))).toBe(2);
  const [mail] = emails();
  expect(mail).toMatchObject({ to_json: '["shop@example.com"]', subject: '2 delivery orders waiting · 2026-10-09', dedupe_key: 'shipping-waiting:2026-10-09' });
  const html = fixture.sqlite.prepare('SELECT html FROM email_outbox').get() as { html: string };
  expect(html.html).toContain('AJ-w1');
  expect(html.html).toContain('Shippo');
  expect(html.html).toContain('New York, NY');
  expect(html.html).toContain('Pirate Ship');

  fixture.sqlite.exec("UPDATE orders SET shipment_status = 'shipped' WHERE id IN ('w1', 'w2')");
  expect(await sendWaitingList(fixture.db, env(), new Date('2026-10-11T03:05:00Z'))).toBe(0);
  expect(emails().at(-1)?.subject).toBe('All orders have labels · 2026-10-10');
});

it('voids unused labels of refunded or cancelled orders and clears their tracking number', async () => {
  order('r', { payment_status: 'refunded', tracking_id: '1ZR' });
  label('lr', 'r', '1ZR');
  order('c', { status: 'cancelled', tracking_id: '1ZC' });
  label('lc', 'c', '1ZC', { scanned_at: '2026-10-09' }); // already with UPS: leave it
  order('ok', { tracking_id: '1ZOK' });
  label('lok', 'ok', '1ZOK');
  expect(await voidLabelsOfRefundedOrders(fixture.db, env())).toBe(1);
  expect(shippo.voidLabel).toHaveBeenCalledExactlyOnceWith('key', 'tx-lr');
  expect(col('r', 'tracking_id')).toBeNull();
  expect(fixture.sqlite.prepare("SELECT status FROM shipping_labels WHERE id = 'lr'").get()).toEqual({ status: 'voided' });
});

it('runs tracking emails at 6:30 PM and the waiting list at 10 PM Dallas time only, and nothing without a key', async () => {
  expect(dallasClock(new Date('2026-10-10T23:30:00Z'))).toEqual({ hour: 18, minute: 30 });
  order('p', { tracking_id: '9400' });
  expect(await runShippingJobs(fixture.db, env(), new Date('2026-10-10T20:00:00Z'))).toEqual({ voided: 0 });
  expect(await runShippingJobs(fixture.db, env(), new Date('2026-10-10T23:30:00Z'))).toMatchObject({ tracking: { emailed: 1 } });
  expect(await runShippingJobs(fixture.db, env(), new Date('2026-10-11T03:00:00Z'))).toMatchObject({ waiting: 0 });
});

it('keeps checking for the UPS scan all evening and the next morning, so the email is not a day late', async () => {
  order('late', { tracking_id: '1ZLATE' });
  label('ll', 'late', '1ZLATE');
  // 6:30 PM: the box is not scanned yet.
  expect(await runShippingJobs(fixture.db, env(), new Date('2026-10-12T23:30:00Z'))).toMatchObject({ tracking: { emailed: 0, waiting: 1 } });
  // 9:15 PM: UPS has it now; the customer is emailed that evening.
  shippo.getTrackingStatus.mockResolvedValue('TRANSIT');
  expect(await runShippingJobs(fixture.db, env(), new Date('2026-10-13T02:15:00Z'))).toMatchObject({ tracking: { emailed: 1 } });
  expect(emails().map((e) => e.dedupe_key)).toEqual(['tracking:late:1ZLATE']);
});

it('in the morning emails only scan-checked Shippo labels; a number typed in by hand waits for the evening', async () => {
  order('morning', { tracking_id: '1ZMORN' });
  label('lm', 'morning', '1ZMORN');
  order('typed', { tracking_id: '9400TYPED' });
  shippo.getTrackingStatus.mockResolvedValue('TRANSIT');
  // 8:00 AM Dallas.
  expect(await runShippingJobs(fixture.db, env(), new Date('2026-10-13T13:00:00Z'))).toMatchObject({ tracking: { emailed: 1, waiting: 0 } });
  expect(emails().map((e) => e.dedupe_key)).toEqual(['tracking:morning:1ZMORN']);
  expect(col('typed', 'tracking_emailed_at')).toBeNull();
  // 6:30 PM: the hand-typed number goes out.
  expect(await runShippingJobs(fixture.db, env(), new Date('2026-10-13T23:30:00Z'))).toMatchObject({ tracking: { emailed: 1 } });
  expect(emails().map((e) => e.dedupe_key)).toEqual(['tracking:morning:1ZMORN', 'tracking:typed:9400TYPED']);
});

it('without a Shippo key still emails hand-shipped orders and sends the waiting list, but leaves Shippo labels and voids alone', async () => {
  order('pirate', { tracking_id: '9400' });
  order('shippo', { tracking_id: '1ZS' });
  label('ls', 'shippo', '1ZS');
  order('refunded', { payment_status: 'refunded', tracking_id: '1ZR' });
  label('lr', 'refunded', '1ZR');
  const noKey = env({ apiKey: '' });
  expect(await runShippingJobs(fixture.db, noKey, new Date('2026-10-10T23:30:00Z'))).toEqual({ voided: 0, tracking: { emailed: 1, waiting: 1 } });
  expect(shippo.getTrackingStatus).not.toHaveBeenCalled();
  expect(shippo.voidLabel).not.toHaveBeenCalled();
  expect(await runShippingJobs(fixture.db, noKey, new Date('2026-10-11T03:00:00Z'))).toMatchObject({ waiting: 0 });
  expect(emails().map((e) => e.dedupe_key)).toEqual(['tracking:pirate:9400', 'shipping-waiting:2026-10-10']);
});
