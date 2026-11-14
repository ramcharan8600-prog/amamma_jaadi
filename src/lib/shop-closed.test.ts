// @vitest-environment jsdom
//
// The rest of the suite runs with SHOP_CLOSED=off so it keeps checking the open
// shop. These tests turn the switch back ON and check the closed shop itself:
// no page offers to sell anything, and no checkout can be started by any route.
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) =>
    createElement('a', props, children),
}));
vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) =>
    createElement('img', { alt, src: typeof src === 'string' ? src : '' }),
}));

let root: Root | null = null;
let host: HTMLDivElement;

/** Imports a module fresh with the shop closed. */
async function closed<T>(path: string): Promise<T> {
  vi.stubEnv('SHOP_CLOSED', 'on');
  vi.resetModules();
  return (await import(path)) as T;
}

async function render(Component: () => unknown) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(Component as never)); });
  return host.textContent || '';
}

beforeEach(() => { vi.unstubAllEnvs(); });

afterEach(async () => {
  if (root) { const r = root; root = null; await act(async () => { r.unmount(); }); }
  host?.remove();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the closed shop', () => {
  it('shows the closed notice instead of the checkout, with no way to pay', async () => {
    const mod = await closed<{ default: () => unknown }>('@/app/checkout/page');
    const text = await render(mod.default);
    expect(text).toContain('We are not taking orders right now');
    expect(text).toContain('already placed an order, it will be honoured');
    // Nothing from the real checkout survives.
    expect(text).not.toContain('Step 1');
    expect(text).not.toContain('Continue to payment');
    expect(host.querySelector('#square-card-container')).toBeNull();
  });

  it('shows the closed notice instead of the shop front page', async () => {
    const mod = await closed<{ default: () => unknown }>('@/app/page');
    const text = await render(mod.default);
    expect(text).toContain('We are not taking orders right now');
    expect(text).not.toContain('Add to Cart');
  });

  it('hides the shop header, footer and WhatsApp button', async () => {
    const mod = await closed<{ default: (p: { children: ReactNode }) => ReactNode }>(
      '@/components/layout/ShopOnly',
    );
    const ShopOnly = mod.default;
    const text = await render(() => createElement(ShopOnly, null, 'SHOP CHROME'));
    expect(text).toBe('');
  });

  it('refuses to start a payment session, whoever asks', async () => {
    const { POST } = await closed<{ POST: (r: Request) => Promise<Response> }>(
      '@/app/api/payments/create-session/route',
    );
    const response = await POST(new Request('https://amammajaadi.com/api/payments/create-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ productId: 'pickle-chicken', quantity: 1 }] }),
    }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('We are not taking orders right now.');
  });
});
