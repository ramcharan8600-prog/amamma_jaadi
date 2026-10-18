// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import WhatsAppButton from './WhatsAppButton';

const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

it('floats on shop pages but stays off checkout, where it covered the Continue button', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  for (const [pathname, shown] of [['/', true], ['/sweets', true], ['/checkout', false]] as const) {
    nav.pathname = pathname;
    await act(async () => root.render(createElement(WhatsAppButton)));
    expect(Boolean(host.querySelector('a[aria-label="Chat on WhatsApp"]'))).toBe(shown);
  }
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
