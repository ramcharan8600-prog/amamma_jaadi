// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OrdersPage from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));

let host: HTMLDivElement;
let productionLines: Array<{ product_name: string; selected_tier: number | null; quantity: number }> = [];
let root: Root;

// 60 pickup orders, newest first: AJ-1060 … AJ-1001.
const orders = Array.from({ length: 60 }, (_, i) => ({
  id: `order-${60 - i}`,
  order_number: `AJ-${1060 - i}`,
  customer_name: `Customer ${60 - i}`,
  phone_number: '2145550100',
  order_type: 'pickup',
  pickup_date: '2026-09-30',
  pickup_location: 'plano-biryanify',
  total_price: 40,
  tax: 0,
  payment_status: 'paid',
  status: 'confirmed',
  created_at: '2026-09-28 12:00:00',
  order_items: [],
}));

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const path = String(input);
  if (path === '/api/auth') return Response.json({ authenticated: true });
  if (path === '/api/orders/note') return Response.json({ success: true, note: 'On hold until he asks' });
  if (path === '/api/orders/ship-week') return Response.json({ success: true });
  if (path.startsWith('/api/admin/shipping?orderId=')) {
    return Response.json({ order: { id: 'd1', orderNumber: 'AJ-2001', customerName: 'Far Buyer', items: [], labels: [], activeLabel: null,
      route: 'pirate_ship', autoRoute: 'pirate_ship', routeReason: 'Far state with Malpuri', routeOverride: null, shipmentStatus: 'yet_to_ship',
      addressText: '9 Way\nNew York, NY 10001', shippingPaid: 11.99, createdAt: '2026-10-09 15:00:00' },
      boxes: [], priceLimit: 20, defaultShipDate: '2026-10-12', shippoConfigured: true });
  }
  if (path.startsWith('/api/orders/production?')) {
    return Response.json({ orderCounts: { pickup: orders.length, delivery: 0 }, lines: productionLines });
  }
  if (path.startsWith('/api/orders?')) {
    // Pages like the server: newest first, `pageSize` at a time, with the total.
    const params = new URL(path, 'https://shop.test').searchParams;
    const pageSize = Number(params.get('pageSize') ?? 200);
    const page = Number(params.get('page') ?? 1);
    return Response.json({ orders: orders.slice((page - 1) * pageSize, page * pageSize), total: orders.length, page, pageSize });
  }
  throw new Error(`Unexpected request: ${path}`);
});

beforeEach(() => {
  vi.clearAllMocks();
  productionLines = [];
  vi.stubGlobal('fetch', fetchMock);
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const rows = () => [...host.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.textContent);
const pageButton = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('nav[aria-label="Orders pages"] button')]
    .find((b) => b.textContent === label)!;

async function render() {
  await act(async () => root.render(createElement(OrdersPage)));
  await act(async () => {});
}

it('shows 25 orders per page with page numbers to browse', async () => {
  await render();
  expect(rows()).toHaveLength(25);
  expect(rows()[0]).toBe('AJ-1060');
  expect(host.textContent).toContain('Showing 1–25 of 60 orders');
  expect([...host.querySelectorAll('nav[aria-label="Orders pages"] button')].map((b) => b.textContent))
    .toEqual(['Previous', '1', '2', '3', 'Next']);
  expect(pageButton('1').getAttribute('aria-current')).toBe('page');
  expect(pageButton('Previous').disabled).toBe(true);

  await act(async () => pageButton('2').click());
  expect(rows()).toHaveLength(25);
  expect(rows()[0]).toBe('AJ-1035');
  expect(host.textContent).toContain('Showing 26–50 of 60 orders');

  await act(async () => pageButton('Next').click());
  expect(rows()).toHaveLength(10);
  expect(rows().at(-1)).toBe('AJ-1001');
  expect(host.textContent).toContain('Showing 51–60 of 60 orders');
  expect(pageButton('Next').disabled).toBe(true);

  await act(async () => pageButton('Previous').click());
  expect(host.textContent).toContain('Showing 26–50 of 60 orders');
});

it('returns to page 1 when a filter changes', async () => {
  await render();
  await act(async () => pageButton('3').click());
  expect(host.textContent).toContain('Showing 51–60 of 60 orders');
  const all = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'All')!;
  await act(async () => all.click());
  await act(async () => {});
  expect(host.textContent).toContain('Showing 1–25 of 60 orders');
  expect(rows()[0]).toBe('AJ-1060');
});

it('hides page numbers when everything fits on one page', async () => {
  orders.splice(20);
  await render();
  expect(rows()).toHaveLength(20);
  expect(host.textContent).toContain('Showing 1–20 of 20 orders');
  expect(host.querySelectorAll('nav[aria-label="Orders pages"] button')).toHaveLength(0);
});

it('pages through more than 200 orders from the server, with compact page buttons', async () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ ...orders[0], id: `big-${i}`, order_number: `AJ-${5300 - i}` }));
  orders.splice(0, orders.length, ...many);
  await render();
  expect(host.textContent).toContain('Showing 1–25 of 300 orders');
  expect([...host.querySelectorAll('nav[aria-label="Orders pages"] button')].map((b) => b.textContent))
    .toEqual(['Previous', '1', '2', '3', '12', 'Next']);
  await act(async () => pageButton('12').click());
  await act(async () => {});
  expect(host.textContent).toContain('Showing 276–300 of 300 orders');
  expect(rows().at(-1)).toBe('AJ-5001');
});

