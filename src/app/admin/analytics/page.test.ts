// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AnalyticsPage from './page';
import { getSalesTimeSeries } from '@/lib/sales-analytics';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));

let host: HTMLDivElement;
let root: Root;
let orderResponse: () => Promise<Response>;
let revenueResponse: (year: number) => Promise<Response>;
const orders = [
  { created_at: '2026-09-15 18:00:00', total_price: 100, refunded_amount: 20, payment_status: 'partially_refunded', order_items: [] },
  { created_at: '2026-09-12 18:00:00', total_price: 50, refunded_amount: 0, payment_status: 'paid', order_items: [] },
];
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const path = String(input);
  if (path === '/api/auth') return Response.json({ authenticated: true });
  if (path === '/api/auth/verify-pin') return Response.json({ verified: true });
  if (path === '/api/orders?filter=all') return orderResponse();
  if (path.startsWith('/api/admin/revenue?year=')) return revenueResponse(Number(path.split('=')[1]));
  throw new Error(`Unexpected request: ${path}`);
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T18:00:00Z'));
  vi.stubGlobal('fetch', fetchMock);
  orderResponse = async () => Response.json({ orders });
  revenueResponse = async year => Response.json({ year, pickleSalesByState: [], ...getSalesTimeSeries(orders, year) });
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
  expect(weekly.querySelectorAll('li')).toHaveLength(27);
  expect(chart('Monthly Revenue').textContent).toContain('$130.00');
  expect(chart('Monthly Revenue').querySelectorAll('li')).toHaveLength(6);
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
  expect(weekly.style.minWidth).toBe('648px');
  expect(host.textContent).toContain('July–December 2026');
  expect(weekly.querySelector('button')?.getAttribute('aria-label')).toContain('Jul 1, 2026 – Jul 5, 2026');
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
  revenueResponse = async year => Response.json({ year, pickleSalesByState: [], ...getSalesTimeSeries([], year) });
  await unlock();
  expect(host.textContent).toContain('No paid orders to display yet.');
  expect(chart('Weekly Revenue').querySelectorAll('li')).toHaveLength(27);
  expect(chart('Monthly Revenue').querySelectorAll('li')).toHaveLength(6);
  expect(chart('Orders by Day of Week').querySelectorAll('li')).toHaveLength(7);
  expect([...host.querySelectorAll<HTMLElement>('ul [aria-hidden="true"] > div, ul button > span')].every(bar => bar.style.height === '0px')).toBe(true);
});

