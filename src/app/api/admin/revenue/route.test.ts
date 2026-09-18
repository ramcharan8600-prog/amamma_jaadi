import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createTestD1 } from '@/lib/test-utils/d1';
import type { PickleStateSalesRow } from '@/lib/pickle-state-sales';

const mocks = vi.hoisted(() => ({ token: 'valid', configured: true, db: null as D1Database | null }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => mocks.token ? { value: mocks.token } : undefined }) }));
vi.mock('@/lib/session', () => ({ SESSION_COOKIE: 'session', verifySessionToken: (token: string) => token === 'valid' }));
vi.mock('@/lib/db', () => ({ getDb: () => mocks.db, isDbConfigured: () => mocks.configured }));
import { GET } from './route';

let fixture: ReturnType<typeof createTestD1>;
const url = 'https://shop.test/api/admin/revenue';
type RevenueResponse = {
  year: number;
  weeklyRevenue: { label: string; value: number }[];
  monthlyRevenue: { label: string; value: number }[];
  pickleSalesByState: PickleStateSalesRow[];
};
const total = (bars: { value: number }[]) => Math.round(bars.reduce((sum, bar) => sum + bar.value, 0) * 100) / 100;

beforeEach(() => {
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('../../../../lib/d1-schema.sql', import.meta.url), 'utf8'));
  mocks.db = fixture.db;
  mocks.token = 'valid';
  mocks.configured = true;
});
afterEach(() => { fixture.sqlite.close(); vi.restoreAllMocks(); });

function addOrder(id: string, createdAt: string, amount = 10, status = 'paid', refunded = 0) {
  fixture.sqlite.prepare(`INSERT INTO orders
    (id, order_number, customer_name, phone_number, order_type, total_price, payment_status, refunded_amount, created_at)
    VALUES (?, ?, 'Fixture customer', '555', 'pickup', ?, ?, ?, ?)`)
    .run(id, `AJ-${id}`, amount, status, refunded, createdAt);
}

function addItem(orderId: string, productName = 'Chicken Pickle', quantity = 1, selectedTier: number | null = null) {
  fixture.sqlite.prepare(`INSERT INTO order_items
    (id, order_id, product_name, quantity, product_price, selected_tier, line_total)
    VALUES (?, ?, ?, ?, 18, ?, ?)`)
    .run(`${orderId}-${productName}`, orderId, productName, quantity, selectedTier, 18 * quantity);
}

function setDelivery(orderId: string, address: string | null) {
  fixture.sqlite.prepare("UPDATE orders SET order_type = 'delivery', delivery_address = ? WHERE id = ?")
    .run(address, orderId);
}

function addSession(orderId: string, sessionId: string, fulfillment: string, finalized = true, createdAt = '2026-09-01 12:00:00') {
  fixture.sqlite.prepare(`INSERT INTO payment_sessions
    (id, order_id, customer_name, phone_number, cart_data, fulfillment_data, total_amount, payment_status, created_at)
    VALUES (?, ?, 'Fixture customer', '555', '[]', ?, 18, 'paid', ?)`)
    .run(sessionId, orderId, fulfillment, createdAt);
  if (finalized) fixture.sqlite.prepare(`INSERT INTO order_finalizations (order_id, payment_session_id, attempt_id)
    VALUES (?, ?, ?)`)
    .run(orderId, sessionId, `attempt-${sessionId}`);
}

function addTaxDestination(orderId: string, state: string) {
  fixture.sqlite.prepare(`INSERT INTO order_tax_records
    (order_id, paid_at, date_source, environment, destination_state,
      merchandise_cents, taxable_merchandise_cents, exempt_merchandise_cents,
      shipping_cents, taxable_shipping_cents, tax_cents, total_cents, rate_basis_points,
      shipping_tax_rule, policy_version, snapshot_json)
    VALUES (?, '2026-09-01 12:00:00', 'fixture', 'sandbox', ?, 1800, 0, 1800,
      0, 0, 0, 1800, 0, 'fixture', 'fixture', '{}')`).run(orderId, state);
}

