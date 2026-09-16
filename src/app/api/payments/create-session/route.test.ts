import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getProductById } from '@/data/products';
import { MAX_PRODUCT_QUANTITY } from '@/lib/cart-validation';

const mocks = vi.hoisted(() => {
  const inserts: unknown[][] = [];
  const coupon = vi.fn(async () => null as { code: string; active: number } | null);
  const prepare = vi.fn(() => {
    let values: unknown[] = [];
    return {
      bind(...input: unknown[]) { values = input; return this; },
      async run() { inserts.push(values); return { success: true }; },
      first: coupon,
    };
  });
  return {
    inserts, coupon, prepare,
    getStockMap: vi.fn(async () => ({} as Record<string, number>)),
    rateLimit: vi.fn(() => true),
  };
});

vi.mock('@/lib/db', () => ({
  isDbConfigured: () => true,
  getDb: () => ({ prepare: mocks.prepare, batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
    const results = []; for (const statement of statements) results.push(await statement.run()); return results;
  } }),
  newId: () => 'TEST_SESSION',
}));
vi.mock('@/lib/square', () => ({
  isSquareEnabled: () => true,
  getSquarePublicConfig: () => ({ appId: 'test-app', locationId: 'test-location', environment: 'sandbox' }),
}));
vi.mock('@/lib/inventory', () => ({ getStockMap: mocks.getStockMap }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit, getClientIp: () => '127.0.0.1' }));

import { POST } from './route';

const sweet = { productId: 'sweet-malpuri', quantity: 1, selectedTier: 16 };
const gift = {
  productId: 'gift-box-sweet-memories', quantity: 1,
  selectedVariant: '12 pcs Guntur Malpuri',
};
const pickup = { type: 'pickup', date: '2026-10-10', locationId: 'plano-biryanify' };
const delivery = (state: string) => ({
  type: 'delivery', addressLine1: '123 Test Street', city: 'Test City',
  state, zip: '75075', country: 'USA',
});
const checkout = (items: unknown = [sweet], fulfillment: unknown = pickup) => ({
  items, fulfillment, customerName: 'Checkout Test', email: 'checkout@example.com', phone: '2145550100',
});

function post(body: unknown) {
  return POST(new NextRequest('https://example.test/api/payments/create-session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-08T18:00:00Z'));
  vi.clearAllMocks();
  mocks.inserts.length = 0;
  mocks.getStockMap.mockResolvedValue({});
  mocks.coupon.mockResolvedValue(null);
  mocks.rateLimit.mockReturnValue(true);
});
afterEach(() => vi.useRealTimers());

