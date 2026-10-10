// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DashboardPage from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));
vi.mock('@/components/admin/InventoryPanel', () => ({ default: () => null }));

let host: HTMLDivElement;
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
  if (path.startsWith('/api/orders/production?')) {
    return Response.json({ orderCounts: { pickup: orders.length, delivery: 0 }, lines: [] });
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
  await act(async () => root.render(createElement(DashboardPage)));
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
