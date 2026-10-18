// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AdminShell, { adminSectionFor } from './AdminShell';
import ShopOnly from '@/components/layout/ShopOnly';

const nav = vi.hoisted(() => ({ pathname: '/admin/dashboard', push: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: nav.push }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(pathname: string, child: ReturnType<typeof createElement> = createElement('p', null, 'page')) {
  nav.pathname = pathname;
  await act(async () => root.render(createElement(AdminShell, null, child)));
}

it('puts the same five sections on every admin page, on wide screens and as a phone tab bar', async () => {
  await render('/admin/orders');
  for (const label of ['Admin sections', 'Admin sections (phone)']) {
    const menu = host.querySelector(`nav[aria-label="${label}"]`)!;
    expect([...menu.querySelectorAll('a')].map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Today', '/admin/dashboard'], ['Orders', '/admin/orders'], ['Kitchen', '/admin/production'],
      ['Reports', '/admin/reports'], ['Settings', '/admin/settings'],
    ]);
    expect(menu.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('Orders');
  }
  expect(host.textContent).toContain('page');
  expect(host.querySelector('a[href="/"]')?.textContent).toContain('View shop');
});

it('marks pages inside a section, and logs out', async () => {
  expect(adminSectionFor('/admin/analytics')).toBe('Reports');
  expect(adminSectionFor('/admin/taxes')).toBe('Reports');
  expect(adminSectionFor('/admin/coupons')).toBe('Settings');
  expect(adminSectionFor('/admin/production')).toBe('Kitchen');
  const fetchMock = vi.fn(async () => Response.json({ success: true }));
  vi.stubGlobal('fetch', fetchMock);
  await render('/admin/settings');
  const logout = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Log out'))!;
  await act(async () => logout.click());
  expect(fetchMock).toHaveBeenCalledWith('/api/auth', { method: 'DELETE' });
  expect(nav.push).toHaveBeenCalledWith('/admin/login');
});

it('shows no menu on the login page', async () => {
  await render('/admin/login');
  expect(host.querySelector('nav')).toBeNull();
  expect(host.textContent).toBe('page');
});

it('keeps the shop header, footer and WhatsApp button off admin pages only', async () => {
  nav.pathname = '/admin/orders';
  await act(async () => root.render(createElement(ShopOnly, null, createElement('footer', null, 'shop footer'))));
  expect(host.textContent).toBe('');
  nav.pathname = '/pickles';
  await act(async () => root.render(createElement(ShopOnly, null, createElement('footer', null, 'shop footer'))));
  expect(host.textContent).toBe('shop footer');
  nav.pathname = '/administrator-guide';
  await act(async () => root.render(createElement(ShopOnly, null, createElement('footer', null, 'shop footer'))));
  expect(host.textContent).toBe('shop footer');
});
