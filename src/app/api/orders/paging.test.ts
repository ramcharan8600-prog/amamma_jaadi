import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { D1Database } from '@cloudflare/workers-types';
import { createTestD1 } from '@/lib/test-utils/d1';

const mocks = vi.hoisted(() => ({ db: null as D1Database | null }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'valid' }) }) }));
vi.mock('@/lib/session', () => ({ SESSION_COOKIE: 'session', verifySessionToken: () => true }));
vi.mock('@/lib/db', () => ({ getDb: () => mocks.db, isDbConfigured: () => true }));
import { GET } from './route';
import { GET as PRODUCTION } from './production/route';

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => {
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('../../../lib/d1-schema.sql', import.meta.url), 'utf8'));
  mocks.db = fixture.db;
  // 250 paid pickup orders (newest = AJ-1250), 2 Malpuri packs of 16 each, plus one
  // fully refunded order that production must ignore.
  const order = fixture.sqlite.prepare(`INSERT INTO orders
    (id,order_number,customer_name,phone_number,order_type,pickup_date,pickup_location,total_price,tax,payment_status,created_at)
    VALUES (?,?,'Test','555','pickup','2026-10-11','plano-biryanify',80,0,?,?)`);
  const item = fixture.sqlite.prepare(`INSERT INTO order_items (id,order_id,product_name,quantity,product_price,selected_tier,line_total)
    VALUES (?,?,'Guntur Malpuri',2,2.5,16,80)`);
  for (let i = 1; i <= 250; i++) {
    const stamp = `2026-10-${String(1 + Math.floor(i / 25)).padStart(2, '0')} ${String(i % 24).padStart(2, '0')}:00:00`;
    order.run(`o${i}`, `AJ-${1000 + i}`, 'paid', stamp);
    item.run(`i${i}`, `o${i}`);
  }
  order.run('refunded', 'AJ-0001', 'refunded', '2026-09-01 00:00:00');
  item.run('i-refunded', 'refunded');
});
afterEach(() => fixture.sqlite.close());

const list = async (query: string) => (await GET(new NextRequest(`https://shop.test/api/orders?${query}`))).json();

it('pages through every order with the total, past the old 200 cap', async () => {
  const first = await list('filter=all&page=1&pageSize=25');
  expect(first.total).toBe(251);
  expect(first.orders).toHaveLength(25);
  expect(first.orders[0].order_items).toHaveLength(1);

  const last = await list('filter=all&page=11&pageSize=25');
  expect(last.orders.map((o: { order_number: string }) => o.order_number)).toEqual(['AJ-0001']);

  const seen = new Set<string>();
  for (let page = 1; page <= 11; page++) {
    for (const o of (await list(`filter=all&page=${page}&pageSize=25`)).orders) seen.add(o.id);
  }
  expect(seen.size).toBe(251);
});

it('keeps old callers working (first 200) and caps a page at 1,000', async () => {
  expect((await list('filter=all')).orders).toHaveLength(200);
  const big = await list('filter=all&pageSize=5000');
  expect(big.orders).toHaveLength(251);
  expect(big.pageSize).toBe(1000);
});

it('totals production over every matching order, not one page, and skips fully refunded ones', async () => {
  const response = await PRODUCTION(new NextRequest('https://shop.test/api/orders/production?filter=all&pickupLocation=plano-biryanify'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    orderCounts: { pickup: 250, delivery: 0 },
    lines: [{ product_name: 'Guntur Malpuri', selected_tier: 16, quantity: 500 }],
  });
  const bad = await PRODUCTION(new NextRequest('https://shop.test/api/orders/production?pickupLocation=nowhere'));
  expect(bad.status).toBe(400);
});
