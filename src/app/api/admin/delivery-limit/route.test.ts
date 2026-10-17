import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { D1Database } from '@cloudflare/workers-types';
import { createTestD1 } from '@/lib/test-utils/d1';

const mocks = vi.hoisted(() => ({ db: null as D1Database | null, authed: true }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (mocks.authed ? { value: 'valid' } : undefined) }) }));
vi.mock('@/lib/session', () => ({ SESSION_COOKIE: 'session', verifySessionToken: () => true }));
vi.mock('@/lib/db', () => ({ getDb: () => mocks.db, isDbConfigured: () => true }));
import { GET, PUT } from './route';
import { GET as publicGET } from '../../delivery-pauses/route';

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => {
  mocks.authed = true;
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('../../../../lib/d1-schema.sql', import.meta.url), 'utf8'));
  mocks.db = fixture.db;
});
afterEach(() => fixture.sqlite.close());

const put = (limit: unknown) => PUT(new NextRequest('https://shop.test/api/admin/delivery-limit', { method: 'PUT', body: JSON.stringify({ limit }) }));
const deliveryNow = () => fixture.sqlite.prepare(`INSERT INTO orders (id, order_number, customer_name, phone_number, order_type, total_price, payment_status, created_at)
  VALUES (?, ?, 'C', '1', 'delivery', 50, 'paid', datetime('now'))`).run(crypto.randomUUID(), `AJ-${Math.random()}`);

it('lets the owner set, change and remove the weekly limit, and checkout sees "full" without any counts', async () => {
  deliveryNow();
  expect(await (await GET()).json()).toMatchObject({ limit: null, used: 1, full: false });
  expect(await (await put(1)).json()).toMatchObject({ limit: 1, used: 1, full: true });
  const shopper = await (await publicGET()).json();
  expect(shopper).toMatchObject({ paused: [], weekFull: true });
  expect(shopper).not.toHaveProperty('used');
  expect(shopper).not.toHaveProperty('limit');
  expect(await (await put('30')).json()).toMatchObject({ limit: 30, full: false });
  expect((await (await publicGET()).json()).weekFull).toBe(false);
  expect(await (await put(null)).json()).toMatchObject({ limit: null, full: false });
});

it('refuses anyone not signed in, and numbers outside 1–1000', async () => {
  mocks.authed = false;
  expect((await GET()).status).toBe(401);
  expect((await put(30)).status).toBe(401);
  mocks.authed = true;
  for (const bad of [0, 1001, 2.5, 'lots']) expect((await put(bad)).status).toBe(400);
  expect((await PUT(new NextRequest('https://shop.test/api/admin/delivery-limit', { method: 'PUT', body: '{}' }))).status).toBe(400);
});
