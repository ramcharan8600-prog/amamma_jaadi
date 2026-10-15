// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import DashboardPage from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));
vi.mock('@/components/admin/InventoryPanel', () => ({ default: () => createElement('div', null, 'stock panel') }));
vi.mock('@/components/admin/SoldOutDatesPanel', () => ({ default: () => createElement('div', null, 'sold-out panel') }));

it('keeps the toolbar, sold-out dates and stock; the orders list moved to All Orders', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ authenticated: true })));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DashboardPage)));
    await act(async () => {});
    const links = [...host.querySelectorAll('a')].map((a) => [a.textContent?.trim(), a.getAttribute('href')]);
    expect(links).toEqual([
      ['All Orders', '/admin/orders'], ['Production Planning', '/admin/production'], ['Tax records', '/admin/taxes'],
      ['Coupons', '/admin/coupons'], ['Analytics', '/admin/analytics'],
    ]);
    expect(host.textContent).toContain('sold-out panel');
    expect(host.textContent).toContain('stock panel');
    expect(host.querySelector('table')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
