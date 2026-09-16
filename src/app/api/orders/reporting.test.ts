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

let fixture: ReturnType<typeof createTestD1>;
const migration = readFileSync(new URL('../../../lib/migrations/014-owner-confirmed-test-orders.sql', import.meta.url), 'utf8');
beforeEach(() => {
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('../../../lib/d1-schema.sql', import.meta.url), 'utf8'));
  mocks.db = fixture.db;
});
afterEach(() => fixture.sqlite.close());

it('marks only the two confirmed tests, preserves receipts, and keeps them in admin history', async () => {
  const insert = fixture.sqlite.prepare(`INSERT INTO orders
    (id,order_number,customer_name,phone_number,order_type,total_price,tax,payment_status)
    VALUES (?,?,'Test','555','pickup',?,?,'paid')`);
  insert.run('6be4aa8c-20e2-43b2-a2bb-d4fc569ba824', 'AJ-1005', 32.48, 2.48);
  insert.run('fcb6a2cf-df9a-4899-bb09-11e656c1829b', 'AJ-1006', 88.77, 6.77);
  insert.run('real', 'AJ-REAL', 32.48, 2.48);
  fixture.sqlite.exec(migration);
  fixture.sqlite.exec(migration);
  const response = await GET(new NextRequest('https://shop.test/api/orders?filter=all'));
  expect(response.status).toBe(200);
  const { orders } = await response.json();
  expect(orders).toHaveLength(3);
  expect(orders.find((order: { id: string }) => order.id === 'real').is_test_order).toBe(0);
  expect(orders.filter((order: { is_test_order: number }) => order.is_test_order)).toHaveLength(2);
  expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM order_reporting_exclusions').get()?.n).toBe(2);
  expect(fixture.sqlite.prepare('SELECT SUM(tax) tax, SUM(refunded_amount) refunds FROM orders').get()).toEqual({ tax: 11.73, refunds: 0 });
  expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM order_refunds').get()?.n).toBe(0);
});

it('does not flag a matching order number from a different database or a mismatched receipt', () => {
  fixture.sqlite.exec(`INSERT INTO orders (id,order_number,customer_name,phone_number,order_type,total_price,tax)
    VALUES ('sandbox-id','AJ-1005','Test','555','pickup',32.48,2.48),
    ('fcb6a2cf-df9a-4899-bb09-11e656c1829b','AJ-1006','Test','555','pickup',100,6.77)`);
  fixture.sqlite.exec(migration);
  expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM order_reporting_exclusions').get()?.n).toBe(0);
});
