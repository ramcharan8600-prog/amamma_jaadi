import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createTestD1 } from '@/lib/test-utils/d1';

const { queue } = vi.hoisted(() => ({ queue: { send: vi.fn(async () => undefined) } }));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => ({ env: { EMAIL_QUEUE: queue } }) }));

import { createOrderFromSession, type PaymentSessionRow } from '@/lib/order-service';
import { recoverPendingEmailOutbox } from '@/lib/email-outbox';
import type { Queue } from '@cloudflare/workers-types';
import type { EmailQueueMessage } from '@/lib/email-outbox';

const schema = readFileSync(new URL('./d1-schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./migrations/008-order-finalization.sql', import.meta.url), 'utf8');
const emailQueue = queue as unknown as Queue<EmailQueueMessage>;

function setup(overrides: Partial<PaymentSessionRow> = {}) {
  const database = createTestD1();
  database.sqlite.exec(schema);
  const session: PaymentSessionRow = {
    id: 'session-test', order_id: null, customer_name: 'Test Customer', phone_number: '5551234567',
    email: 'buyer@example.invalid',
    cart_data: [{ productId: 'pickle-chicken', product: { name: '<b>forged name</b>' }, quantity: 2, lineTotal: 36 }],
    fulfillment_data: { type: 'pickup', date: '2026-09-10', locationId: 'plano-biryanify' },
    total_amount: 36, tax: 0, shipping: 0, coupon_code: 'TESTBONUS', ...overrides,
  };
  database.sqlite.prepare(
    `INSERT INTO payment_sessions (id, customer_name, phone_number, email, cart_data, fulfillment_data,
      total_amount, tax, shipping, coupon_code, payment_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing')`
  ).run(session.id, session.customer_name, session.phone_number, session.email,
    JSON.stringify(session.cart_data), JSON.stringify(session.fulfillment_data),
    session.total_amount, session.tax, session.shipping, session.coupon_code);
  database.sqlite.exec("INSERT INTO influencer_coupons (code,influencer_name,bonus_item,bonus_qty) VALUES ('TESTBONUS','Test','Malai Khaja',2)");
  return { ...database, session };
}

function count(sqlite: ReturnType<typeof createTestD1>['sqlite'], table: string) {
  return Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
}

