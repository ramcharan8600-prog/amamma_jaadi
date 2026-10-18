// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import SettingsPage from './page';

vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));
vi.mock('@/components/admin/DeliveryPausePanel', () => ({ default: () => createElement('div', null, 'delivery panel') }));
vi.mock('@/components/admin/SoldOutDatesPanel', () => ({ default: () => createElement('div', null, 'sold-out panel') }));
vi.mock('@/components/admin/BlockedCustomersPanel', () => ({ default: () => createElement('div', null, 'blocked panel') }));

it('gathers every setting customers feel: delivery, sold-out dates, blocked customers and coupons', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(createElement(SettingsPage)));
  expect(host.querySelector('h1')?.textContent).toBe('Settings');
  expect(host.textContent).toMatch(/delivery panel.*sold-out panel.*blocked panel/);
  expect(host.querySelector('a[href="/admin/coupons"]')?.textContent).toContain('Coupons');
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
