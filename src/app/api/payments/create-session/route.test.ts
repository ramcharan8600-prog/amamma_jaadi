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
const mini = { productId: 'gift-box-mini-combo', quantity: 1, selectedVariant: 'Assorted: 8 Malpuri + 8 Malai Khaja' };
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

describe('create-session only accepts current pickup locations', () => {
  it.each(['irving-biryanify', 'not-a-location', undefined])('rejects pickup at %j', async (locationId) => {
    const response = await post(checkout([sweet], { ...pickup, locationId }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Please choose one of our current pickup locations.');
    expect(mocks.inserts).toHaveLength(0);
  });

  it.each(['plano-biryanify', 'frisco-ravibabu', 'irving-ravibabu'])('accepts pickup at %s', async (locationId) => {
    const response = await post(checkout([sweet], { ...pickup, locationId }));
    expect(response.status).toBe(201);
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

  it('rejects a Tuesday pickup date', async () => {
    const response = await post(checkout([{ productId: 'pickle-chicken', quantity: 1 }], { ...pickup, date: '2026-09-15' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Tuesdays');
    expect(mocks.inserts).toHaveLength(0);
  });

  it.each(['2026-09-09', '2026-09-10', '2026-12-07'])('stores valid %s exactly', async (date) => {
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
    { name: 'pickup Mini Combo Pack', items: [mini], fulfillment: pickup, subtotal: 48, shipping: 0 },
    { name: 'Mini Combo Pack in Texas', items: [mini], fulfillment: delivery('TX'), subtotal: 48, shipping: 2.99 },
    { name: 'Mini Combo Pack to a nearby state', items: [mini], fulfillment: delivery('FL'), subtotal: 48, shipping: 4.99 },
    { name: 'nearby below $60', items: [sweet], fulfillment: delivery('AL'), subtotal: 40, shipping: 10.99 },
    { name: 'two Mini Combo Packs to a nearby state, per order', items: [{ ...mini, quantity: 2 }], fulfillment: delivery('CO'), subtotal: 96, shipping: 4.99 },
    { name: 'two Mini Combo Packs in Texas, per order', items: [{ ...mini, quantity: 2 }], fulfillment: delivery('TX'), subtotal: 96, shipping: 2.99 },
    { name: 'far at $80', items: [{ ...sweet, quantity: 2 }], fulfillment: delivery('NC'), subtotal: 80, shipping: 11.99 },
    { name: 'Florida (now nearby) below $60 with no minimum', items: [sweet], fulfillment: delivery('FL'), subtotal: 40, shipping: 10.99 },
    { name: 'Tennessee (now nearby) at $80', items: [{ ...sweet, quantity: 2 }], fulfillment: delivery('TN'), subtotal: 80, shipping: 8.99 },
    { name: 'Georgia (now nearby) at $120', items: [{ ...sweet, quantity: 3 }], fulfillment: delivery('GA'), subtotal: 120, shipping: 7.99 },
    { name: 'Oklahoma at exactly $100', items: [{ productId: 'sweet-kova', quantity: 1, selectedTier: 50 }], fulfillment: delivery('OK'), subtotal: 100, shipping: 7.99 },
    { name: 'Mini Combo Pack mixed with Malpuri pays nearby rates', items: [mini, sweet], fulfillment: delivery('OK'), subtotal: 88, shipping: 8.99 },
    { name: 'far at $82 with Kova boxes', items: [{ productId: 'sweet-kova', quantity: 1, selectedTier: 25 }, { productId: 'sweet-kova', quantity: 1, selectedTier: 16 }], fulfillment: delivery('WA'), subtotal: 82, shipping: 11.99 },
    { name: 'assorted box pickup', items: [assorted], fulfillment: pickup, subtotal: 60, shipping: 0 },
    { name: 'assorted box in Texas', items: [assorted], fulfillment: delivery('TX'), subtotal: 60, shipping: 6.99 },
    { name: 'assorted box alone to a nearby state', items: [assorted], fulfillment: delivery('FL'), subtotal: 60, shipping: 8.99 },
    { name: 'two assorted boxes to a nearby state', items: [{ ...assorted, quantity: 2 }], fulfillment: delivery('GA'), subtotal: 120, shipping: 8.99 },
    { name: 'assorted box alone to a far state, no minimum', items: [assorted], fulfillment: delivery('NY'), subtotal: 60, shipping: 9.99 },
    { name: 'two assorted boxes to a far state', items: [{ ...assorted, quantity: 2 }], fulfillment: delivery('CA'), subtotal: 120, shipping: 9.99 },
    { name: 'far assorted box plus Kova at $92', items: [assorted, { productId: 'sweet-kova', quantity: 1, selectedTier: 16 }], fulfillment: delivery('NY'), subtotal: 92, shipping: 11.99 },
  ])('$name', async ({ items, fulfillment, subtotal, shipping }) => {
    const response = await post(checkout(items, fulfillment));
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({ subtotal, tax: 0, shipping, totalAmount: subtotal + shipping });
    expect(mocks.inserts).toHaveLength(2);
    const stored = JSON.parse(mocks.inserts[0][4] as string) as Array<{ lineTotal: number }>;
    expect(stored.reduce((sum, item) => sum + item.lineTotal, 0)).toBe(subtotal);
  });

  it.each([
    ['TX', 6.99],
    ['FL', 9.99],
    ['NY', 9.99],
    ['CA', 9.99],
  ])('ships a Malai Khaja-only cart to %s for %s with no minimum', async (state, shipping) => {
    const response = await post(checkout([{ productId: 'sweet-malai-khaja', quantity: 1, selectedTier: 16 }], delivery(state)));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal: 40, tax: 0, shipping, totalAmount: 40 + shipping });
  });

  it('keeps the far-state minimum when Malai Khaja is mixed with another item', async () => {
    const response = await post(checkout([
      { productId: 'sweet-malai-khaja', quantity: 1, selectedTier: 16 },
      { productId: 'pickle-chicken', quantity: 1 },
    ], delivery('NY')));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Add $2.00 more');
    expect(mocks.inserts).toHaveLength(0);
  });

  it('uses the regular far-state rate for an Assorted Box mixed with a pickle', async () => {
    const response = await post(checkout([assorted, { productId: 'pickle-chicken', quantity: 1 }], delivery('NY')));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal: 78, tax: 1.49, shipping: 11.99, totalAmount: 91.48 });
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
    expect((await response.json()).subtotal).toBe(120);
  });

  it.each([
    ['alone', [gift], 'TX'],
    ['alone', [gift], 'AL'],
    ['in a $70 cart', [gift, sweet], 'TX'],
    ['in a $110 cart', [gift, { ...sweet, quantity: 2 }], 'NC'],
  ] as const)('refuses delivery of the pickup-only $30 box %s (%s)', async (_label, items, state) => {
    const response = await post(checkout(items, delivery(state)));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('is pickup only');
    expect(mocks.inserts).toHaveLength(0);
  });

  it.each([
    ['alone', [mini], 'NY'],
    ['in a $128 cart', [mini, { ...sweet, quantity: 2 }], 'CA'],
  ] as const)('refuses far-state delivery of the Mini Combo Pack %s (%s)', async (_label, items, state) => {
    const response = await post(checkout(items, delivery(state)));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('delivered within Texas and nearby states only');
    expect(mocks.inserts).toHaveLength(0);
  });

  it('ignores a forged product that drops the pickup-only rule', async () => {
    const response = await post(checkout([{ ...gift, product: { pickupOnly: false } }], delivery('TX')));
    expect(response.status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
  });

  it('does not let a forged line total bypass the far-state minimum', async () => {
    const response = await post(checkout([{ ...sweet, lineTotal: 1000 }], delivery('NC')));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('$60.00');
    expect(mocks.inserts).toHaveLength(0);
  });

  it('persists catalog names, prices, product restrictions and canonical line amounts', async () => {
    const response = await post(checkout([
      { ...sweet, product: { name: 'Fifty free boxes', unitPrice: 0 }, lineTotal: 9999 },
      { ...mini, product: { name: 'Forged gift', deliveryZones: ['texas', 'nearby', 'far'] }, lineTotal: -1 },
      { productId: 'pickle-chicken', quantity: 1, product: { name: 'Free jar' }, lineTotal: 0 },
    ], delivery('AL')));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal: 106, tax: 1.49, shipping: 7.99, totalAmount: 115.48 });
    const saved = JSON.parse(mocks.inserts[0][4] as string);
    expect(saved[0]).toEqual({ ...sweet, product: getProductById(sweet.productId), lineTotal: 40 });
    expect(saved[1]).toEqual({ ...mini, product: getProductById(mini.productId), lineTotal: 48 });
    expect(saved[2].lineTotal).toBe(18);
    expect(mocks.inserts[0][6]).toBe(115.48);
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
    { items: [mini], subtotal: 48, shipping: 2.99, tax: 0, totalAmount: 50.99 },
    { items: [mini, { productId: 'pickle-gongura-chicken', quantity: 1 }], subtotal: 67, shipping: 6.99, tax: 2.14, totalAmount: 76.13 },
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
    const mixed=await post({...checkout([mini,{productId:'pickle-gongura-chicken',quantity:2}],delivery('TX')),pickleJarCount:2,picklesOnly:true});
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
  it('keeps the $60 minimum on mixed carts even with forged category and flags', async () => {
    const response = await post({ ...checkout([
      { ...sweet, product: { category: 'pickles' } },
      { productId: 'pickle-gongura-chicken', quantity: 1 },
    ], delivery('NY')), picklesOnly: true });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('$60.00');
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
      shippingQuote: { referenceShipping: 6.99, regularShipping: 6.99, couponSavings: state === 'TX' ? 6.99 : 0 } });
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

  it.each(['TX', 'OK'])('accepts an exact $88 sweets/gift cart in %s', async state => {
    mocks.coupon.mockResolvedValue({ ...free, min_subtotal: 88 });
    const response = await post({ ...checkout([sweet, mini], delivery(state)), couponCode: 'SHIP' });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal: 88, shipping: state === 'TX' ? 0 : 8.99 });
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
    expect((await response.json()).error).toContain('$60.00');
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

describe('Bobbatlu pack prices', () => {
  it.each([[16, 48], [25, 70], [50, 135]])('charges %i Bobbatlu at $%i', async (tier, subtotal) => {
    const response = await post(checkout([{ productId: 'sweet-bobbatlu', quantity: 1, selectedTier: tier }], pickup));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal, shipping: 0, tax: 0, totalAmount: subtotal });
  });

  it.each([12, 20])('rejects a %i-piece Bobbatlu pack, which is not sold', async (tier) => {
    const response = await post(checkout([{ productId: 'sweet-bobbatlu', quantity: 1, selectedTier: tier }], pickup));
    expect(response.status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
  });
});

describe('Assorted Bobbatlu Box', () => {
  const box = { productId: 'sweet-assorted-bobbatlu-box', quantity: 1, selectedTier: 16 };

  it('costs $48.99 and needs a day of preparation for pickup', async () => {
    vi.setSystemTime(new Date('2026-09-08T15:00:00Z'));
    const sameDay = await post(checkout([box], { ...pickup, date: '2026-09-08' }));
    expect(sameDay.status).toBe(400);
    expect((await sameDay.json()).error).toContain('from tomorrow');
    const nextDay = await post(checkout([box], { ...pickup, date: '2026-09-09' }));
    expect(nextDay.status).toBe(201);
    expect(await nextDay.json()).toMatchObject({ subtotal: 48.99, tax: 0, shipping: 0, totalAmount: 48.99 });
  });

  it.each([['TX', 201, 6.99], ['OK', 201, 10.99], ['NY', 400, 0]])('follows the normal sweets delivery rules in %s', async (state, status, shipping) => {
    const response = await post(checkout([box], delivery(state)));
    expect(response.status).toBe(status);
    const body = await response.json();
    if (status === 201) expect(body).toMatchObject({ subtotal: 48.99, shipping, totalAmount: Math.round((48.99 + shipping) * 100) / 100 });
    else expect(body.error).toContain('Add $11.01 more');
  });
});

describe('Assorted Bobbatlu Box stock', () => {
  const box = { productId: 'sweet-assorted-bobbatlu-box', quantity: 1, selectedTier: 16 };
  it('rejects the box when its box stock is 0', async () => {
    mocks.getStockMap.mockResolvedValue({ 'sweet-assorted-bobbatlu-box': 0 });
    const response = await post(checkout([box], pickup));
    expect(response.status).toBe(409);
    expect(mocks.inserts).toHaveLength(0);
  });
  it('allows boxes within stock and rejects more than are left', async () => {
    mocks.getStockMap.mockResolvedValue({ 'sweet-assorted-bobbatlu-box': 2 });
    expect((await post(checkout([{ ...box, quantity: 2 }], pickup))).status).toBe(201);
    expect((await post(checkout([{ ...box, quantity: 3 }], pickup))).status).toBe(409);
  });
});

describe('far-state $60 minimum', () => {
  it.each([
    ['Malpuri 25', [{ ...sweet, selectedTier: 25 }], 62.5, 74.49],
    ['Bobbatlu 25', [{ productId: 'sweet-bobbatlu', quantity: 1, selectedTier: 25 }], 70, 81.99],
    ['Malpuri + Kova', [sweet, { productId: 'sweet-kova', quantity: 1, selectedTier: 16 }], 72, 83.99],
  ])('now accepts %s to a far state at $11.99', async (_name, items, subtotal, totalAmount) => {
    const response = await post(checkout(items, delivery('NY')));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal, shipping: 11.99, totalAmount });
  });

  it('still blocks a far-state sweets cart under $60', async () => {
    const response = await post(checkout([{ productId: 'sweet-bobbatlu', quantity: 1, selectedTier: 16 }], delivery('CA')));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('A minimum product subtotal of $60.00 is required for delivery to this state. Add $12.00 more to continue.');
  });
});

describe('Malai Khaja-only shipping by pack size', () => {
  const mk = (tier: number, quantity = 1) => ({ productId: 'sweet-malai-khaja', quantity, selectedTier: tier });
  it.each([
    ['16 to NY', [mk(16)], 'NY', 9.99],
    ['25 to NY', [mk(25)], 'NY', 8.99],
    ['50 to NY', [mk(50)], 'NY', 5.99],
    ['50 to GA', [mk(50)], 'GA', 5.99],
    ['50 to TX ($3.99 from $120)', [mk(50)], 'TX', 3.99],
    ['2 x 25 to CA', [mk(25, 2)], 'CA', 5.99],
    ['16 to TX', [mk(16)], 'TX', 6.99],
  ])('charges Malai Khaja %s at $%s', async (_name, items, state, shipping) => {
    const response = await post(checkout(items, delivery(String(state))));
    expect(response.status).toBe(201);
    expect((await response.json()).shipping).toBe(shipping);
  });

  it('uses the normal rules once anything else is in the cart', async () => {
    const response = await post(checkout([mk(50), sweet], delivery('NY')));
    expect(response.status).toBe(201);
    expect((await response.json()).shipping).toBe(11.99);
  });
});

describe('Bobbatlu Taste Pack add-on', () => {
  const pack = { productId: 'sweet-bobbatlu-taste-pack', quantity: 1, selectedTier: 8 };
  it('cannot be bought on its own', async () => {
    const response = await post(checkout([pack], delivery('TX')));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Bobbatlu Taste Pack can only be added to an order with other items.');
    expect(mocks.inserts).toHaveLength(0);
  });
  it('can only join an order with the 11:11 Assorted Box', async () => {
    const response = await post(checkout([sweet, pack], delivery('TX')));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Bobbatlu Taste Pack can only be added to an order with the Assorted Box — Malpuri & Malai Khaja.');
    expect(mocks.inserts).toHaveLength(0);
  });
  it.each([
    ['Texas', 'TX', 6.99],
    ['a nearby state', 'GA', 8.99],
    ['another nearby state', 'OK', 8.99],
    ['a far state', 'NY', 9.99],
  ])('adds $24 to the 11:11 box and ships at the box rate to %s', async (_name, state, shipping) => {
    const response = await post(checkout([assorted, pack], delivery(state)));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal: 84, shipping, totalAmount: Math.round((84 + shipping) * 100) / 100 });
  });
  it('keeps the regular rates when the box shares the cart with other sweets', async () => {
    const response = await post(checkout([assorted, sweet, pack], delivery('NY')));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ shipping: 11.99 });
  });
  it('rejects the old 6-piece size', async () => {
    expect((await post(checkout([assorted, { ...pack, selectedTier: 6 }], delivery('TX')))).status).toBe(400);
  });
  it('lifts a $60 Assorted Box cart over a $70 Texas shipping coupon', async () => {
    mocks.coupon.mockResolvedValue({ code: 'SHIP', active: 1, coupon_type: 'free_delivery', bonus_item: '', bonus_qty: 0, min_subtotal: 70 });
    const response = await post({ ...checkout([assorted, pack], delivery('TX')), couponCode: 'SHIP' });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal: 84, shipping: 0, maintenanceFee: 0.99, totalAmount: 84.99 });
  });
  it('needs a day of preparation for pickup', async () => {
    vi.setSystemTime(new Date('2026-09-08T15:00:00Z'));
    expect((await post(checkout([assorted, pack], { ...pickup, date: '2026-09-08' }))).status).toBe(400);
    expect((await post(checkout([assorted, pack], { ...pickup, date: '2026-09-09' }))).status).toBe(201);
  });
});

