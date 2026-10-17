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
import { offeredShipWeeks } from '@/lib/delivery-limit';

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => {
  mocks.authed = true;
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('../../../../lib/d1-schema.sql', import.meta.url), 'utf8'));
  mocks.db = fixture.db;
});
afterEach(() => fixture.sqlite.close());

const put = (limit: unknown) => PUT(new NextRequest('https://shop.test/api/admin/delivery-limit', { method: 'PUT', body: JSON.stringify({ limit }) }));
const booked = (week: string) => fixture.sqlite.prepare(`INSERT INTO orders (id, order_number, customer_name, phone_number, order_type, total_price, payment_status, ship_week)
  VALUES (?, ?, 'C', '1', 'delivery', 50, 'paid', ?)`).run(crypto.randomUUID(), `AJ-${Math.random()}`, week);

it('lets the owner set the per-week limit and see every week; checkout only sees which weeks are full', async () => {
  const [first, second] = offeredShipWeeks();
  booked(first);
  const admin = await (await GET()).json();
  expect(admin.limit).toBeNull();
  expect(admin.weeks).toHaveLength(4); // the week being shipped now + 3 bookable weeks
  expect(admin.weeks.find((w: { week: string }) => w.week === first)).toMatchObject({ used: 1, full: false });

  const after = await (await put(1)).json();
  expect(after.weeks.find((w: { week: string }) => w.week === first)).toMatchObject({ used: 1, full: true });
  expect(after.allFull).toBe(false);
  const shopper = await (await publicGET()).json();
  expect(shopper.weekFull).toBe(false);
  expect(shopper.weeks.slice(0, 2)).toEqual([{ week: first, full: true }, { week: second, full: false }]);
  expect(shopper.weeks).toHaveLength(3);
  expect(shopper.currentWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(JSON.stringify(shopper)).not.toMatch(/"used"|"limit"/);
  expect(await (await put('30')).json()).toMatchObject({ limit: 30, allFull: false });
  expect(await (await put(null)).json()).toMatchObject({ limit: null, allFull: false });
});

it('refuses anyone not signed in, and numbers outside 1–1000', async () => {
  mocks.authed = false;
  expect((await GET()).status).toBe(401);
  expect((await put(30)).status).toBe(401);
  mocks.authed = true;
  for (const bad of [0, 1001, 2.5, 'lots']) expect((await put(bad)).status).toBe(400);
  expect((await PUT(new NextRequest('https://shop.test/api/admin/delivery-limit', { method: 'PUT', body: '{}' }))).status).toBe(400);
});
