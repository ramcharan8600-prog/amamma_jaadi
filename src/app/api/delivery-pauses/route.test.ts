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

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => {
  mocks.authed = true;
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('../../../lib/d1-schema.sql', import.meta.url), 'utf8'));
  mocks.db = fixture.db;
});
afterEach(() => fixture.sqlite.close());

const put = (paused: unknown) =>
  PUT(new NextRequest('https://shop.test/api/delivery-pauses', { method: 'PUT', body: JSON.stringify({ paused }) }));

it('lets admin pause any mix of areas, shows them to checkout, and resume them', async () => {
  expect((await (await put(['far', 'nearby'])).json()).paused).toEqual(['nearby', 'far']);
  expect((await (await GET()).json()).paused).toEqual(['nearby', 'far']);
  expect((await (await put(['texas', 'nearby', 'far'])).json()).paused).toEqual(['texas', 'nearby', 'far']);
  expect((await (await put([])).json()).paused).toEqual([]);
});

it('refuses anyone not signed in to admin, and unknown areas', async () => {
  mocks.authed = false;
  expect((await put(['texas'])).status).toBe(401);
  mocks.authed = true;
  expect((await put(['alaska'])).status).toBe(400);
  expect((await put('texas')).status).toBe(400);
  expect((await (await GET()).json()).paused).toEqual([]);
});
