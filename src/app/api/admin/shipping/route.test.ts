import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authed: true,
  labels: {
    loadShippingOrder: vi.fn(), quoteLabel: vi.fn(), purchaseLabel: vi.fn(), voidOrderLabel: vi.fn(),
    releaseStuckLabel: vi.fn(), setShipRoute: vi.fn(),
  },
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (mocks.authed ? { value: 'valid' } : undefined) }) }));
vi.mock('@/lib/session', () => ({ SESSION_COOKIE: 'session', verifySessionToken: () => true }));
vi.mock('@/lib/db', () => ({ getDb: () => ({}), isDbConfigured: () => true }));
vi.mock('@/lib/shipping-env', () => ({ shippoApiKey: () => 'test-key', shopShippingEmail: () => 'shop@example.com' }));
vi.mock('@/lib/shipping-labels', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/shipping-labels')>(), ...mocks.labels }));
import { GET, POST } from './route';
import { ShippingError } from '@/lib/shipping-labels';

const post = (body: unknown) => POST(new Request('https://shop.test/api/admin/shipping', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  mocks.authed = true;
  for (const fn of Object.values(mocks.labels)) fn.mockReset();
});
afterEach(() => vi.restoreAllMocks());

it('is admin only', async () => {
  mocks.authed = false;
  expect((await GET(new Request('https://shop.test/api/admin/shipping?orderId=1'))).status).toBe(401);
  expect((await post({ action: 'quote', orderId: '1' })).status).toBe(401);
  expect(mocks.labels.quoteLabel).not.toHaveBeenCalled();
});

it('loads the order with boxes, the $20 limit and whether Shippo is connected', async () => {
  mocks.labels.loadShippingOrder.mockResolvedValue({ id: '1', orderNumber: 'AJ-1' });
  const res = await GET(new Request('https://shop.test/api/admin/shipping?orderId=1'));
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  expect(await res.json()).toMatchObject({ order: { orderNumber: 'AJ-1' }, priceLimit: 20, shippoConfigured: true, boxes: expect.any(Array) });
});

it('passes each action to the label workflow with the server-side key and shop inbox', async () => {
  mocks.labels.quoteLabel.mockResolvedValue({ rates: [] });
  await post({ action: 'quote', orderId: '1', box: '9x9x6', weightLb: '2.4', shipDate: '2026-10-12' });
  expect(mocks.labels.quoteLabel).toHaveBeenCalledWith({}, 'test-key', { orderId: '1', box: '9x9x6', weightLb: 2.4, shipDate: '2026-10-12' });

  mocks.labels.purchaseLabel.mockResolvedValue({ id: 'l1', status: 'purchased' });
  expect(await (await post({ action: 'buy', orderId: '1', rateId: 'r1', shipDate: '2026-10-12', confirmOverLimit: true })).json())
    .toEqual({ label: { id: 'l1', status: 'purchased' } });
  expect(mocks.labels.purchaseLabel).toHaveBeenCalledWith({}, 'test-key', expect.objectContaining({
    orderId: '1', rateId: 'r1', confirmOverLimit: true, shopEmail: 'shop@example.com',
  }));

  await post({ action: 'route', orderId: '1', route: 'pirate_ship' });
  await post({ action: 'route', orderId: '1', route: 'anything-else' });
  expect(mocks.labels.setShipRoute.mock.calls.map((c) => c[2])).toEqual(['pirate_ship', null]);
  await post({ action: 'void', orderId: '1' });
  await post({ action: 'release', orderId: '1' });
  expect(mocks.labels.voidOrderLabel).toHaveBeenCalledOnce();
  expect(mocks.labels.releaseStuckLabel).toHaveBeenCalledOnce();
});

it('answers workflow refusals with their message and code', async () => {
  mocks.labels.purchaseLabel.mockRejectedValue(new ShippingError('Over $20, confirm.', 'CONFIRM_OVER_LIMIT', 409));
  const res = await post({ action: 'buy', orderId: '1', rateId: 'r1' });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'Over $20, confirm.', code: 'CONFIRM_OVER_LIMIT' });
  expect((await post({ action: 'nope', orderId: '1' })).status).toBe(400);
  expect((await post({ action: 'quote' })).status).toBe(400);
});
