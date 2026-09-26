import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getProductById } from '@/data/products';
import type { CouponRow } from '@/lib/coupons';
import { MAX_PRODUCT_QUANTITY } from '@/lib/cart-validation';

const mocks = vi.hoisted(() => {
  const inserts: unknown[][] = [];
  const coupon = vi.fn(async () => null as CouponRow | null);
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
const assorted = { productId: 'sweet-assorted-box', quantity: 1, selectedTier: 22 };
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

describe('create-session requires a US contact phone', () => {
  it.each([undefined, null, '', '   ', '214555', '1234567890123456', 'not a phone', '1234567890', '24695550123', '+91 98765 43210'])
    ('rejects phone %j before storing a session', async (phone) => {
      const response = await post({ ...checkout(), phone });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/phone/i);
      expect(mocks.inserts).toHaveLength(0);
      expect(mocks.getStockMap).not.toHaveBeenCalled();
    });

  it.each([pickup, delivery('TX')])('accepts exactly 10 digits for $type', async (fulfillment) => {
    const response = await post({ ...checkout([sweet], fulfillment), phone: '2145550100' });
    expect(response.status).toBe(201);
    expect(mocks.inserts[0][3]).toBe('2145550100');
  });

  it.each([pickup, delivery('TX')])('stores a +1 number as 10 digits for $type', async (fulfillment) => {
    const response = await post({ ...checkout([sweet], { ...fulfillment, phone: '+1 (214) 555-0100' }), phone: '+1 (214) 555-0100' });
    expect(response.status).toBe(201);
    expect(mocks.inserts[0][3]).toBe('2145550100');
    expect(JSON.parse(mocks.inserts[0][5] as string).phone).toBe('2145550100');
  });

  it.each([pickup, delivery('TX')])('rejects a 6-digit phone for $type', async (fulfillment) => {
    const response = await post({ ...checkout([sweet], fulfillment), phone: '214555' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Enter a 10-digit US phone number');
    expect(mocks.inserts).toHaveLength(0);
  });
});

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

  it.each([
    ['CDT before cutoff', '2026-07-15T18:29:59.999Z', '2026-07-15', '2026-07-16', 201],
    ['CDT exactly at cutoff', '2026-07-15T18:30:00.000Z', '2026-07-15', '2026-07-16', 201],
    ['CDT one millisecond after cutoff', '2026-07-15T18:30:00.001Z', '2026-07-15', '2026-07-16', 400],
    ['CDT one second after cutoff', '2026-07-15T18:30:01Z', '2026-07-15', '2026-07-16', 400],
    ['CST before cutoff', '2026-01-15T19:29:59.999Z', '2026-01-15', '2026-01-16', 201],
    ['CST exactly at cutoff', '2026-01-15T19:30:00.000Z', '2026-01-15', '2026-01-16', 201],
    ['CST one millisecond after cutoff', '2026-01-15T19:30:00.001Z', '2026-01-15', '2026-01-16', 400],
    ['CST one second after cutoff', '2026-01-15T19:30:01Z', '2026-01-15', '2026-01-16', 400],
  ] as const)('enforces same-day pickup at %s', async (_label, now, today, tomorrow, status) => {
    vi.setSystemTime(new Date(now));
    const response = await post(checkout([sweet], { ...pickup, date: today }));
    expect(response.status).toBe(status);
    if (status === 400) {
      expect((await response.json()).error).toMatch(/1:30\s*PM|tomorrow/i);
      expect(mocks.inserts).toHaveLength(0);
    }
    expect((await post(checkout([sweet], { ...pickup, date: tomorrow }))).status).toBe(201);
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
    vi.setSystemTime(new Date('2026-09-08T19:00:00Z'));
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
    { name: 'far from $55 below $80', items: [sweet, { productId: 'sweet-kova', quantity: 1, selectedTier: 16 }], fulfillment: delivery('NC'), subtotal: 72, shipping: 18.99 },
    { name: 'far at $82 with Kova boxes', items: [{ productId: 'sweet-kova', quantity: 1, selectedTier: 25 }, { productId: 'sweet-kova', quantity: 1, selectedTier: 16 }], fulfillment: delivery('WA'), subtotal: 82, shipping: 11.99 },
    { name: 'assorted box pickup', items: [assorted], fulfillment: pickup, subtotal: 55, shipping: 0 },
    { name: 'assorted box in Texas', items: [assorted], fulfillment: delivery('TX'), subtotal: 55, shipping: 6.99 },
    { name: 'far assorted box alone meets the $55 minimum', items: [assorted], fulfillment: delivery('NY'), subtotal: 55, shipping: 18.99 },
    { name: 'far assorted box plus Kova at $87', items: [assorted, { productId: 'sweet-kova', quantity: 1, selectedTier: 16 }], fulfillment: delivery('NY'), subtotal: 87, shipping: 11.99 },
  ])('$name', async ({ items, fulfillment, subtotal, shipping }) => {
    const response = await post(checkout(items, fulfillment));
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({ subtotal, tax: 0, shipping, totalAmount: subtotal + shipping });
    expect(mocks.inserts).toHaveLength(2);
    const stored = JSON.parse(mocks.inserts[0][4] as string) as Array<{ lineTotal: number }>;
    expect(stored.reduce((sum, item) => sum + item.lineTotal, 0)).toBe(subtotal);
  });

  it('rejects the Assorted Box when its box stock is 0', async () => {
    mocks.getStockMap.mockResolvedValue({ 'sweet-assorted-box': 0 });
    const response = await post(checkout([assorted], pickup));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('sold out');
    expect(mocks.inserts).toHaveLength(0);
  });

  it('rejects more Assorted Boxes than are in stock', async () => {
    mocks.getStockMap.mockResolvedValue({ 'sweet-assorted-box': 2 });
    const response = await post(checkout([{ ...assorted, quantity: 3 }], pickup));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('Only 2');
    expect(mocks.inserts).toHaveLength(0);
  });

  it('accepts Assorted Boxes within stock', async () => {
    mocks.getStockMap.mockResolvedValue({ 'sweet-assorted-box': 2 });
    const response = await post(checkout([{ ...assorted, quantity: 2 }], pickup));
    expect(response.status).toBe(201);
    expect((await response.json()).subtotal).toBe(110);
  });

  it.each(['AL', 'CO', 'NC', 'WA'])('rejects the $30 gift box alone outside Texas (%s)', async (state) => {
    const response = await post(checkout([gift], delivery(state)));
    expect(response.status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
  });

  it('does not let a forged line total bypass the far-state minimum', async () => {
    const response = await post(checkout([{ ...sweet, lineTotal: 1000 }], delivery('NC')));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('$55.00');
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
    mocks.coupon.mockResolvedValue({ code: 'WELCOME', active: 1, coupon_type: 'complimentary', bonus_item: 'Malai Khaja', bonus_qty: 2, min_subtotal: 0 });
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


describe('Bobbatlu and Kova require next-day pickup regardless of stock', () => {
  const bobbatlu = { productId: 'sweet-bobbatlu', quantity: 1, selectedTier: 16 };
  const kovaBobbatlu = { productId: 'sweet-kova-bobbatlu', quantity: 1, selectedTier: 16 };
  const kova = { productId: 'sweet-kova', quantity: 1, selectedTier: 16 };

  it.each([0, 15, 16, 100])('requires tomorrow with %s Bobbatlu pieces in stock', async stock => {
    mocks.getStockMap.mockResolvedValue({ 'sweet-bobbatlu': stock });
    const response = await post(checkout([bobbatlu], { ...pickup, date: '2026-09-08' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Bobbatlu.*Kova.*tomorrow/i);
    expect(mocks.inserts).toHaveLength(0);
    expect((await post(checkout([bobbatlu], { ...pickup, date: '2026-09-09' }))).status).toBe(201);
    expect((await post(checkout([bobbatlu], delivery('TX')))).status).toBe(201);
  });

  it('requires tomorrow for fully stocked duplicate Bobbatlu lines', async () => {
    mocks.getStockMap.mockResolvedValue({ 'sweet-bobbatlu': 41 });
    const items = [bobbatlu, { ...bobbatlu, selectedTier: 25 }];
    expect((await post(checkout(items, { ...pickup, date: '2026-09-08' }))).status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
    expect((await post(checkout(items, { ...pickup, date: '2026-09-09' }))).status).toBe(201);
  });

  it.each([bobbatlu, kovaBobbatlu, kova])('requires tomorrow for $productId without an inventory count', async item => {
    expect((await post(checkout([item], { ...pickup, date: '2026-09-08' }))).status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
    expect((await post(checkout([item], { ...pickup, date: '2026-09-09' }))).status).toBe(201);
  });

  it.each([bobbatlu, kovaBobbatlu, kova])('requires tomorrow for mixed carts containing $productId despite forged metadata', async item => {
    mocks.getStockMap.mockResolvedValue({ 'sweet-bobbatlu': 100, 'sweet-kova-bobbatlu': 100, 'sweet-kova': 100 });
    const items = [sweet, { productId: 'pickle-chicken', quantity: 1 },
      { ...item, product: { id: 'sweet-malpuri', category: 'pickles' }, requiresNextDayPickup: false }];
    expect((await post({ ...checkout(items, { ...pickup, date: '2026-09-08' }), hasNextDayProduct: false })).status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
    expect((await post(checkout(items, { ...pickup, date: '2026-09-09' }))).status).toBe(201);
  });

  it.each([bobbatlu, kovaBobbatlu, kova])('keeps delivery available for $productId after 1:30 PM', async item => {
    vi.setSystemTime(new Date('2026-09-08T19:00:00Z'));
    expect((await post(checkout([item], { ...delivery('TX'), date: '2026-09-08' }))).status).toBe(201);
    expect(JSON.parse(mocks.inserts[0][5] as string)).not.toHaveProperty('date');
  });

  it.each([0, 15, 16, 100])('keeps Kova Bobbatlu purchasable at %s pieces but requires next-day pickup', async stock => {
    mocks.getStockMap.mockResolvedValue({ 'sweet-kova-bobbatlu': stock, 'sweet-bobbatlu': 100 });
    const sameDay = await post(checkout([kovaBobbatlu], { ...pickup, date: '2026-09-08' }));
    expect(sameDay.status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
    const nextDay = await post(checkout([kovaBobbatlu], { ...pickup, date: '2026-09-09' }));
    expect(nextDay.status).toBe(201);
    expect(await nextDay.json()).toMatchObject({ subtotal: 48, shipping: 0, tax: 0, totalAmount: 48 });
    const shipped = await post(checkout([kovaBobbatlu], delivery('TX')));
    expect(shipped.status).toBe(201);
    expect(await shipped.json()).toMatchObject({ subtotal: 48, shipping: 6.99, tax: 0, totalAmount: 54.99 });
  });
});


describe('pickle-only shipping counts canonical jar quantities', () => {
  it.each([
    {items:[{productId:'pickle-gongura-chicken',quantity:2}], subtotal:38,shipping:6.99,tax:3.71,totalAmount:48.70},
    {items:[{productId:'pickle-gongura-chicken',quantity:3}], subtotal:57,shipping:6.99,tax:5.28,totalAmount:69.27},
    {items:[{productId:'pickle-gongura-chicken',quantity:1},{productId:'pickle-chicken',quantity:1}],subtotal:37,shipping:6.99,tax:3.63,totalAmount:47.62},
    {items:[{productId:'pickle-gongura-chicken',quantity:1},{productId:'pickle-gongura-chicken',quantity:1}],subtotal:38,shipping:6.99,tax:3.71,totalAmount:48.70},
  ])('stores $shipping shipping for $subtotal of jars', async ({items,...expected}) => {
    const response=await post({...checkout(items,delivery('TX')),pickleJarCount:1,picklesOnly:false,shipping:0});
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject(expected);
    expect(JSON.parse(mocks.inserts[1][1] as string)).toMatchObject({
      shippingCents:Math.round(expected.shipping*100),taxableShippingCents:Math.round(expected.shipping*100),taxCents:Math.round(expected.tax*100),
      policyVersion:'2026-09-23-texas-coupon-v5',
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
    ['CA', 2, 38, 6.99, 3.14, 48.13],
    ['WA', 3, 57, 6.99, 4.70, 68.69],
    ['OK', 4, 76, 6.99, 6.27, 89.26],
  ] as const)('quotes %s %s jars below $80', async (state, quantity, subtotal, shipping, tax, totalAmount) => {
    const response = await post(checkout([{ productId: 'pickle-gongura-chicken', quantity }], delivery(state)));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal, shipping, tax, totalAmount });
    expect(JSON.parse(mocks.inserts[1][1] as string)).toMatchObject({
      shippingCents: Math.round(shipping * 100), taxableShippingCents: 0,
      taxCents: Math.round(tax * 100), policyVersion: '2026-09-23-texas-coupon-v5',
    });
  });
  it('keeps the $55 minimum on mixed carts even with forged category and flags', async () => {
    const response = await post({ ...checkout([
      { productId: 'sweet-kova', quantity: 1, selectedTier: 16, product: { category: 'pickles' } },
      { productId: 'pickle-gongura-chicken', quantity: 1 },
    ], delivery('NY')), picklesOnly: true });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('$55.00');
    expect(mocks.inserts).toHaveLength(0);
  });
  it.each(['AK', 'HI', 'PR'])('does not waive destination eligibility for %s pickles', async (state) => {
    const response = await post(checkout([{ productId: 'pickle-chicken', quantity: 1 }], delivery(state)));
    expect(response.status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
  });
});


describe('authoritative coupon benefits at payment', () => {
  const free = { code: 'SHIP', active: 1, coupon_type: 'free_delivery' as const, bonus_item: '', bonus_qty: 0, min_subtotal: 19 };
  it.each([['TX', 0, 22.72], ['OK', 6.99, 27.56], ['NY', 6.99, 27.56]])('quotes eligible pickle shipping in %s', async (state, shipping, total) => {
    mocks.coupon.mockResolvedValue(free);
    const response = await post({ ...checkout([{ productId: 'pickle-gongura-chicken', quantity: 1 }], delivery(String(state))), couponCode: 'ship' });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal: 19, shipping, tax: state === 'TX' ? 1.73 : 1.57, maintenanceFee: state === 'TX' ? 1.99 : 0, totalAmount: total });
    expect(JSON.parse(mocks.inserts[0][11] as string)).toEqual({ code: 'SHIP', type: 'free_delivery', minSubtotal: 19, shippingPolicy: 'texas_v3' });
    expect(JSON.parse(mocks.inserts[1][1] as string)).toMatchObject({ shippingCents: state === 'TX' ? 199 : 699, taxableShippingCents: state === 'TX' ? 199 : 0, taxCents: state === 'TX' ? 173 : 157 });
  });

  it.each([['TX', 0, 80.09], ['OK', 6.99, 84.93], ['NY', 6.99, 84.93]])('honors the admin minimum for four pickle jars in %s', async (state, shipping, total) => {
    mocks.coupon.mockResolvedValue({ ...free, min_subtotal: 70 });
    const response = await post({ ...checkout([{ productId: 'pickle-chicken', quantity: 4 }], delivery(String(state))), couponCode: 'ship' });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal: 72, shipping, tax: state === 'TX' ? 6.10 : 5.94, maintenanceFee: state === 'TX' ? 1.99 : 0, totalAmount: total,
      shippingQuote: { referenceShipping: 6.99, regularShipping: 6.99, quantitySavings: 0, couponSavings: state === 'TX' ? 6.99 : 0 } });
  });

  it.each([1, 2, 3])('rejects %s pickle jars below a $70 minimum', async quantity => {
    mocks.coupon.mockResolvedValue({ ...free, min_subtotal: 70 });
    const response = await post({ ...checkout([{ productId: 'pickle-mutton', quantity }], delivery('OK')), couponCode: 'SHIP', subtotal: 999 });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('This coupon requires a minimum cart value of $70.00 before tax and shipping.');
    expect(mocks.inserts).toHaveLength(0);
  });

  it.each([['TX', 0], ['OK', 8.99], ['NY', 11.99]])('charges mixed carts using the destination in %s', async (state, shipping) => {
    mocks.coupon.mockResolvedValue({ ...free, min_subtotal: 70 });
    const response = await post({ ...checkout([sweet, { productId: 'pickle-mutton', quantity: 2 }], delivery(String(state))), couponCode: 'SHIP' });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal: 82, shipping, tax: state === 'TX' ? 3.55 : 3.47, maintenanceFee: state === 'TX' ? 0.99 : 0 });
  });

  it.each(['TX', 'OK'])('accepts an exact $70 sweets/gift cart in %s', async state => {
    mocks.coupon.mockResolvedValue({ ...free, min_subtotal: 70 });
    const response = await post({ ...checkout([sweet, gift], delivery(state)), couponCode: 'SHIP' });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal: 70, shipping: state === 'TX' ? 0 : 8.99 });
  });

  it('rejects one cent below minimum despite inflated client totals and forged benefit', async () => {
    mocks.coupon.mockResolvedValue({ ...free, min_subtotal: 40.01 });
    const response = await post({ ...checkout([{ ...sweet, lineTotal: 1000 }], delivery('TX')), couponCode: 'SHIP', subtotal: 1000, minSubtotal: 0, freeDelivery: true });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('$40.01');
    expect(mocks.inserts).toHaveLength(0);
  });

  it('still enforces destination minimums for free-delivery coupons', async () => {
    mocks.coupon.mockResolvedValue(free);
    const response = await post({ ...checkout([sweet], delivery('NY')), couponCode: 'SHIP' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('$55.00');
  });

  it('rejects a free-delivery coupon for pickup', async () => {
    mocks.coupon.mockResolvedValue(free);
    expect((await post({ ...checkout(), couponCode: 'SHIP' })).status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
  });

  it.each([null, { ...free, active: 0 }])('rejects missing or disabled codes without creating a chargeable session', async coupon => {
    mocks.coupon.mockResolvedValue(coupon);
    expect((await post({ ...checkout([sweet], delivery('TX')), couponCode: 'SHIP' })).status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
  });

  it('ignores a forged free-delivery flag without a valid coupon', async () => {
    const response = await post({ ...checkout([sweet], delivery('TX')), freeDelivery: true, coupon: free });
    expect((await response.json()).shipping).toBe(6.99);
  });
});
