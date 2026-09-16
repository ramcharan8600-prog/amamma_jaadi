// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AnalyticsPage from './page';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));

let host: HTMLDivElement;
let root: Root;
let orderResponse: () => Promise<Response>;
const orders = [
  { created_at: '2026-09-15 18:00:00', total_price: 100, refunded_amount: 20, payment_status: 'partially_refunded', order_items: [] },
  { created_at: '2026-09-12 18:00:00', total_price: 50, refunded_amount: 0, payment_status: 'paid', order_items: [] },
];
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const path = String(input);
  if (path === '/api/auth') return Response.json({ authenticated: true });
  if (path === '/api/auth/verify-pin') return Response.json({ verified: true });
  if (path === '/api/orders?filter=all') return orderResponse();
  throw new Error(`Unexpected request: ${path}`);
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T18:00:00Z'));
  vi.stubGlobal('fetch', fetchMock);
  orderResponse = async () => Response.json({ orders });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function unlock() {
  await act(async () => root.render(createElement(AnalyticsPage)));
  const button = [...host.querySelectorAll('button')].find(el => el.textContent === 'Unlock Analytics');
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}

function chart(name: string) {
  const list = host.querySelector<HTMLUListElement>(`ul[aria-label="${name}"]`);
  expect(list).toBeTruthy();
  return list!;
}

it('renders real values and definite bar heights for all three charts after loading orders', async () => {
  await unlock();
  const weekly = chart('Weekly Revenue');
  expect(weekly.querySelector('button[aria-label*="$80.00"]')).toBeTruthy();
  expect(weekly.querySelector('button[aria-label*="$50.00"]')).toBeTruthy();
  expect(weekly.querySelectorAll('li')).toHaveLength(52);
  expect(chart('Monthly Revenue').textContent).toContain('$130.00');
  expect(chart('Monthly Revenue').querySelectorAll('li')).toHaveLength(12);
  const days = chart('Orders by Day of Week');
  expect(days.querySelectorAll('li')).toHaveLength(7);
  expect([...days.querySelectorAll('li')].find(el => el.textContent?.includes('Tue'))?.textContent).toBe('1Tue');
  expect([...days.querySelectorAll('li')].find(el => el.textContent?.includes('Sat'))?.textContent).toBe('1Sat');
  for (const list of [weekly, chart('Monthly Revenue'), days]) {
    const plots = [...list.querySelectorAll<HTMLElement>(list === weekly ? 'button' : '[aria-hidden="true"]')];
    expect(plots.every(plot => plot.style.height === '128px')).toBe(true);
    expect(plots.some(plot => (plot.firstElementChild as HTMLElement).style.height === '128px')).toBe(true);
  }
  expect(host.textContent).toContain('US Central time');
  expect(fetchMock.mock.calls.every(([input]) => !String(input).includes('/payments'))).toBe(true);
  expect(weekly.closest('.card')?.parentElement).toBe(chart('Monthly Revenue').closest('.card')?.parentElement);
  expect(weekly.closest('.card')?.parentElement?.className).toContain('space-y-6');
  expect(weekly.style.minWidth).toBe('1248px');
  expect(host.textContent).toContain('Last 52 weeks');
  expect(host.textContent).toContain('Last 12 calendar months');
  const previousWeek = weekly.querySelector<HTMLButtonElement>('button[aria-label*="$50.00"]')!;
  await act(async () => previousWeek.click());
  expect(host.querySelector('[role="status"]')?.textContent).toBe('Sep 7, 2026 – Sep 13, 2026: $50.00');
});

it.each(['http', 'network', 'invalid'] as const)('shows a retryable error instead of blank charts for a %s failure', async (failure) => {
  orderResponse = async () => {
    if (failure === 'network') throw new Error('offline');
    return failure === 'http' ? Response.json({ error: 'Failure' }, { status: 500 }) : Response.json({});
  };
  await unlock();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Unable to load sales data');
  expect(host.querySelector('ul[aria-label="Weekly Revenue"]')).toBeNull();
  expect(host.textContent).not.toContain('Loading analytics');
  orderResponse = async () => Response.json({ orders });
  const retry = [...host.querySelectorAll('button')].find(el => el.textContent === 'Try again')!;
  await act(async () => retry.click());
  expect(chart('Monthly Revenue').textContent).toContain('$130.00');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it('excludes owner-confirmed production tests from every sales total and chart', async () => {
  orderResponse = async () => Response.json({ orders: [...orders, {
    created_at: '2026-09-15 18:00:00', total_price: 88.77, refunded_amount: 0,
    payment_status: 'paid', is_test_order: 1,
    order_items: [{ product_name: 'Dummy pickle', line_total: 82, quantity: 1 }],
  }] });
  await unlock();
  expect(chart('Monthly Revenue').textContent).toContain('$130.00');
  expect(chart('Weekly Revenue').querySelector('button[aria-label*="$80.00"]')).toBeTruthy();
  expect([...chart('Orders by Day of Week').querySelectorAll('li')].find(el => el.textContent?.includes('Tue'))?.textContent).toBe('1Tue');
  expect(host.textContent).not.toContain('Dummy pickle');
  expect(host.textContent).not.toContain('$218.77');
  expect(host.textContent).toContain('Owner-confirmed test orders are excluded');
});

it('distinguishes empty order history from a failed request and displays zero buckets', async () => {
  orderResponse = async () => Response.json({ orders: [] });
  await unlock();
  expect(host.textContent).toContain('No paid orders to display yet.');
  expect(chart('Weekly Revenue').querySelectorAll('li')).toHaveLength(52);
  expect(chart('Monthly Revenue').querySelectorAll('li')).toHaveLength(12);
  expect(chart('Orders by Day of Week').querySelectorAll('li')).toHaveLength(7);
  expect([...host.querySelectorAll<HTMLElement>('ul [aria-hidden="true"] > div, ul button > span')].every(bar => bar.style.height === '0px')).toBe(true);
});