describe('create-session validates pickup dates before storing a payable session', () => {
  it.each([undefined, null, '', {}, 20260909, '122026-01-09', '2026-02-30',
    '2026-02-29', '2026-09-07', '2026-12-08', '2026-9-09', '2026-09-09T00:00:00Z'])
    ('rejects invalid pickup date %j without inserting a session', async (date) => {
      const response = await post(checkout([sweet], { ...pickup, date }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/pickup date|pickup can/i);
      expect(mocks.inserts).toHaveLength(0);
    });

  it.each(['2026-09-08', '2026-09-09', '2026-12-07'])('stores valid %s exactly', async (date) => {
    expect((await post(checkout([sweet], { ...pickup, date }))).status).toBe(201);
    expect(JSON.parse(mocks.inserts[0][5] as string).date).toBe(date);
  });

  it('requires tomorrow for more than 150 canonical pieces despite forged product data', async () => {
    const items = [{ ...sweet, quantity: 10, product: { category: 'pickles' } }];
    const response = await post(checkout(items, { ...pickup, date: '2026-09-08' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('1 day notice');
    expect(mocks.inserts).toHaveLength(0);
    expect((await post(checkout(items, { ...pickup, date: '2026-09-09' }))).status).toBe(201);
  });

  it('does not apply pickup-date rules to delivery orders', async () => {
    expect((await post(checkout([sweet], { ...delivery('TX'), date: '122026-01-09' }))).status).toBe(201);
    expect(JSON.parse(mocks.inserts[0][5] as string)).not.toHaveProperty('date');
  });
});

describe('create-session rejects malformed carts before creating a payable session', () => {
  it.each(['TX', 'AL', 'NC'])('blocks the shipping-only NaN exploit for %s', async (state) => {
    const response = await post(checkout([
      { ...sweet, quantity: 2 },
      { ...gift, quantity: 'not-a-number', lineTotal: 30 },
    ], delivery(state)));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/quantity/i);
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.getStockMap).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 0, -1, 1.5, '1', true, {}, [], MAX_PRODUCT_QUANTITY + 1])(
    'rejects invalid quantity %j without storing a session',
    async (quantity) => {
      expect((await post(checkout([{ ...sweet, quantity }], delivery('TX')))).status).toBe(400);
      expect(mocks.inserts).toHaveLength(0);
    }
  );

  it.each(['1e309', '-1e309'])('rejects a JSON number that overflows to %s', async (number) => {
    const body = JSON.stringify(checkout([{ ...sweet, quantity: 'OVERFLOW' }], delivery('TX')))
      .replace('"OVERFLOW"', number);
    const response = await POST(new NextRequest('https://example.test/api/payments/create-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }));
    expect(response.status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
  });

  it.each([null, [], 'invalid', {}, { items: [null] }, { items: [[]] }])(
    'returns 400 for malformed request %j',
    async (body) => {
      expect((await post(body)).status).toBe(400);
      expect(mocks.inserts).toHaveLength(0);
    }
  );

  it('returns 400 for invalid JSON', async () => {
    const response = await POST(new NextRequest('https://example.test/api/payments/create-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    }));
    expect(response.status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
  });

  it.each([
    { ...sweet, selectedTier: '16' },
    { ...sweet, selectedTier: 1 },
    { ...sweet, selectedTier: null },
    { ...sweet, selectedVariant: 'free extra products' },
    { ...gift, selectedVariant: 'free extra products' },
    { ...gift, selectedVariant: null },
    { ...gift, selectedTier: 50 },
  ])('rejects malformed tier or contents %j', async (item) => {
    expect((await post(checkout([item]))).status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
  });

  it('checks combined stock across duplicate lines', async () => {
    mocks.getStockMap.mockResolvedValue({ 'pickle-chicken': 3 });
    const response = await post(checkout([
      { productId: 'pickle-chicken', quantity: 2 },
      { productId: 'pickle-chicken', quantity: 2 },
    ]));
    expect(response.status).toBe(409);
    expect(mocks.inserts).toHaveLength(0);
  });
});

describe('create-session retains approved shipping and gift-box rules', () => {
  it.each([
    { name: 'pickup gift box', items: [gift], fulfillment: pickup, subtotal: 30, shipping: 0 },
    { name: 'Texas gift box', items: [gift], fulfillment: delivery('TX'), subtotal: 30, shipping: 6.99 },
    { name: 'nearby below $60', items: [sweet], fulfillment: delivery('AL'), subtotal: 40, shipping: 11.99 },
    { name: 'nearby at $60 including gift box', items: [{ ...gift, quantity: 2 }], fulfillment: delivery('CO'), subtotal: 60, shipping: 8.99 },
    { name: 'far at $80', items: [{ ...sweet, quantity: 2 }], fulfillment: delivery('NC'), subtotal: 80, shipping: 11.99 },
    { name: 'far at $80 including gift box', items: [gift, { productId: 'sweet-kova', quantity: 1, selectedTier: 25 }], fulfillment: delivery('WA'), subtotal: 80, shipping: 11.99 },
  ])('$name', async ({ items, fulfillment, subtotal, shipping }) => {
    const response = await post(checkout(items, fulfillment));
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({ subtotal, tax: 0, shipping, totalAmount: subtotal + shipping });
    expect(mocks.inserts).toHaveLength(2);
    const stored = JSON.parse(mocks.inserts[0][4] as string) as Array<{ lineTotal: number }>;
    expect(stored.reduce((sum, item) => sum + item.lineTotal, 0)).toBe(subtotal);
  });

  it.each(['AL', 'CO', 'NC', 'WA'])('rejects the $30 gift box alone outside Texas (%s)', async (state) => {
    const response = await post(checkout([gift], delivery(state)));
    expect(response.status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
  });

  it('does not let a forged line total bypass the far-state minimum', async () => {
    const response = await post(checkout([{ ...sweet, lineTotal: 1000 }], delivery('NC')));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('$80.00');
    expect(mocks.inserts).toHaveLength(0);
  });

  it('persists catalog names, prices, product restrictions and canonical line amounts', async () => {
    const response = await post(checkout([
      { ...sweet, product: { name: 'Fifty free boxes', unitPrice: 0 }, lineTotal: 9999 },
      { ...gift, product: { name: 'Forged gift', deliveryStateCodes: [] }, lineTotal: -1 },
      { productId: 'pickle-chicken', quantity: 1, product: { name: 'Free jar' }, lineTotal: 0 },
    ], delivery('AL')));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal: 88, tax: 1.49, shipping: 8.99, totalAmount: 98.48 });
    const saved = JSON.parse(mocks.inserts[0][4] as string);
    expect(saved[0]).toEqual({ ...sweet, product: getProductById(sweet.productId), lineTotal: 40 });
    expect(saved[1]).toEqual({ ...gift, product: getProductById(gift.productId), lineTotal: 30 });
    expect(saved[2].lineTotal).toBe(18);
    expect(mocks.inserts[0][6]).toBe(98.48);
  });

  it('keeps accepted gift contents and valid coupons unchanged', async () => {
    mocks.coupon.mockResolvedValue({ code: 'WELCOME', active: 1 });
    const response = await post({ ...checkout([gift]), couponCode: 'welcome' });
    expect(response.status).toBe(201);
    const saved = JSON.parse(mocks.inserts[0][4] as string);
    expect(saved[0].selectedVariant).toBe(gift.selectedVariant);
    expect(mocks.inserts[0][9]).toBe('WELCOME');
  });
});

describe('Gongura Chicken price and stock enforcement', () => {
  it('charges the catalog price and enforces the admin stock count', async () => {
    mocks.getStockMap.mockResolvedValue({ 'pickle-gongura-chicken': 2 });
    const response = await post(checkout([{ productId: 'pickle-gongura-chicken', quantity: 2, lineTotal: 1 }], pickup));
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.subtotal).toBe(38);
    expect(result.shipping).toBe(0);
    expect(result.totalAmount).toBe(41.14);
    const oversold = await post(checkout([{ productId: 'pickle-gongura-chicken', quantity: 3 }], pickup));
    expect(oversold.status).toBe(409);
    expect((await oversold.json()).error).toMatch(/stock|available|left/i);
  });
});

describe('Texas tax and shipping recorded by checkout', () => {
  it.each([
    { items: [{ productId: 'pickle-gongura-chicken', quantity: 1 }], subtotal: 19, shipping: 6.99, tax: 2.14, totalAmount: 28.13 },
    { items: [gift], subtotal: 30, shipping: 6.99, tax: 0, totalAmount: 36.99 },
    { items: [gift, { productId: 'pickle-gongura-chicken', quantity: 1 }], subtotal: 49, shipping: 6.99, tax: 2.14, totalAmount: 58.13 },
  ])('recomputes and stores subtotal $subtotal tax $tax and shipping $shipping', async ({items, ...expected}) => {
    mocks.getStockMap.mockResolvedValue({ 'pickle-gongura-chicken': 10 });
    const response = await post({ ...checkout(items, delivery('TX')), tax: 0, shipping: 0, total: 1 });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject(expected);
    const bindings = mocks.inserts[0];
    expect(bindings).toContain(expected.totalAmount);
    expect(bindings).toContain(expected.tax);
    expect(bindings).toContain(expected.shipping);
  });
});


describe('Bobbatlu ready stock and 1-day preparation', () => {
  const bobbatlu = { productId: 'sweet-bobbatlu', quantity: 1, selectedTier: 16 };
  it.each([0, 15])('requires tomorrow when %s pieces cannot fill the box', async stock => {
    mocks.getStockMap.mockResolvedValue({ 'sweet-bobbatlu': stock });
    const response = await post(checkout([bobbatlu], { ...pickup, date: '2026-09-08' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('1 day for preparation');
    expect(mocks.inserts).toHaveLength(0);
    expect((await post(checkout([bobbatlu], { ...pickup, date: '2026-09-09' }))).status).toBe(201);
    expect((await post(checkout([bobbatlu], delivery('TX')))).status).toBe(201);
  });
  it('uses pieces across tiers and duplicate lines, and allows same day when fully stocked', async () => {
    mocks.getStockMap.mockResolvedValue({ 'sweet-bobbatlu': 41 });
    const items = [bobbatlu, { ...bobbatlu, selectedTier: 25 }];
    expect((await post(checkout(items, { ...pickup, date: '2026-09-08' }))).status).toBe(201);
    mocks.getStockMap.mockResolvedValue({ 'sweet-bobbatlu': 40 });
    expect((await post(checkout(items, { ...pickup, date: '2026-09-08' }))).status).toBe(400);
  });
  it('safely falls back to made-to-order when inventory has no Bobbatlu count', async () => {
    expect((await post(checkout([bobbatlu], { ...pickup, date: '2026-09-08' }))).status).toBe(400);
    expect((await post(checkout([bobbatlu], delivery('TX')))).status).toBe(201);
  });
});


describe('pickle-only shipping counts canonical jar quantities', () => {
  it.each([
    {items:[{productId:'pickle-gongura-chicken',quantity:2}], subtotal:38,shipping:5.99,tax:3.63,totalAmount:47.62},
    {items:[{productId:'pickle-gongura-chicken',quantity:3}], subtotal:57,shipping:4.99,tax:5.11,totalAmount:67.10},
    {items:[{productId:'pickle-gongura-chicken',quantity:1},{productId:'pickle-chicken',quantity:1}],subtotal:37,shipping:5.99,tax:3.55,totalAmount:46.54},
    {items:[{productId:'pickle-gongura-chicken',quantity:1},{productId:'pickle-gongura-chicken',quantity:1}],subtotal:38,shipping:5.99,tax:3.63,totalAmount:47.62},
  ])('stores $shipping shipping for $subtotal of jars', async ({items,...expected}) => {
    const response=await post({...checkout(items,delivery('TX')),pickleJarCount:1,picklesOnly:false,shipping:0});
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject(expected);
    expect(JSON.parse(mocks.inserts[1][1] as string)).toMatchObject({
      shippingCents:Math.round(expected.shipping*100),taxableShippingCents:Math.round(expected.shipping*100),taxCents:Math.round(expected.tax*100),
      policyVersion:'2026-09-16-pickle-nationwide-v4',
    });
  });
  it('ignores a forged jar count and mixed-order flag', async () => {
    const response=await post({...checkout([{productId:'pickle-gongura-chicken',quantity:1}],delivery('TX')),pickleJarCount:3});
    expect((await response.json()).shipping).toBe(6.99);
    const mixed=await post({...checkout([gift,{productId:'pickle-gongura-chicken',quantity:2}],delivery('TX')),pickleJarCount:2,picklesOnly:true});
    expect((await mixed.json()).shipping).toBe(6.99);
  });
});

describe('pickle-only orders have no destination minimum', () => {
  it.each([
    ['NY', 1, 19, 6.99, 1.57, 27.56],
    ['CA', 2, 38, 5.99, 3.14, 47.13],
    ['WA', 3, 57, 4.99, 4.70, 66.69],
    ['OK', 4, 76, 4.99, 6.27, 87.26],
  ] as const)('quotes %s %s jars below $80', async (state, quantity, subtotal, shipping, tax, totalAmount) => {
    const response = await post(checkout([{ productId: 'pickle-gongura-chicken', quantity }], delivery(state)));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal, shipping, tax, totalAmount });
    expect(JSON.parse(mocks.inserts[1][1] as string)).toMatchObject({
      shippingCents: Math.round(shipping * 100), taxableShippingCents: 0,
      taxCents: Math.round(tax * 100), policyVersion: '2026-09-16-pickle-nationwide-v4',
    });
  });
  it('keeps the $80 minimum on mixed carts even with forged category and flags', async () => {
    const response = await post({ ...checkout([
      { ...sweet, product: { category: 'pickles' } },
      { productId: 'pickle-gongura-chicken', quantity: 1 },
    ], delivery('NY')), picklesOnly: true });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('$80.00');
    expect(mocks.inserts).toHaveLength(0);
  });
  it.each(['AK', 'HI', 'PR'])('does not waive destination eligibility for %s pickles', async (state) => {
    const response = await post(checkout([{ productId: 'pickle-chicken', quantity: 1 }], delivery(state)));
    expect(response.status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
  });
});
