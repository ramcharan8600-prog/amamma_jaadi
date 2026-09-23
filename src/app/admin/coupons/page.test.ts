// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import CouponsPage from './page';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));
let root: Root;
let host: HTMLDivElement;
const coupon = { code: 'SHIP', influencer_name: 'Test', coupon_type: 'free_delivery', min_subtotal: 40, bonus_item: '', bonus_qty: 0, active: 1 };
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (url, init) => {
  if (url === '/api/auth') return Response.json({ success: true });
  if (init?.method === 'POST' || init?.method === 'PATCH') return Response.json({ success: true });
  return Response.json({ coupons: [coupon], analytics: [] });
});
async function setValue(selector: string, value: string) {
  const field = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  const prototype = field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
async function click(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find(node => node.textContent?.trim() === text)!;
  await act(async () => button.click());
}
beforeEach(async () => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(CouponsPage)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('creates free delivery with the entered minimum and hides complimentary fields', async () => {
  await click('New Coupon');
  await setValue('input[placeholder="e.g. FOODIE2026"]', 'FREESHIP');
  await setValue('input[placeholder="e.g. Priya Eats"]', 'Fall campaign');
  await setValue('#coupon-benefit', 'free_delivery');
  expect(host.querySelector('#coupon-bonus-item')).toBeNull();
  await setValue('#coupon-minimum', '60.50');
  await click('Create Coupon');
  const create = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(String(create[1]?.body))).toMatchObject({ code: 'FREESHIP', type: 'free_delivery', minSubtotal: 60.5 });
});
it('saves a minimum directly on its coupon row and updates the displayed value', async () => {
  await setValue('input[aria-label="Minimum cart value for SHIP"]', '75');
  await click('Save');
  const update = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
  expect(JSON.parse(String(update[1]?.body))).toEqual({ code: 'SHIP', minSubtotal: 75 });
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Minimum cart value for SHIP"]')?.value).toBe('75');
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Save minimum for SHIP"]')?.disabled).toBe(true);
});
it('retains complimentary selection and quantity when creating that benefit', async () => {
  await click('New Coupon');
  await setValue('input[placeholder="e.g. FOODIE2026"]', 'BONUS');
  await setValue('input[placeholder="e.g. Priya Eats"]', 'Fall campaign');
  await setValue('#coupon-bonus-item', 'Malpuri');
  await setValue('#coupon-bonus-qty', '4');
  expect(host.querySelector('#coupon-minimum')).toBeNull();
  await click('Create Coupon');
  const create = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(String(create[1]?.body))).toMatchObject({ type: 'complimentary', bonusItem: 'Malpuri', bonusQty: 4, minSubtotal: 0 });
});