it('is its own page with a way back to the dashboard and to Production Planning', async () => {
  await render();
  expect(host.querySelector('h1')?.textContent).toContain('All Orders');
  expect(host.querySelector('a[href="/admin/dashboard"]')?.textContent).toContain('Back to dashboard');
  expect(host.querySelector('a[href="/admin/production"]')?.textContent).toContain('Production Planning');
});

it('shows sweets to make (boxes included) and what to pack for every matching order', async () => {
  productionLines = [
    { product_name: 'Assorted Box — Malpuri & Malai Khaja', selected_tier: 20, quantity: 2 },
    { product_name: 'Guntur Malpuri', selected_tier: 16, quantity: 1 },
    { product_name: 'Chicken Pickle', selected_tier: null, quantity: 3 },
  ];
  await render();
  const make = host.querySelector('section[aria-labelledby="sweets-to-make"]')!.textContent;
  expect(make).toContain('36pcsMalpuri');
  expect(make).toContain('20pcsMalai Khaja');
  const pack = host.querySelector('section[aria-labelledby="items-to-pack"]')!.textContent;
  expect(pack).toContain('Chicken Pickle3 jars');
  expect(pack).toContain('Guntur Malpuri (16 pcs)1 pack');
});

it('gives each delivery order a Ship button with its route or label, opening the Ship panel', async () => {
  const delivery = (id: string, number: string, extra: Record<string, unknown>) => ({
    ...orders[0], id, order_number: number, order_type: 'delivery', pickup_date: null, pickup_location: null,
    delivery_address: '1 Main St\nDallas, TX 75201\nUSA', order_items: [{ product_name: 'Guntur Malpuri', quantity: 1, selected_tier: 16 }], ...extra,
  });
  orders.splice(0, orders.length, ...[
    delivery('d1', 'AJ-2001', { delivery_address: '9 Way\nNew York, NY 10001\nUSA' }),
    delivery('d2', 'AJ-2002', {}),
    delivery('d3', 'AJ-2003', { label_status: 'purchased', label_service: 'UPS Ground', label_amount: 7.85 }),
  ] as unknown as typeof orders);
  await render();
  const cell = (n: string) => [...host.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('td')?.textContent?.startsWith(n))!.querySelector('td')!;
  expect(cell('AJ-2001').textContent).toContain('Pirate Ship');
  expect(cell('AJ-2002').textContent).toContain('Shippo');
  expect(cell('AJ-2003').textContent).toContain('Label · UPS Ground $7.85');
  // Pickup orders have no Ship button.
  expect(host.querySelectorAll('button[aria-label^="Ship AJ-"]')).toHaveLength(3);

  await act(async () => cell('AJ-2001').querySelector('button')!.click());
  await act(async () => {});
  const panel = host.querySelector('[role="dialog"]')!;
  expect(panel.getAttribute('aria-label')).toBe('Ship AJ-2001');
  expect(panel.textContent).toContain('Ship this order on Pirate Ship');
});

it('has a Note column the owner can type into, saved when the box is left', async () => {
  orders.splice(0, orders.length, { ...orders[0], id: 'n1', order_number: 'AJ-3001', admin_note: 'Free Kova 16' } as unknown as typeof orders[number]);
  await render();
  expect([...host.querySelectorAll('thead th')].map((th) => th.textContent)).toContain('Note');
  const box = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note for AJ-3001"]')!;
  expect(box.value).toBe('Free Kova 16');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'On hold until he asks');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { box.focus(); box.blur(); });
  await act(async () => {});
  const call = fetchMock.mock.calls.find(([input]) => String(input) === '/api/orders/note')!;
  expect(JSON.parse(String(((call as unknown[])[1] as RequestInit).body))).toEqual({ orderId: 'n1', note: 'On hold until he asks' });
  expect(host.textContent).toContain('Saved');
});

it('has a Ship week column for delivery orders that saves a new week right away', async () => {
  orders.splice(0, orders.length, ...[
    { ...orders[0], id: 'w1', order_number: 'AJ-4001', order_type: 'delivery', pickup_date: null, pickup_location: null,
      delivery_address: '1 Main St\nDallas, TX 75201\nUSA', ship_week: '2026-10-19' },
    { ...orders[0], id: 'w2', order_number: 'AJ-4002', order_type: 'pickup', pickup_date: '2026-10-20', pickup_location: 'plano-biryanify' },
  ] as unknown as typeof orders);
  await render();
  expect([...host.querySelectorAll('thead th')].map((th) => th.textContent)).toContain('Ship week');
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Ship week for AJ-4001"]')!;
  expect(select.value).toBe('2026-10-19');
  expect(host.querySelector('select[aria-label="Ship week for AJ-4002"]')).toBeNull(); // pickup
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, '2026-10-26');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {});
  const call = fetchMock.mock.calls.find(([input]) => String(input) === '/api/orders/ship-week')!;
  expect(JSON.parse(String(((call as unknown[])[1] as RequestInit).body))).toEqual({ orderId: 'w1', shipWeek: '2026-10-26' });
  expect(host.textContent).toContain('Saved');
});
