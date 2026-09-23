import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { D1Database } from '@cloudflare/workers-types';
import { createTestD1 } from '@/lib/test-utils/d1';

const state = vi.hoisted(() => ({ db: null as D1Database | null, authed: true }));
vi.mock('@/lib/db', () => ({ getDb: () => state.db, isDbConfigured: () => true }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'test' }) }) }));
vi.mock('@/lib/session', () => ({ SESSION_COOKIE: 'session', verifySessionToken: () => state.authed }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true, getClientIp: () => 'test' }));
import { POST as create, PATCH as update, GET as list } from './admin/route';
import { POST as validate } from './validate/route';
let database: ReturnType<typeof createTestD1>;
const request = (body: unknown) => new NextRequest('https://example.test/api/coupons', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});
const free = { code: 'ship', influencerName: 'Test campaign', type: 'free_delivery', minSubtotal: 40 };
const items = [{ productId: 'sweet-malpuri', quantity: 1, selectedTier: 16 }];

beforeEach(() => {
  database = createTestD1();
  database.sqlite.exec(readFileSync(new URL('../../../lib/d1-schema.sql', import.meta.url), 'utf8'));
  state.db = database.db;
  state.authed = true;
});
afterEach(() => database.sqlite.close());

describe('coupon administration and validation', () => {
  it('creates, lists and edits a free-delivery minimum without changing active status', async () => {
    expect((await create(request(free))).status).toBe(201);
    expect((await list()).status).toBe(200);
    expect((await (await list()).json()).coupons[0]).toMatchObject({
      code: 'SHIP', coupon_type: 'free_delivery', min_subtotal: 40, bonus_qty: 0, bonus_item: '', active: 1,
    });
    expect((await update(request({ code: 'SHIP', minSubtotal: 55.25 }))).status).toBe(200);
    expect(database.sqlite.prepare("SELECT min_subtotal, active FROM influencer_coupons WHERE code='SHIP'").get())
      .toMatchObject({ min_subtotal: 55.25, active: 1 });
    expect((await update(request({ code: 'SHIP', active: false }))).status).toBe(200);
    expect((await validate(request({ code: 'SHIP', items }))).status).toBe(400);
  });

  it('accepts the exact minimum and rejects one cent below using catalog prices', async () => {
    await create(request(free));
    const accepted = await validate(request({ code: ' s h i p ', items }));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ code: 'SHIP', type: 'free_delivery', minSubtotal: 40, shippingPolicy: 'texas_v3' });
    await update(request({ code: 'SHIP', minSubtotal: 40.01 }));
    const rejected = await validate(request({ code: 'SHIP', subtotal: 999, items: items.map(item => ({ ...item, lineTotal: 999 })) }));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toContain('$40.01');
  });

  it('preserves existing complimentary coupon creation and rejects a minimum on it', async () => {
    expect((await create(request({ code: 'bonus', influencerName: 'Test', bonusItem: 'Malpuri', bonusQty: 3 }))).status).toBe(201);
    expect(await (await validate(request({ code: 'bonus' }))).json())
      .toMatchObject({ code: 'BONUS', type: 'complimentary', bonusItem: 'Malpuri', bonusQty: 3 });
    expect((await update(request({ code: 'BONUS', minSubtotal: 30 }))).status).toBe(400);
  });

  it.each([-1, 1.001, null, '', '40', true])('rejects invalid minimum %j on create and edit', async minSubtotal => {
    expect((await create(request({ ...free, minSubtotal }))).status).toBe(400);
    await create(request(free));
    expect((await update(request({ code: 'SHIP', minSubtotal }))).status).toBe(400);
  });

  it.each([0, 1.5, -2, 11])('rejects invalid complimentary quantity %s', async bonusQty => {
    expect((await create(request({ code: 'BONUS', influencerName: 'Test', bonusQty }))).status).toBe(400);
  });

  it('rejects unknown benefits and duplicate codes', async () => {
    expect((await create(request({ ...free, type: 'both' }))).status).toBe(400);
    await create(request(free));
    expect((await create(request(free))).status).toBe(409);
  });

  it('requires admin authentication to create, edit or list coupons', async () => {
    state.authed = false;
    expect((await create(request(free))).status).toBe(401);
    expect((await update(request({ code: 'SHIP', minSubtotal: 0 }))).status).toBe(401);
    expect((await list()).status).toBe(401);
  });
});

it('migrates legacy coupons without changing their benefits or usage', () => {
  const legacy = createTestD1();
  try {
    legacy.sqlite.exec(`CREATE TABLE influencer_coupons (code TEXT PRIMARY KEY, bonus_item TEXT, bonus_qty INTEGER, times_used INTEGER);
      CREATE TABLE payment_sessions (id TEXT PRIMARY KEY);
      INSERT INTO influencer_coupons VALUES ('OLD','Malpuri',3,7);`);
    legacy.sqlite.exec(readFileSync(new URL('../../../lib/migrations/016-coupon-benefits.sql', import.meta.url), 'utf8'));
    expect(legacy.sqlite.prepare('SELECT * FROM influencer_coupons').get()).toMatchObject({
      code: 'OLD', bonus_item: 'Malpuri', bonus_qty: 3, times_used: 7, coupon_type: 'complimentary', min_subtotal: 0,
    });
  } finally { legacy.sqlite.close(); }
});