it('switches both revenue charts between the six selectable years without reloading other analytics', async () => {
  revenueResponse = async year => Response.json({ year, pickleSalesByState: [], ...getSalesTimeSeries([
    ...orders, { ...orders[0], created_at: '2027-01-02 18:00:00', total_price: 207, refunded_amount: 0 },
  ], year) });
  await unlock();
  const selector = host.querySelector<HTMLSelectElement>('#revenue-year')!;
  expect(selector.value).toBe('2026');
  expect([...selector.options].map(option => option.value)).toEqual(['2026', '2027', '2028', '2029', '2030', '2031']);
  expect(chart('Monthly Revenue').textContent).toContain('Jul 26');
  expect(chart('Monthly Revenue').textContent).not.toContain('Jun 26');
  const ordersRequests = fetchMock.mock.calls.filter(([url]) => url === '/api/orders?filter=all').length;
  await act(async () => {
    selector.value = '2027';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(chart('Monthly Revenue').querySelectorAll('li')).toHaveLength(12);
  expect(chart('Monthly Revenue').textContent).toContain('Jan 27');
  expect(chart('Monthly Revenue').textContent).toContain('$207.00');
  expect(chart('Monthly Revenue').textContent).not.toContain('$130.00');
  expect(chart('Weekly Revenue').querySelectorAll('li')).toHaveLength(53);
  expect(chart('Weekly Revenue').querySelector('button')?.getAttribute('aria-label')).toContain('Jan 1, 2027 – Jan 3, 2027: $207.00');
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/orders?filter=all')).toHaveLength(ordersRequests);
  await act(async () => {
    selector.value = '2026';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(chart('Monthly Revenue').querySelectorAll('li')).toHaveLength(6);
  expect(chart('Monthly Revenue').textContent).toContain('$130.00');
});

it('ignores a slow response for a previously selected year', async () => {
  let resolvePrevious!: (response: Response) => void;
  revenueResponse = async year => year === 2027
    ? new Promise<Response>(resolve => { resolvePrevious = resolve; })
    : Response.json({ year, pickleSalesByState: [], ...getSalesTimeSeries([], year) });
  await unlock();
  const selector = host.querySelector<HTMLSelectElement>('#revenue-year')!;
  await act(async () => {
    selector.value = '2027'; selector.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.textContent).toContain('Loading 2027 charts');
  expect(host.querySelector('ul[aria-label="Monthly Revenue"]')).toBeNull();
  await act(async () => {
    selector.value = '2028'; selector.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => resolvePrevious(Response.json({ year: 2027, pickleSalesByState: [], ...getSalesTimeSeries(orders, 2027) })));
  expect(chart('Monthly Revenue').textContent).toContain('Jan 28');
  expect(chart('Monthly Revenue').textContent).not.toContain('Jan 27');
  expect(host.textContent).not.toContain('Loading 2027 charts');
});

it('lets a failed yearly revenue request retry without hiding the product charts', async () => {
  revenueResponse = async () => Response.json({ error: 'Unavailable' }, { status: 500 });
  await unlock();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Unable to load annual charts');
  expect(chart('Pickle Sales by Product')).toBeTruthy();
  expect(host.querySelector('ul[aria-label="Monthly Revenue"]')).toBeNull();
  revenueResponse = async year => Response.json({ year, pickleSalesByState: [], ...getSalesTimeSeries(orders, year) });
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Retry annual charts')!.click());
  expect(chart('Monthly Revenue').textContent).toContain('$130.00');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it('shows every pickle product with zero jars and places its full-width chart below monthly revenue', async () => {
  orderResponse = async () => Response.json({ orders: [] });
  await unlock();
  const pickles = chart('Pickle Sales by Product');
  const bars = [...pickles.querySelectorAll('li')];
  expect(bars).toHaveLength(4);
  expect(bars.map(bar => bar.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
    '0 jarsChicken Pickle',
    '0 jarsGongura Chicken Pickle',
    '0 jarsMutton Pickle',
    '0 jarsPrawns Pickle',
  ]);
  expect([...pickles.querySelectorAll<HTMLElement>('[aria-hidden="true"] > div')].every(bar => bar.style.height === '0px')).toBe(true);
  const pickleCard = pickles.closest('.card');
  const monthlyCard = chart('Monthly Revenue').closest('.card');
  expect(pickleCard?.parentElement).toBe(monthlyCard?.parentElement?.parentElement);
  expect(pickleCard?.previousElementSibling).toBe(monthlyCard?.parentElement);
  expect(pickleCard?.parentElement?.className).not.toContain('grid');
  expect(pickles.compareDocumentPosition(chart('Orders by Day of Week')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('counts jars in paid and partially refunded mixed orders without counting tiers, sweets, tests, or unpaid orders', async () => {
  const item = (product_name: string, quantity: number, selected_tier: number | null = null) => ({
    product_name, quantity, selected_tier, product_price: 19, line_total: 19 * quantity,
  });
  const order = (payment_status: string, order_items: ReturnType<typeof item>[], extra = {}) => ({
    created_at: '2026-09-15 18:00:00', total_price: 100, refunded_amount: 0,
    payment_status, order_items, ...extra,
  });
  orderResponse = async () => Response.json({ orders: [
    order('paid', [
      item('Chicken Pickle', 2, 12), item('Gongura Chicken Pickle', 1),
      item('Bobbatlu', 2, 16),
    ]),
    order('partially_refunded', [
      item('Chicken Pickle', 1), item('Mutton Pickle', 3), item('Prawns Pickle', 1),
    ], { refunded_amount: 20 }),
    order('paid', [item('Chicken Pickle', 99)], { is_test_order: 1 }),
    order('refunded', [item('Gongura Chicken Pickle', 99)], { refunded_amount: 100 }),
    order('pending', [item('Mutton Pickle', 99)]),
  ] });
  await unlock();
  const pickles = chart('Pickle Sales by Product');
  const bars = [...pickles.querySelectorAll('li')];
  expect(bars).toHaveLength(4);
  expect(bars.map(bar => bar.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
    '3 jarsChicken Pickle',
    '1 jarGongura Chicken Pickle',
    '3 jarsMutton Pickle',
    '1 jarPrawns Pickle',
  ]);
  expect(pickles.textContent).not.toContain('Bobbatlu');
  const heights = [...pickles.querySelectorAll<HTMLElement>('[aria-hidden="true"] > div')].map(bar => parseFloat(bar.style.height));
  expect(heights[0]).toBe(128);
  expect(heights[2]).toBe(128);
  expect(heights[1]).toBeCloseTo(128 / 3);
  expect(heights[3]).toBeCloseTo(128 / 3);
});

it('uses complete annual state totals and filters products without another request', async () => {
  orderResponse = async () => Response.json({ orders: [] });
  revenueResponse = async year => Response.json({
    year, ...getSalesTimeSeries([], year),
    pickleSalesByState: year === 2026 ? [{
      stateCode: 'MI', stateName: 'Michigan', jars: 302,
      products: [
        { productId: 'pickle-chicken', productName: 'Chicken Pickle', jars: 300 },
        { productId: 'pickle-mutton', productName: 'Mutton Pickle', jars: 2 },
      ],
    }] : [{
      stateCode: 'TX', stateName: 'Texas', jars: 4,
      products: [{ productId: 'pickle-chicken', productName: 'Chicken Pickle', jars: 4 }],
    }],
  });
  await unlock();
  expect(chart('Pickle Jars Sold by State').textContent).toContain('Michigan');
  expect(chart('Pickle Jars Sold by State').textContent).toContain('302');
  const requests = fetchMock.mock.calls.length;
  const product = host.querySelector<HTMLSelectElement>('#pickle-state-product')!;
  await act(async () => {
    product.value = 'pickle-mutton';
    product.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(chart('Pickle Jars Sold by State').textContent).toContain('2');
  expect(chart('Pickle Jars Sold by State').textContent).not.toContain('302');
  expect(fetchMock.mock.calls).toHaveLength(requests);
  const year = host.querySelector<HTMLSelectElement>('#revenue-year')!;
  await act(async () => {
    year.value = '2027';
    year.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(chart('Pickle Jars Sold by State').textContent).toContain('Texas');
  expect(chart('Pickle Jars Sold by State').textContent).not.toContain('Michigan');
  expect(host.querySelector<HTMLSelectElement>('#pickle-state-product')!.value).toBe('all');
  expect(fetchMock.mock.calls).toHaveLength(requests + 1);
});

it('reports an incomplete annual response instead of inventing zero state sales', async () => {
  revenueResponse = async year => Response.json({ year, ...getSalesTimeSeries(orders, year) });
  await unlock();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Unable to load annual charts');
  expect(host.querySelector('ul[aria-label="Pickle Jars Sold by State"]')).toBeNull();
  expect(chart('Pickle Sales by Product')).toBeTruthy();
});