describe('$3.99 Texas shipping from $120 without a coupon', () => {
  it.each([
    ['sweets', [{ ...sweet, quantity: 3 }], 120, 0, 123.99],
    ['pickles only', [{ productId: 'pickle-chicken', quantity: 7 }], 126, 10.72, 140.71],
  ])('ships %s for $3.99 with no operational fee', async (_name, items, subtotal, tax, totalAmount) => {
    const response = await post(checkout(items, delivery('TX')));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ subtotal, tax, shipping: 3.99, totalAmount });
    expect(body.maintenanceFee ?? 0).toBe(0);
  });
  it('keeps $6.99 under $120 and in other states', async () => {
    expect(await (await post(checkout([{ ...sweet, quantity: 2 }], delivery('TX')))).json()).toMatchObject({ shipping: 6.99, totalAmount: 86.99 });
    const ga = await (await post(checkout([{ ...sweet, quantity: 3 }], delivery('GA')))).json();
    expect(ga).toMatchObject({ shipping: 7.99, totalAmount: 127.99 });
    expect(ga.maintenanceFee ?? 0).toBe(0);
  });
});

describe('Texas shipping coupon on boxes and ground-shipped carts', () => {
  const coupon70 = { code: 'SHIP', active: 1, coupon_type: 'free_delivery' as const, bonus_item: '', bonus_qty: 0, min_subtotal: 70 };
  it.each([
    ['two 11:11 Assorted Boxes', [{ ...assorted, quantity: 2 }], 120],
    ['Assorted Box + Malai Khaja 16', [assorted, { productId: 'sweet-malai-khaja', quantity: 1, selectedTier: 16 }], 100],
    ['Malai Khaja 50', [{ productId: 'sweet-malai-khaja', quantity: 1, selectedTier: 50 }], 125],
    ['two Assorted Bobbatlu Boxes', [{ productId: 'sweet-assorted-bobbatlu-box', quantity: 2, selectedTier: 16 }], 97.98],
  ])('ships %s free in Texas at $70+ with the $0.99 fee', async (_name, items, subtotal) => {
    mocks.coupon.mockResolvedValue(coupon70);
    const response = await post({ ...checkout(items, delivery('TX')), couponCode: 'SHIP' });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ subtotal, shipping: 0, maintenanceFee: 0.99, totalAmount: Math.round((subtotal + 0.99) * 100) / 100 });
  });
  it('refuses the coupon for a single 11:11 box below $70', async () => {
    mocks.coupon.mockResolvedValue(coupon70);
    const response = await post({ ...checkout([assorted], delivery('TX')), couponCode: 'SHIP' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('$70.00');
  });
});

