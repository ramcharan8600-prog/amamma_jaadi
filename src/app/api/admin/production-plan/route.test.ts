import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createTestD1 } from '@/lib/test-utils/d1';
import { businessDateOffset } from '@/lib/date';

const mocks = vi.hoisted(() => ({ db: null as D1Database | null, authed: true }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (mocks.authed ? { value: 'valid' } : undefined) }) }));
vi.mock('@/lib/session', () => ({ SESSION_COOKIE: 'session', verifySessionToken: () => true }));
vi.mock('@/lib/db', () => ({ getDb: () => mocks.db, isDbConfigured: () => true }));
import { GET } from './route';

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => {
  mocks.authed = true;
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('../../../../lib/d1-schema.sql', import.meta.url), 'utf8'));
  mocks.db = fixture.db;
});
afterEach(() => fixture.sqlite.close());

function order(id: string, fields: Record<string, unknown>, items: Array<[string, number, number | null]>) {
  const row = {
    order_number: `AJ-${id}`, customer_name: `Customer ${id}`, phone_number: '555', order_type: 'pickup',
    pickup_date: null, pickup_location: 'plano-biryanify', total_price: 40, tax: 0, payment_status: 'paid',
    status: 'confirmed', shipment_status: 'yet_to_ship', created_at: '2026-10-01 12:00:00', ...fields,
  };
  fixture.sqlite.prepare(`INSERT INTO orders (id, ${Object.keys(row).join(', ')}) VALUES (?, ${Object.keys(row).map(() => '?').join(', ')})`)
    .run(id, ...Object.values(row));
  items.forEach(([name, quantity, tier], i) => fixture.sqlite.prepare(
    'INSERT INTO order_items (id, order_id, product_name, quantity, product_price, selected_tier, line_total) VALUES (?,?,?,?,0,?,0)',
  ).run(`${id}-${i}`, id, name, quantity, tier));
}

it('groups pickup orders by today, tomorrow and the day after, and lists delivery orders waiting to ship', async () => {
  order('t1', { pickup_date: businessDateOffset(0) }, [['Guntur Malpuri', 2, 16], ['Chicken Pickle', 1, null]]);
  order('t2', { pickup_date: businessDateOffset(0), payment_status: 'partially_refunded' }, [['Bobbatlu', 1, 10]]);
  order('n1', { pickup_date: businessDateOffset(1) }, [['Kova', 1, 16]]);
  order('a1', { pickup_date: businessDateOffset(2) }, [['Nellore Malai Khaja', 1, 25]]);
  order('later', { pickup_date: businessDateOffset(3) }, [['Guntur Malpuri', 1, 16]]);
  order('past', { pickup_date: businessDateOffset(-1) }, [['Guntur Malpuri', 1, 16]]);
  order('refunded', { pickup_date: businessDateOffset(0), payment_status: 'refunded' }, [['Guntur Malpuri', 9, 16]]);
  order('cancelled', { pickup_date: businessDateOffset(0), status: 'cancelled' }, [['Guntur Malpuri', 9, 16]]);
  order('test', { pickup_date: businessDateOffset(0) }, [['Guntur Malpuri', 9, 16]]);
  fixture.sqlite.prepare("INSERT INTO order_reporting_exclusions (order_id, reason, recorded_by) VALUES ('test', 'owner test', 'owner')").run();
  order('ship', { order_type: 'delivery', shipment_status: 'yet_to_ship', pickup_location: null }, [['Guntur Malpuri', 1, 24]]);
  order('shipped', { order_type: 'delivery', shipment_status: 'shipped', pickup_location: null }, [['Guntur Malpuri', 9, 16]]);

  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const plan = await response.json();
  expect(plan.days.map((d: { date: string }) => d.date)).toEqual([0, 1, 2].map(businessDateOffset));
  const numbers = (orders: Array<{ order_number: string }>) => orders.map((o) => o.order_number);
  expect(numbers(plan.days[0].orders)).toEqual(['AJ-t1', 'AJ-t2']);
  expect(numbers(plan.days[1].orders)).toEqual(['AJ-n1']);
  expect(numbers(plan.days[2].orders)).toEqual(['AJ-a1']);
  expect(numbers(plan.delivery)).toEqual(['AJ-ship']);
  expect(plan.days[0].orders[0]).toMatchObject({
    customer_name: 'Customer t1', pickup_location: 'plano-biryanify',
    items: [
      { product_name: 'Guntur Malpuri', quantity: 2, selected_tier: 16 },
      { product_name: 'Chicken Pickle', quantity: 1, selected_tier: null },
    ],
  });
});

it('is admin only', async () => {
  mocks.authed = false;
  expect((await GET()).status).toBe(401);
});
