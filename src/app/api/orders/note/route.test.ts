import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { D1Database } from '@cloudflare/workers-types';
import { createTestD1 } from '@/lib/test-utils/d1';
import { cleanAdminNote } from '@/lib/admin-note';

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
  fixture.sqlite.prepare(`INSERT INTO orders (id, order_number, customer_name, phone_number, order_type, total_price)
    VALUES ('o1', 'AJ-1197', 'Sankar', '555', 'pickup', 49.99)`).run();
  mocks.db = fixture.db;
});
afterEach(() => fixture.sqlite.close());

const put = (body: unknown) => PUT(new NextRequest('https://shop.test/api/orders/note', { method: 'PUT', body: JSON.stringify(body) }));
const note = () => (fixture.sqlite.prepare("SELECT admin_note FROM orders WHERE id = 'o1'").get() as { admin_note: string | null }).admin_note;

it('saves, replaces and clears an order note for the signed-in admin', async () => {
  expect((await put({ orderId: 'o1', note: '  Free Kova 16\nPickup Sunday  ' })).status).toBe(200);
  expect(note()).toBe('Free Kova 16\nPickup Sunday');
  await put({ orderId: 'o1', note: 'On hold until he asks' });
  expect(note()).toBe('On hold until he asks');
  await put({ orderId: 'o1', note: '   ' });
  expect(note()).toBeNull();
});

it('refuses anyone not signed in, unknown orders and bad input', async () => {
  mocks.authed = false;
  expect((await put({ orderId: 'o1', note: 'x' })).status).toBe(401);
  mocks.authed = true;
  expect((await put({ orderId: 'missing', note: 'x' })).status).toBe(404);
  expect((await put({ orderId: 'o1', note: 42 })).status).toBe(400);
  expect(note()).toBeNull();
});

it('caps notes at 500 characters and drops control characters', () => {
  expect(cleanAdminNote('a\u0007b')).toBe('ab');
  expect(cleanAdminNote('x'.repeat(600))).toHaveLength(500);
  expect(cleanAdminNote(null)).toBeNull();
});
