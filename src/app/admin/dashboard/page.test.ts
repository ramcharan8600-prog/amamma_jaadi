// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { currentShipWeek } from '@/lib/delivery-limit';
import TodayPage from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));

const thisWeek = currentShipWeek();
const order = (id: string, extra: Record<string, unknown> = {}) => ({
  id, order_number: `AJ-${id}`, customer_name: `Customer ${id}`, order_type: 'pickup', pickup_date: '2026-10-17',
  pickup_location: 'plano-biryanify', created_at: '2026-10-16 12:00:00', items: [{ product_name: 'Guntur Malpuri', quantity: 1, selected_tier: 16 }], ...extra,
});
const delivery = (id: string, ship_week: string | null) => order(id, { order_type: 'delivery', pickup_date: null, pickup_location: null, ship_week });

let responses: Record<string, unknown>;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  responses = {
    '/api/admin/production-plan': {
      days: [{ date: '2026-10-17', orders: [order('1001'), order('1002')] }, { date: '2026-10-18', orders: [order('1003')] }, { date: '2026-10-19', orders: [] }],
      delivery: [delivery('2001', thisWeek), delivery('2002', thisWeek), delivery('2003', '2026-01-05'), delivery('2004', null)],
    },
    '/api/admin/delivery-limit': { limit: 30, allFull: false, weeks: [{ week: '2099-01-05', days: 'Mon Jan 5 / Tue Jan 6', used: 12, full: false }] },
    '/api/delivery-pauses': { paused: ['far'] },
    '/api/inventory': { stock: {} },
    '/api/orders?filter=all&page=1&pageSize=5': { orders: [{ ...delivery('2001', thisWeek), total_price: 64.5 }] },
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === '/api/auth') return Response.json({ authenticated: true });
    if (path in responses) return Response.json(responses[path]);
    throw new Error(`Unexpected request: ${path}`);
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(TodayPage)));
  await act(async () => {});
}
const card = (label: string) => [...host.querySelectorAll('a')].find((a) => a.textContent?.startsWith(label))!;

it('shows pickups today and tomorrow, this week’s shipment and next week’s bookings, each linking to its list', async () => {
  await render();
  expect(host.querySelector('h1')?.textContent).toBe('Today');
  expect(card('Pickups today').textContent).toContain('2');
  expect(card('Pickups today').getAttribute('href')).toBe('/admin/orders?filter=today');
  expect(card('Pickups tomorrow').textContent).toContain('1');
  expect(card('This week’s shipment').textContent).toContain('2');
  expect(card('This week’s shipment').getAttribute('href')).toBe(`/admin/orders?shipWeek=${thisWeek}`);
  expect(card('Next week booked').textContent).toContain('12/30');
});

it('lists what needs attention: late or unscheduled deliveries, paused areas and sold-out stock', async () => {
  await render();
  const attention = host.querySelector('section[aria-labelledby="attention-title"]')!;
  const items = [...attention.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
  expect(items).toContainEqual(['1 delivery order is past its ship week and not shipped', '/admin/orders?shipmentStatus=yet_to_ship']);
  expect(items).toContainEqual(['1 delivery order has no ship week', '/admin/orders?shipWeek=none']);
  expect(items).toContainEqual(['Delivery is paused for far-away states', '/admin/settings']);
  expect(attention.textContent).toContain('Out of stock on the website:');
});

it('hides the attention box when all is well, and shows sweets to make and the newest orders', async () => {
  responses['/api/delivery-pauses'] = { paused: [] };
  const plan = responses['/api/admin/production-plan'] as { delivery: unknown[] };
  plan.delivery = plan.delivery.slice(0, 2);
  // Every tracked product in stock.
  const { PRODUCTS } = await import('@/data/products');
  responses['/api/inventory'] = { stock: Object.fromEntries(PRODUCTS.map((p) => [p.id, 10])) };
  await render();
  expect(host.querySelector('section[aria-labelledby="attention-title"]')).toBeNull();
  expect(host.querySelector('section[aria-labelledby="make-title"]')!.textContent).toContain('80Malpuri'); // 5 orders × 16
  const newest = host.querySelector('section[aria-labelledby="latest-title"]')!;
  expect(newest.querySelector('a[href="/admin/orders?q=AJ-2001"]')!.textContent).toContain('$64.50');
});