describe('annual revenue API', () => {
  it.each(['', 'invalid'])('requires a valid admin session (%s)', async token => {
    mocks.token = token;
    const response = await GET(new Request(`${url}?year=2026`));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it.each(['', '?year=2025', '?year=2032', '?year=2026.5', '?year=NaN', '?year=2026.0', '?year=2.026e3'])
    ('rejects invalid years %s', async query => {
      const response = await GET(new Request(url + query));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Choose a year from 2026 to 2031.' });
    });

  it.each([2026, 2027, 2028, 2029, 2030, 2031])('returns uncached, empty calendar periods for %i', async year => {
    const response = await GET(new Request(`${url}?year=${year}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const report: RevenueResponse = await response.json();
    expect(report.year).toBe(year);
    expect(report.monthlyRevenue).toHaveLength(year === 2026 ? 6 : 12);
    expect(total(report.weeklyRevenue)).toBe(0);
    expect(total(report.monthlyRevenue)).toBe(0);
    expect(report.pickleSalesByState).toEqual([]);
    expect(Object.keys(report).sort()).toEqual(['monthlyRevenue', 'pickleSalesByState', 'weeklyRevenue', 'year']);
  });

  it('includes every qualifying order beyond the order-list cap and returns only aggregates', async () => {
    for (let index = 0; index < 251; index += 1) {
      addOrder(`paid-${index}`, '2026-07-15 12:00:00', 1.01);
      addItem(`paid-${index}`, 'Chicken Pickle', 2);
    }
    addOrder('partial', '2026-08-15 12:00:00', 100, 'partially_refunded', 25.25);
    addItem('partial', 'Mutton Pickle', 3);
    addOrder('refunded', '2026-08-15 12:00:00', 200, 'refunded', 200);
    addOrder('pending', '2026-08-15 12:00:00', 300, 'pending');
    addOrder('failed', '2026-08-15 12:00:00', 400, 'failed');
    addOrder('test', '2026-08-15 12:00:00', 500);
    fixture.sqlite.prepare(`INSERT INTO order_reporting_exclusions (order_id, reason, recorded_by)
      VALUES ('test', 'Owner-confirmed test', 'owner')`).run();
    const response = await GET(new Request(`${url}?year=2026`));
    expect(response.status).toBe(200);
    const report: RevenueResponse = await response.json();
    expect(total(report.weeklyRevenue)).toBe(328.26);
    expect(total(report.monthlyRevenue)).toBe(328.26);
    expect(report.monthlyRevenue[0].value).toBe(253.51);
    expect(report.monthlyRevenue[1].value).toBe(74.75);
    expect(report.pickleSalesByState).toHaveLength(1);
    expect(report.pickleSalesByState[0]).toMatchObject({ stateCode: 'TX', stateName: 'Texas', jars: 505 });
    expect(JSON.stringify(report)).not.toContain('Fixture customer');
    expect(JSON.stringify(report)).not.toContain('paid-');
  });

  it('uses Central midnight at the July launch and year boundaries for D1 and ISO timestamps', async () => {
    addOrder('before-launch', '2026-07-01 04:59:59', 1000);
    addOrder('launch', '2026-07-01T05:00:00Z', 1);
    addOrder('last-2026', '2027-01-01 05:59:59', 2);
    addOrder('first-2027', '2027-01-01T06:00:00Z', 4);
    addOrder('last-2027', '2028-01-01T05:59:59Z', 8);
    addOrder('first-2028', '2028-01-01 06:00:00', 16);
    for (const id of ['before-launch', 'launch', 'last-2026', 'first-2027', 'last-2027', 'first-2028']) {
      addItem(id);
      setDelivery(id, JSON.stringify({ state: 'MI' }));
    }
    const report2026: RevenueResponse = await (await GET(new Request(`${url}?year=2026`))).json();
    const report2027: RevenueResponse = await (await GET(new Request(`${url}?year=2027`))).json();
    expect(total(report2026.weeklyRevenue)).toBe(3);
    expect(total(report2026.monthlyRevenue)).toBe(3);
    expect(report2026.monthlyRevenue[0].value).toBe(1);
    expect(report2026.monthlyRevenue.at(-1)?.value).toBe(2);
    expect(total(report2027.weeklyRevenue)).toBe(12);
    expect(total(report2027.monthlyRevenue)).toBe(12);
    expect(report2027.monthlyRevenue[0].value).toBe(4);
    expect(report2027.monthlyRevenue.at(-1)?.value).toBe(8);
    expect(report2026.pickleSalesByState[0]).toMatchObject({ stateCode: 'MI', jars: 2 });
    expect(report2027.pickleSalesByState[0]).toMatchObject({ stateCode: 'MI', jars: 2 });
  });

  it('groups state codes and names, uses Texas for pickup, and counts each pickle product in jars', async () => {
    const fixtures = [
      { id: 'pickup', state: 'MI', product: 'Chicken Pickle', jars: 2 },
      { id: 'tx-code', state: ' tx ', product: 'Chicken Pickle', jars: 1 },
      { id: 'tx-name', state: 'tExAs', product: 'Mutton Pickle', jars: 3 },
      { id: 'mi-code', state: 'mi', product: ' gongura chicken pickle ', jars: 4 },
      { id: 'mi-name', state: 'Michigan', product: 'Prawns Pickle', jars: 1 },
      { id: 'ny-sweet', state: 'NY', product: 'Bobbatlu', jars: 16 },
      { id: 'ny-unknown', state: 'NY', product: 'Not a pickle product', jars: 5 },
      { id: 'dc', state: ' district  of columbia ', product: 'Prawns Pickle', jars: 2 },
      { id: 'ak', state: 'Alaska', product: 'Chicken Pickle', jars: 1 },
      { id: 'hi', state: 'HI', product: 'Chicken Pickle', jars: 1 },
    ];
    for (const { id, state, product, jars } of fixtures) {
      addOrder(id, '2026-09-01 12:00:00');
      addItem(id, product, jars, 50);
      setDelivery(id, JSON.stringify({ state, street: 'Never include this street in analytics' }));
    }
    fixture.sqlite.prepare("UPDATE orders SET order_type = 'pickup' WHERE id = 'pickup'").run();
    const report: RevenueResponse = await (await GET(new Request(`${url}?year=2026`))).json();
    expect(report.pickleSalesByState.map(({ stateCode, jars }) => ({ stateCode, jars }))).toEqual([
      { stateCode: 'TX', jars: 6 }, { stateCode: 'MI', jars: 5 }, { stateCode: 'DC', jars: 2 },
      { stateCode: 'AK', jars: 1 }, { stateCode: 'HI', jars: 1 },
    ]);
    expect(report.pickleSalesByState[0].products).toEqual([
      { productId: 'pickle-chicken', productName: 'Chicken Pickle', jars: 3 },
      { productId: 'pickle-gongura-chicken', productName: 'Gongura Chicken Pickle', jars: 0 },
      { productId: 'pickle-mutton', productName: 'Mutton Pickle', jars: 3 },
      { productId: 'pickle-prawns', productName: 'Prawns Pickle', jars: 0 },
    ]);
    expect(report.pickleSalesByState[1].products.find(({ productId }) => productId === 'pickle-gongura-chicken')?.jars).toBe(4);
    expect(JSON.stringify(report)).not.toContain('Never include this street');
    expect(JSON.stringify(report)).not.toContain('Fixture customer');
  });

  it('counts gross paid jar quantities without refund deductions and excludes unpaid, cancelled and test orders', async () => {
    for (const [id, paymentStatus, jars] of [
      ['paid', 'paid', 3], ['partial', 'partially_refunded', 4], ['refunded', 'refunded', 50],
      ['pending', 'pending', 60], ['failed', 'failed', 70], ['cancelled', 'paid', 80],
      ['canceled', 'paid', 90], ['test', 'paid', 100],
    ] as const) {
      addOrder(id, '2026-09-15 12:00:00', 100, paymentStatus, paymentStatus === 'partially_refunded' ? 99 : 0);
      addItem(id, 'Chicken Pickle', jars);
    }
    fixture.sqlite.prepare("UPDATE orders SET status = 'Cancelled' WHERE id = 'cancelled'").run();
    fixture.sqlite.prepare("UPDATE orders SET status = ' canceled ' WHERE id = 'canceled'").run();
    fixture.sqlite.prepare("INSERT INTO order_reporting_exclusions (order_id, reason, recorded_by) VALUES ('test', 'Test', 'owner')").run();
    const report: RevenueResponse = await (await GET(new Request(`${url}?year=2026`))).json();
    expect(report.pickleSalesByState).toHaveLength(1);
    expect(report.pickleSalesByState[0]).toMatchObject({ stateCode: 'TX', jars: 7 });
    // Existing revenue treatment is unchanged by the state chart's cancellation filter.
    expect(total(report.monthlyRevenue)).toBe(301);
  });

  it('reads the saved checkout state for real multiline delivery addresses, prioritizing the finalized session', async () => {
    for (const [id, state, jars] of [['checkout-tx', 'TX', 11], ['checkout-ny', 'NY', 1], ['pickup', 'NY', 2]] as const) {
      addOrder(id, '2026-09-01 12:00:00');
      addItem(id, 'Gongura Chicken Pickle', jars);
      // Matches order-service.ts buildDeliveryAddress, which persists display text, not JSON.
      setDelivery(id, `123 Fixture Street\nSuite 2\nFixture City, ${state} 12345\nUSA`);
      addSession(id, `session-${id}`, JSON.stringify({ type: 'delivery', addressLine1: '123 Fixture Street', city: 'Fixture City', state, zip: '12345', country: 'USA' }));
    }
    fixture.sqlite.prepare("UPDATE orders SET order_type = 'pickup' WHERE id = 'pickup'").run();
    addTaxDestination('checkout-tx', 'MI');
    addSession('checkout-tx', 'later-unrelated-session', '{"state":"CA"}', false, '2026-09-02 12:00:00');
    const report: RevenueResponse = await (await GET(new Request(`${url}?year=2026`))).json();
    expect(report.pickleSalesByState.map(({ stateCode, jars }) => ({ stateCode, jars }))).toEqual([
      { stateCode: 'TX', jars: 13 }, { stateCode: 'NY', jars: 1 },
    ]);
    expect(JSON.stringify(report)).not.toContain('Fixture Street');
    expect(JSON.stringify(report)).not.toContain('session-');
  });

  it('falls back from missing or malformed checkout state to recorded tax and historical structured addresses', async () => {
    for (const id of ['tax', 'invalid-state', 'normalized', 'historical-json']) {
      addOrder(id, '2026-09-01 12:00:00');
      addItem(id);
      setDelivery(id, '123 Fixture Street\nFixture City, TX 75093\nUSA');
    }
    addSession('tax', 'malformed-session', '{broken json');
    addTaxDestination('tax', 'Michigan');
    addSession('invalid-state', 'invalid-state-session', '{"state":{"code":"TX"}}');
    addTaxDestination('invalid-state', 'tx');
    addSession('normalized', 'blank-state-session', '{"state":""}');
    fixture.sqlite.prepare("UPDATE orders SET delivery_address_normalized = ? WHERE id = 'normalized'").run('{"state":"ca"}');
    addSession('historical-json', 'missing-state-session', '{}');
    fixture.sqlite.prepare("UPDATE orders SET delivery_address_normalized = '{invalid' WHERE id = 'historical-json'").run();
    setDelivery('historical-json', '{"state":"NY"}');
    const report: RevenueResponse = await (await GET(new Request(`${url}?year=2026`))).json();
    expect(report.pickleSalesByState.map(({ stateCode, jars }) => ({ stateCode, jars }))).toEqual([
      { stateCode: 'CA', jars: 1 }, { stateCode: 'MI', jars: 1 }, { stateCode: 'NY', jars: 1 }, { stateCode: 'TX', jars: 1 },
    ]);
  });

  it('uses one deterministic legacy paid session when finalization is absent without multiplying jars', async () => {
    addOrder('legacy', '2026-09-01 12:00:00');
    addItem('legacy', 'Chicken Pickle', 2);
    setDelivery('legacy', '123 Fixture Street\nFixture City, NY 12345\nUSA');
    addSession('legacy', 'session-a', '{"state":"MI"}', false);
    addSession('legacy', 'session-b', '{"state":"NY"}', false);
    addSession('legacy', 'session-c', '{"state":"TX"}', false, '2026-09-02 12:00:00');
    fixture.sqlite.prepare("UPDATE payment_sessions SET payment_status = 'pending' WHERE id = 'session-c'").run();
    const report: RevenueResponse = await (await GET(new Request(`${url}?year=2026`))).json();
    expect(report.pickleSalesByState).toHaveLength(1);
    expect(report.pickleSalesByState[0]).toMatchObject({ stateCode: 'NY', jars: 2 });
  });

  it('keeps jars with malformed, missing or unrecognized states in an Unknown group', async () => {
    const addresses = [null, '{broken json', '{}', '{"state":42}', '{"state":"not a state"}', '{"state":{"code":"TX"}}'];
    addresses.forEach((address, index) => {
      const id = `unknown-${index}`;
      addOrder(id, '2026-09-01 12:00:00');
      addItem(id);
      setDelivery(id, address);
    });
    const response = await GET(new Request(`${url}?year=2026`));
    expect(response.status).toBe(200);
    const report: RevenueResponse = await response.json();
    expect(report.pickleSalesByState).toHaveLength(1);
    expect(report.pickleSalesByState[0]).toMatchObject({ stateCode: 'Unknown', stateName: 'Unknown', jars: 6 });
  });

  it('does not convert invalid historical quantities into jar sales', async () => {
    for (const [index, quantity] of [0, -1, 1.5].entries()) {
      const id = `invalid-${index}`;
      addOrder(id, '2026-09-01 12:00:00');
      addItem(id, 'Chicken Pickle', quantity);
    }
    const report: RevenueResponse = await (await GET(new Request(`${url}?year=2026`))).json();
    expect(report.pickleSalesByState).toEqual([]);
  });

  it('reports database unavailability instead of fabricated zero revenue', async () => {
    mocks.configured = false;
    const response = await GET(new Request(`${url}?year=2026`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Database unavailable' });
  });

  it('fails without partial data if the database query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fixture.faults.failOnSql = /FROM orders o/;
    fixture.faults.failuresRemaining = 1;
    const response = await GET(new Request(`${url}?year=2026`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Could not load revenue. Please try again.' });
  });

  it('does not silently show zero state sales if their grouped query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fixture.faults.failOnSql = /JOIN order_items i/;
    fixture.faults.failuresRemaining = 1;
    const response = await GET(new Request(`${url}?year=2026`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Could not load revenue. Please try again.' });
  });
});
