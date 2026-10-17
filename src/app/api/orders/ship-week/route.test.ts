import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { D1Database } from '@cloudflare/workers-types';
import { createTestD1 } from '@/lib/test-utils/d1';
import { buildOrderFilters } from '@/lib/order-filters';

const mocks = vi.hoisted(() => ({ db: null as D1Database | null, authed: true }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (mocks.authed ? { value: 'valid' } : undefined) }) }));
vi.mock('@/lib/session', () => ({ SESSION_COOKIE: 'session', verifySessionToken: () => true }));
vi.mock('@/lib/db', () => ({ getDb: () => mocks.db, isDbConfigured: () => true }));
import { PUT } from './route';

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => {
  mocks.authed = true;
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('../../../../lib/d1-schema.sql', import.meta.url), 'utf8'));
  fixture.sqlite.prepare(`INSERT INTO orders (id, order_number, customer_name, phone_number, order_type, total_price) VALUES
    ('d1', 'AJ-1', 'C', '1', 'delivery', 50), ('p1', 'AJ-2', 'C', '1', 'pickup', 40)`).run();
  mocks.db = fixture.db;
});
afterEach(() => fixture.sqlite.close());

const put = (body: unknown) => PUT(new NextRequest('https://shop.test/api/orders/ship-week', { method: 'PUT', body: JSON.stringify(body) }));
const week = () => (fixture.sqlite.prepare("SELECT ship_week AS w FROM orders WHERE id = 'd1'").get() as { w: string | null }).w;

it('moves a delivery order to another shipment week, or clears it', async () => {
  expect((await put({ orderId: 'd1', shipWeek: '2026-11-02' })).status).toBe(200);
  expect(week()).toBe('2026-11-02');
  expect((await put({ orderId: 'd1', shipWeek: null })).status).toBe(200);
  expect(week()).toBeNull();
});

it('refuses non-admins, non-Monday dates, and pickup orders', async () => {
  mocks.authed = false;
  expect((await put({ orderId: 'd1', shipWeek: '2026-11-02' })).status).toBe(401);
  mocks.authed = true;
  expect((await put({ orderId: 'd1', shipWeek: '2026-11-03' })).status).toBe(400);
  expect((await put({ orderId: 'p1', shipWeek: '2026-11-02' })).status).toBe(404);
  expect(week()).toBeNull();
});

it('filters All Orders by shipment week or "not set"', () => {
  const byWeek = buildOrderFilters(new URLSearchParams({ shipWeek: '2026-11-02' }));
  expect(byWeek).toMatchObject({ binds: ['2026-11-02'] });
  expect('where' in byWeek && byWeek.where).toEqual(expect.arrayContaining(["order_type = 'delivery'", 'ship_week = ?']));
  const none = buildOrderFilters(new URLSearchParams({ shipWeek: 'none' }));
  expect('where' in none && none.where).toEqual(expect.arrayContaining(['ship_week IS NULL']));
  expect(buildOrderFilters(new URLSearchParams({ shipWeek: '2026-11-03' }))).toEqual({ error: 'Invalid ship week filter' });
});