describe('atomic order finalization using real SQLite transactions', () => {
  beforeEach(() => {
    queue.send.mockReset();
    queue.send.mockResolvedValue(undefined);
    vi.stubEnv('ORDER_CONFIRMATION_BCC_EMAIL', 'business@example.invalid');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('commits canonical items, stock, coupon, session link and one email intent together', async () => {
    const { db, sqlite, session } = setup();
    const result = await createOrderFromSession(db, session, 'PAY-TEST');
    expect(result.duplicate).toBe(false);
    for (const table of ['orders', 'order_finalizations', 'email_outbox']) expect(count(sqlite, table)).toBe(1);
    expect(count(sqlite, 'order_items')).toBe(2);
    expect(sqlite.prepare("SELECT product_name FROM order_items WHERE line_total > 0").get()?.product_name).toBe('Chicken Pickle');
    expect(sqlite.prepare("SELECT stock_count FROM inventory WHERE product_id='pickle-chicken'").get()?.stock_count).toBe(18);
    expect(sqlite.prepare('SELECT times_used FROM influencer_coupons').get()?.times_used).toBe(1);
    expect(sqlite.prepare('SELECT order_id, payment_status FROM payment_sessions').get()).toMatchObject({ order_id: result.orderId, payment_status: 'completed' });
    const outbox = sqlite.prepare('SELECT dedupe_key, html, status FROM email_outbox').get();
    expect(outbox).toMatchObject({ dedupe_key: `order-confirmation:${result.orderNumber}`, status: 'pending' });
    expect(outbox?.html).toContain('Chicken Pickle');
    expect(outbox?.html).not.toContain('forged name');
    expect(queue.send).toHaveBeenCalledOnce();
    sqlite.close();
  });

  it.each([
    /INSERT INTO order_items/,
    /UPDATE inventory/,
    /UPDATE payment_sessions SET/,
    /INSERT INTO email_outbox/,
  ])('rolls back every dependent write on %s failure and a replay succeeds once', async (failOnSql) => {
    const { db, sqlite, session, faults } = setup();
    faults.failOnSql = failOnSql;
    faults.failuresRemaining = 1;
    await expect(createOrderFromSession(db, session, 'PAY-TEST')).rejects.toThrow('Injected');
    for (const table of ['orders', 'order_items', 'order_finalizations', 'email_outbox']) expect(count(sqlite, table)).toBe(0);
    expect(sqlite.prepare("SELECT stock_count FROM inventory WHERE product_id='pickle-chicken'").get()?.stock_count).toBe(20);
    expect(sqlite.prepare('SELECT times_used FROM influencer_coupons').get()?.times_used).toBe(0);
    expect(sqlite.prepare('SELECT order_id, payment_status FROM payment_sessions').get()).toMatchObject({ order_id: null, payment_status: 'processing' });
    expect(queue.send).not.toHaveBeenCalled();
    const first = await createOrderFromSession(db, session, 'PAY-TEST');
    const repeat = await createOrderFromSession(db, session, 'PAY-TEST');
    expect(repeat).toEqual({ ...first, duplicate: true });
    expect(count(sqlite, 'orders')).toBe(1);
    expect(count(sqlite, 'email_outbox')).toBe(1);
    expect(sqlite.prepare('SELECT times_used FROM influencer_coupons').get()?.times_used).toBe(1);
    expect(queue.send).toHaveBeenCalledOnce();
    sqlite.close();
  });

  it('resolves racing calls to the winning receipt without duplicate stock/coupon/email effects', async () => {
    const { db, sqlite, session } = setup();
    const results = await Promise.all([
      createOrderFromSession(db, session, 'PAY-TEST'),
      createOrderFromSession(db, session, 'PAY-TEST'),
      createOrderFromSession(db, session, 'PAY-TEST'),
    ]);
    expect(new Set(results.map((r) => r.orderId)).size).toBe(1);
    expect(new Set(results.map((r) => r.orderNumber)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(count(sqlite, 'orders')).toBe(1);
    expect(count(sqlite, 'order_items')).toBe(2);
    expect(count(sqlite, 'email_outbox')).toBe(1);
    expect(sqlite.prepare("SELECT stock_count FROM inventory WHERE product_id='pickle-chicken'").get()?.stock_count).toBe(18);
    expect(sqlite.prepare('SELECT times_used FROM influencer_coupons').get()?.times_used).toBe(1);
    expect(queue.send).toHaveBeenCalledOnce();
    sqlite.close();
  });

  it.each([100, 20, 0])('deducts Bobbatlu pieces once and allows made-to-order at %s stock', async stock => {
    const { db, sqlite, session } = setup({
      cart_data: [
        { productId: 'sweet-bobbatlu', quantity: 2, selectedTier: 16, lineTotal: 96 },
        { productId: 'sweet-bobbatlu', quantity: 1, selectedTier: 25, lineTotal: 75 },
      ], total_amount: 171,
    });
    sqlite.prepare("UPDATE inventory SET stock_count=? WHERE product_id='sweet-bobbatlu'").run(stock);
    await createOrderFromSession(db, session, 'PAY-BOBBATLU');
    await createOrderFromSession(db, session, 'PAY-BOBBATLU');
    expect(sqlite.prepare("SELECT stock_count FROM inventory WHERE product_id='sweet-bobbatlu'").get()?.stock_count)
      .toBe(Math.max(0, stock - 57));
    expect(count(sqlite, 'orders')).toBe(1);
    expect(count(sqlite, 'order_items')).toBe(3); // Includes the existing coupon bonus.
    sqlite.close();
  });

  it.each([100, 20, 0])('deducts Kova Bobbatlu pieces independently once at %s stock', async stock => {
    const { db, sqlite, session } = setup({
      cart_data: [
        { productId: 'sweet-kova-bobbatlu', quantity: 2, selectedTier: 16, lineTotal: 96 },
        { productId: 'sweet-kova-bobbatlu', quantity: 1, selectedTier: 25, lineTotal: 75 },
        { productId: 'sweet-bobbatlu', quantity: 1, selectedTier: 16, lineTotal: 48 },
      ], total_amount: 219,
    });
    sqlite.prepare("UPDATE inventory SET stock_count=? WHERE product_id='sweet-kova-bobbatlu'").run(stock);
    sqlite.prepare("UPDATE inventory SET stock_count=80 WHERE product_id='sweet-bobbatlu'").run();
    await createOrderFromSession(db, session, 'PAY-KOVA-BOBBATLU');
    await createOrderFromSession(db, session, 'PAY-KOVA-BOBBATLU');
    expect(sqlite.prepare("SELECT stock_count FROM inventory WHERE product_id='sweet-kova-bobbatlu'").get()?.stock_count)
      .toBe(Math.max(0, stock - 57));
    expect(sqlite.prepare("SELECT stock_count FROM inventory WHERE product_id='sweet-bobbatlu'").get()?.stock_count).toBe(64);
    expect(sqlite.prepare('SELECT product_name FROM order_items WHERE line_total=96').get()?.product_name)
      .toBe('Kova Bobbatlu');
    expect(sqlite.prepare('SELECT html FROM email_outbox').get()?.html).toContain('Kova Bobbatlu');
    expect(count(sqlite, 'orders')).toBe(1);
    expect(count(sqlite, 'order_items')).toBe(4); // Three purchased lines plus the coupon bonus.
    expect(queue.send).toHaveBeenCalledOnce();
    sqlite.close();
  });

  it('seeds Kova Bobbatlu at zero without copying or resetting either product inventory', () => {
    const { sqlite } = setup();
    const newInventory = readFileSync(new URL('./migrations/015-kova-bobbatlu-inventory.sql', import.meta.url), 'utf8');
    sqlite.prepare("DELETE FROM inventory WHERE product_id='sweet-kova-bobbatlu'").run();
    sqlite.prepare("UPDATE inventory SET stock_count=80 WHERE product_id='sweet-bobbatlu'").run();
    sqlite.exec(newInventory);
    expect(sqlite.prepare("SELECT stock_count FROM inventory WHERE product_id='sweet-kova-bobbatlu'").get()?.stock_count).toBe(0);
    sqlite.prepare("UPDATE inventory SET stock_count=75 WHERE product_id='sweet-kova-bobbatlu'").run();
    sqlite.exec(newInventory);
    expect(sqlite.prepare("SELECT stock_count FROM inventory WHERE product_id='sweet-kova-bobbatlu'").get()?.stock_count).toBe(75);
    expect(sqlite.prepare("SELECT stock_count FROM inventory WHERE product_id='sweet-bobbatlu'").get()?.stock_count).toBe(80);
    sqlite.close();
  });

  it('keeps an email durable when Queue publication fails and cron recovers it', async () => {
    const { db, sqlite, session } = setup();
    queue.send.mockRejectedValueOnce(new Error('Queue unavailable'));
    await expect(createOrderFromSession(db, session, 'PAY-TEST')).resolves.toMatchObject({ duplicate: false });
    expect(sqlite.prepare('SELECT status, last_enqueued_at FROM email_outbox').get()).toMatchObject({ status: 'pending', last_enqueued_at: null });
    expect(await recoverPendingEmailOutbox(db, emailQueue)).toBe(1);
    expect(queue.send).toHaveBeenCalledTimes(2);
    expect(sqlite.prepare('SELECT last_enqueued_at FROM email_outbox').get()?.last_enqueued_at).not.toBeNull();
    sqlite.close();
  });

  it('does not report a payment failure when post-commit email lookup fails', async () => {
    const { db, sqlite, session, faults } = setup();
    faults.failOnSql = /SELECT id, status FROM email_outbox/;
    faults.failuresRemaining = 1;
    await expect(createOrderFromSession(db, session, 'PAY-TEST')).resolves.toMatchObject({ duplicate: false });
    expect(count(sqlite, 'orders')).toBe(1);
    expect(count(sqlite, 'email_outbox')).toBe(1);
    expect(queue.send).not.toHaveBeenCalled();
    expect(await recoverPendingEmailOutbox(db, emailQueue)).toBe(1);
    expect(queue.send).toHaveBeenCalledOnce();
    sqlite.close();
  });

  it('does not publish a losing receipt number when a legacy header appears during finalization', async () => {
    const { db, sqlite, session } = setup();
    const originalBatch = db.batch.bind(db);
    vi.spyOn(db, 'batch').mockImplementationOnce(async (statements) => {
      sqlite.exec(`INSERT INTO orders (id,order_number,customer_name,phone_number,email,order_type,
        total_price,square_payment_id,payment_status)
        VALUES ('legacy-race','AJ-LEGACY-RACE','Test','555','buyer@example.invalid','pickup',36,'PAY-TEST','paid')`);
      return originalBatch(statements);
    });
    await expect(createOrderFromSession(db, session, 'PAY-TEST')).rejects.toThrow('did not resolve');
    expect(count(sqlite, 'orders')).toBe(1);
    expect(count(sqlite, 'order_finalizations')).toBe(0);
    expect(count(sqlite, 'order_items')).toBe(0);
    expect(count(sqlite, 'email_outbox')).toBe(0);
    const recovered = await createOrderFromSession(db, session, 'PAY-TEST');
    expect(recovered).toEqual({ orderNumber: 'AJ-LEGACY-RACE', orderId: 'legacy-race', duplicate: true });
    const email = sqlite.prepare('SELECT dedupe_key,html FROM email_outbox').get();
    expect(email?.dedupe_key).toBe('order-confirmation:AJ-LEGACY-RACE');
    expect(email?.html).toContain('AJ-LEGACY-RACE');
    expect(queue.send).toHaveBeenCalledOnce();
    sqlite.close();
  });

  it('rejects linking a second payment to an already finalized session without partial writes', async () => {
    const { db, sqlite, session } = setup();
    await createOrderFromSession(db, session, 'PAY-FIRST');
    await expect(createOrderFromSession(db, session, 'PAY-SECOND')).rejects.toThrow('linkage is inconsistent');
    expect(count(sqlite, 'orders')).toBe(1);
    expect(count(sqlite, 'order_finalizations')).toBe(1);
    expect(count(sqlite, 'email_outbox')).toBe(1);
    expect(queue.send).toHaveBeenCalledOnce();
    sqlite.close();
  });

  it('survives losing the batch response after commit without losing the email intent', async () => {
    const { db, sqlite, session } = setup();
    const originalBatch = db.batch.bind(db);
    vi.spyOn(db, 'batch').mockImplementationOnce(async (statements) => {
      await originalBatch(statements);
      throw new Error('Connection lost after commit');
    });
    await expect(createOrderFromSession(db, session, 'PAY-TEST')).rejects.toThrow('Connection lost');
    expect(count(sqlite, 'email_outbox')).toBe(1);
    expect((await createOrderFromSession(db, session, 'PAY-TEST')).duplicate).toBe(true);
    expect(await recoverPendingEmailOutbox(db, emailQueue)).toBe(1);
    expect(queue.send).toHaveBeenCalledOnce();
    expect(sqlite.prepare('SELECT times_used FROM influencer_coupons').get()?.times_used).toBe(1);
    sqlite.close();
  });

  it('repairs incomplete legacy receipts preserving refund/shipment data and old side effects', async () => {
    const { db, sqlite, session } = setup();
    sqlite.exec(`INSERT INTO orders (id,order_number,customer_name,phone_number,email,order_type,total_price,
      square_payment_id,payment_status,status,refunded_amount,shipment_status,tracking_id)
      VALUES ('legacy','AJ-LEGACY','Test','555','buyer@example.invalid','delivery',36,'PAY-TEST',
      'partially_refunded','confirmed',5,'shipped','EXISTING-TRACKING');
      UPDATE inventory SET stock_count=18 WHERE product_id='pickle-chicken';
      UPDATE influencer_coupons SET times_used=1;
      UPDATE payment_sessions SET payment_status='partially_refunded';`);
    const result = await createOrderFromSession(db, session, 'PAY-TEST');
    expect(result).toEqual({ orderId: 'legacy', orderNumber: 'AJ-LEGACY', duplicate: true });
    expect(count(sqlite, 'order_items')).toBe(2);
    expect(count(sqlite, 'email_outbox')).toBe(1);
    expect(sqlite.prepare('SELECT payment_status,refunded_amount,shipment_status,tracking_id FROM orders').get()).toMatchObject({ payment_status: 'partially_refunded', refunded_amount: 5, shipment_status: 'shipped', tracking_id: 'EXISTING-TRACKING' });
    expect(sqlite.prepare('SELECT payment_status,order_id FROM payment_sessions').get()).toMatchObject({ payment_status: 'partially_refunded', order_id: 'legacy' });
    expect(sqlite.prepare("SELECT stock_count FROM inventory WHERE product_id='pickle-chicken'").get()?.stock_count).toBe(18);
    expect(sqlite.prepare('SELECT times_used FROM influencer_coupons').get()?.times_used).toBe(1);
    expect(sqlite.prepare('SELECT legacy_repair FROM order_finalizations').get()?.legacy_repair).toBe(1);
    await createOrderFromSession(db, session, 'PAY-TEST');
    expect(queue.send).toHaveBeenCalledOnce();
    sqlite.close();
  });

  it('rejects malformed paid legacy cart without committing any receipt or email', async () => {
    const { db, sqlite, session } = setup({ cart_data: [{ productId: 'pickle-chicken', quantity: 200, lineTotal: 1 }] });
    await expect(createOrderFromSession(db, session, 'PAY-TEST')).rejects.toThrow('does not match charged total');
    expect(count(sqlite, 'orders')).toBe(0);
    expect(count(sqlite, 'email_outbox')).toBe(0);
    expect(queue.send).not.toHaveBeenCalled();
    sqlite.close();
  });

  it('preserves a paid historical price while resolving canonical names', async () => {
    const { db, sqlite, session } = setup({ total_amount: 25, cart_data: [{ productId: 'pickle-chicken', quantity: 2, lineTotal: 25 }] });
    await createOrderFromSession(db, session, 'PAY-TEST');
    expect(sqlite.prepare('SELECT total_price FROM orders').get()?.total_price).toBe(25);
    expect(sqlite.prepare('SELECT line_total FROM order_items WHERE line_total > 0').get()?.line_total).toBe(25);
    sqlite.close();
  });

  it('baselines complete pre-outbox receipts without sending historical customer email', async () => {
    const { db, sqlite, session } = setup({
      cart_data: [{ productId: 'pickle-chicken', quantity: 2, lineTotal: 28 }],
      total_amount: 28,
    });
    sqlite.exec(`INSERT INTO orders (id,order_number,customer_name,phone_number,email,order_type,total_price,
      square_payment_id,payment_status,created_at)
      VALUES ('legacy','AJ-LEGACY','Test','555','buyer@example.invalid','pickup',28,'PAY-TEST','paid','2026-01-01 00:00:00');
      INSERT INTO order_items (id,order_id,product_name,quantity,product_price,line_total)
      VALUES ('item-legacy','legacy','Chicken Pickle',2,14,28);
      UPDATE payment_sessions SET payment_status='completed',order_id='legacy',square_payment_id='PAY-TEST';`);
    sqlite.exec(migration);
    sqlite.exec(migration);
    expect(count(sqlite, 'order_finalizations')).toBe(1);
    expect((await createOrderFromSession(db, session, 'PAY-TEST')).duplicate).toBe(true);
    expect(count(sqlite, 'email_outbox')).toBe(0);
    expect(queue.send).not.toHaveBeenCalled();
    sqlite.close();
  });
});


it('preserves mixed Texas tax in the order record and confirmation', async () => {
  const { db, sqlite, session } = setup({
    cart_data: [
      {productId: 'gift-box-sweet-memories', quantity: 1, selectedVariant: '12 pcs Guntur Malpuri', lineTotal: 30},
      {productId: 'pickle-gongura-chicken', quantity: 1, lineTotal: 19},
    ],
    fulfillment_data: {type: 'delivery', addressLine1: '123 Test Street', city: 'Plano', state: 'TX', zip: '75093', country: 'USA'},
    total_amount: 58.13, tax: 2.14, shipping: 6.99, coupon_code: null,
  });
  try {
    await createOrderFromSession(db, session, 'PAY-MIXED-TAX-TEST');
    expect(sqlite.prepare('SELECT tax, total_price FROM orders').get()).toMatchObject({tax: 2.14, total_price: 58.13});
    const outbox = sqlite.prepare('SELECT html FROM email_outbox').get();
    expect(outbox?.html).toContain('Sales Tax (8.25%)');
    expect(outbox?.html).toContain('$2.14');
  } finally {
    sqlite.close();
  }
});

it.each([null, 'TESTBONUS'])('records Standard shipping in a pickle-only confirmation with coupon %s', async coupon => {
  const { db, sqlite, session } = setup({
    cart_data: [{ productId: 'pickle-chicken', quantity: 1, lineTotal: 18 }],
    fulfillment_data: { type: 'delivery', addressLine1: '123 Test Street', city: 'New York', state: 'NY', zip: '10001', country: 'USA', shippingMethod: 'standard' },
    total_amount: 26.48, tax: 1.49, shipping: 6.99, coupon_code: coupon,
  });
  try {
    await createOrderFromSession(db, session, 'PAY-PICKLE-SHIPPING-LABEL');
    expect(sqlite.prepare('SELECT shipping_method, total_price FROM orders').get())
      .toMatchObject({ shipping_method: 'standard', total_price: 26.48 });
    const outbox = sqlite.prepare('SELECT html FROM email_outbox').get();
    expect(outbox?.html).toContain('Chicken Pickle');
    expect(outbox?.html).toContain('Standard shipping');
    expect(outbox?.html).not.toContain('UPS 2nd Day Air');
    expect(outbox?.html).toContain('$6.99');
    expect(outbox?.html).toContain('$26.48');
    if (coupon) expect(outbox?.html).toContain('complimentary Malai Khaja');
  } finally {
    sqlite.close();
  }
});
