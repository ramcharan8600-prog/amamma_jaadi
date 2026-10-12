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
const bonus = { code: 'bonus', influencerName: 'Test campaign', bonusItem: 'Malpuri', bonusQty: 3 };
const items = [{ productId: 'sweet-malpuri', quantity: 1, selectedTier: 15 }];

beforeEach(() => {
  database = createTestD1();
  database.sqlite.exec(readFileSync(new URL('../../../lib/d1-schema.sql', import.meta.url), 'utf8'));
  state.db = database.db;
  state.authed = true;
});
afterEach(() => database.sqlite.close());

describe('coupon administration and validation', () => {
  it('creates, lists, validates and switches off a complimentary coupon', async () => {
    expect((await create(request(bonus))).status).toBe(201);
    expect((await (await list()).json()).coupons[0]).toMatchObject({
      code: 'BONUS', coupon_type: 'complimentary', bonus_item: 'Malpuri', bonus_qty: 3, min_subtotal: 0, active: 1,
    });
    expect(await (await validate(request({ code: ' b o n u s ', items }))).json())
      .toEqual({ code: 'BONUS', type: 'complimentary', bonusItem: 'Malpuri', bonusQty: 3 });
    expect((await update(request({ code: 'BONUS', active: false }))).status).toBe(200);
    expect((await validate(request({ code: 'BONUS', items }))).status).toBe(400);
  });

  it('creates no shipping offers and never applies or re-enables an old one (ended 2026-10-12)', async () => {
    const created = await create(request({ code: 'ship', influencerName: 'Test', type: 'free_delivery', minSubtotal: 40 }));
    expect(created.status).toBe(400);
    expect((await created.json()).error).toBe('Coupons give complimentary pieces. Shipping offers ended on Oct 12, 2026.');
    database.sqlite.prepare(`INSERT INTO influencer_coupons (code, influencer_name, bonus_item, bonus_qty, coupon_type, min_subtotal, active)
      VALUES ('ANU2026', 'Old offer', '', 0, 'free_delivery', 60, 1)`).run();
    const refused = await validate(request({ code: 'ANU2026', items }));
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe("That promo code isn't valid.");
    expect((await update(request({ code: 'ANU2026', minSubtotal: 30 }))).status).toBe(400);
    expect((await update(request({ code: 'ANU2026', active: false }))).status).toBe(200);
    expect((await update(request({ code: 'ANU2026', active: true }))).status).toBe(400);
    expect(database.sqlite.prepare("SELECT active FROM influencer_coupons WHERE code='ANU2026'").get()).toEqual({ active: 0 });
  });

  it.each([0, 1.5, -2, 11])('rejects invalid complimentary quantity %s', async bonusQty => {
    expect((await create(request({ ...bonus, bonusQty }))).status).toBe(400);
  });

  it('rejects unknown items and duplicate codes', async () => {
    expect((await create(request({ ...bonus, bonusItem: 'Kova' }))).status).toBe(400);
    await create(request(bonus));
    expect((await create(request(bonus))).status).toBe(409);
  });

  it('requires admin authentication to create, edit or list coupons', async () => {
    state.authed = false;
    expect((await create(request(bonus))).status).toBe(401);
    expect((await update(request({ code: 'BONUS', active: false }))).status).toBe(401);
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
