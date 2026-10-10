// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProductionPlanningPage from './page';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));

const order = (n: string, items: Array<[string, number, number | null]>, extra = {}) => ({
  id: n, order_number: `AJ-${n}`, customer_name: `Customer ${n}`, order_type: 'pickup', pickup_date: '2026-10-10',
  pickup_location: 'plano-biryanify', created_at: '2026-10-09 12:00:00',
  items: items.map(([product_name, quantity, selected_tier]) => ({ product_name, quantity, selected_tier })),
  ...extra,
});
const plan = {
  days: [
    { date: '2026-10-10', orders: [
      order('1001', [['Guntur Malpuri', 2, 16], ['Chicken Pickle', 1, null]]),
      order('1002', [['Sweet Memories Gift Box (Texas Limited Edition) (Mix: 6 Malpuri + 6 Malai Khaja)', 1, null]]),
    ] },
    { date: '2026-10-11', orders: [order('1003', [['Bobbatlu', 1, 10]], { pickup_date: '2026-10-11', pickup_location: 'frisco-ravibabu' })] },
    { date: '2026-10-13', orders: [] },
  ],
  delivery: [order('1004', [['Nellore Malai Khaja', 1, 25]], { order_type: 'delivery', pickup_date: null, pickup_location: null })],
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === '/api/auth') return Response.json({ authenticated: true });
    if (path === '/api/admin/production-plan') return Response.json(plan);
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
  await act(async () => root.render(createElement(ProductionPlanningPage)));
  await act(async () => {});
}
const card = (title: string) => [...host.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === title)!;

it('shows the 3-day total and what to make today, tomorrow and the day after', async () => {
  await render();
  expect(host.querySelector('h1')?.textContent).toBe('Production Planning');
  const total = card('Total for the next 3 days').textContent;
  expect(total).toContain('38pcsMalpuri');      // 32 loose + 6 in the box
  expect(total).toContain('31pcsMalai Khaja');  // 6 in the box + 25 delivery
  expect(total).toContain('10pcsBobbatlu');

  const today = card('Today');
  expect(today.textContent).toContain('Pickup · Sat, Oct 10');
  expect(today.textContent).toContain('2 orders');
  expect(today.textContent).toContain('38pcsMalpuri');
  expect(today.textContent).toContain('Chicken Pickle1 jar');
  expect(card('Tomorrow').textContent).toContain('10pcsBobbatlu');
  const dayAfter = card('Day after tomorrow');
  expect(dayAfter.textContent).toContain('Pickup is closed on Tuesdays.');
  expect(dayAfter.textContent).toContain('No orders yet.');
  const delivery = card('Delivery orders waiting to ship');
  expect(delivery.textContent).toContain('25pcsMalai Khaja');
  await act(async () => [...delivery.querySelectorAll('button')].find((b) => b.textContent?.includes('Show orders'))!.click());
  expect(delivery.textContent).toContain('AJ-1004 · Customer 1004 · Delivery · ordered Fri, Oct 9');
});

it('expands each day to its order numbers and items', async () => {
  await render();
  const today = card('Today');
  const toggle = [...today.querySelectorAll('button')].find((b) => b.textContent?.includes('Show orders (2)'))!;
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const orders = [...today.querySelectorAll('ul[id$="-orders"] > li')].map((li) => li.textContent);
  expect(orders[0]).toContain('AJ-1001 · Customer 1001 · Biryanify - Plano');
  expect(orders[0]).toContain('Guntur Malpuri (16 pcs) × 2');
  expect(orders[0]).toContain('Chicken Pickle × 1');
  expect(orders[1]).toContain('Sweet Memories Gift Box (Texas Limited Edition) (Mix: 6 Malpuri + 6 Malai Khaja) × 1');
  await act(async () => toggle.click());
  expect(today.querySelector('ul[id$="-orders"]')).toBeNull();
});
