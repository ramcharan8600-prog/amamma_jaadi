import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { D1Database } from '@cloudflare/workers-types';
import { createTestD1 } from '@/lib/test-utils/d1';
import { toBusinessDateString } from '@/lib/date';

const mocks = vi.hoisted(() => ({ db: null as D1Database | null, authed: true }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (mocks.authed ? { value: 'valid' } : undefined) }) }));
vi.mock('@/lib/session', () => ({ SESSION_COOKIE: 'session', verifySessionToken: () => true }));
vi.mock('@/lib/db', () => ({ getDb: () => mocks.db, isDbConfigured: () => true }));
import { GET, POST, DELETE } from './route';

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => {
  mocks.authed = true;
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('../../../lib/d1-schema.sql', import.meta.url), 'utf8'));
  mocks.db = fixture.db;
});
afterEach(() => fixture.sqlite.close());

const day = (offset: number) => {
  const d = new Date(`${toBusinessDateString(new Date())}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const send = (handler: typeof POST, date: unknown) =>
  handler(new NextRequest('https://shop.test/api/sold-out-dates', { method: 'POST', body: JSON.stringify({ date }) }));

it('lets admin mark today or a future date sold out, lists them for checkout, and reopen them', async () => {
  expect((await (await send(POST, day(0))).json()).dates).toEqual([day(0)]);
  expect((await (await send(POST, day(3))).json()).dates).toEqual([day(0), day(3)]);
  expect((await (await send(POST, day(3))).json()).dates).toEqual([day(0), day(3)]); // marking twice is fine
  expect((await (await GET()).json()).dates).toEqual([day(0), day(3)]);
  expect((await (await send(DELETE, day(0))).json()).dates).toEqual([day(3)]);
});

it('hides past sold-out dates from checkout', async () => {
  fixture.sqlite.prepare('INSERT INTO sold_out_dates (date) VALUES (?), (?)').run(day(-1), day(1));
  expect((await (await GET()).json()).dates).toEqual([day(1)]);
});

it('refuses past, malformed or too-far dates, and anyone not logged in', async () => {
  for (const date of [day(-1), '2026-13-01', 'tomorrow', day(91), null]) {
    expect((await send(POST, date)).status).toBe(400);
  }
  mocks.authed = false;
  expect((await send(POST, day(1))).status).toBe(401);
  expect((await send(DELETE, day(1))).status).toBe(401);
  expect((await GET()).status).toBe(200);
});

it('lets checkout continue if the sold-out lookup fails (e.g. the table is missing)', async () => {
  const { isSoldOutDate } = await import('@/lib/sold-out-dates');
  fixture.sqlite.exec('DROP TABLE sold_out_dates');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(await isSoldOutDate(fixture.db, day(1))).toBe(false);
});
