// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { invalidateStock } from '@/hooks/useStock';
import HomePage from './page';

vi.mock('next/image', () => ({ default: ({ alt, src }: { alt: string; src: string }) => createElement('img', { alt, src }) }));
vi.mock('next/link', () => ({ default: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) => createElement('a', { href, className }, children) }));

async function renderHome(check: (host: HTMLDivElement) => void) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ stock: {} })));
  invalidateStock();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(HomePage)));
    check(host);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
}

it('shows a Buy now button on each featured sweet, taking the shopper to that sweet', async () => {
  await renderHome((host) => {
    const cards = [...host.querySelectorAll('a')].filter((a) => a.textContent?.includes('Buy now'));
    expect(cards.map((a) => a.getAttribute('href'))).toEqual(['/sweets#guntur-malpuri', '/sweets#nellore-malai-khaja', '/sweets#bobbatlu']);
    for (const card of cards) expect(card.textContent).toMatch(/Starting at \$\d+.*Buy now/);
  });
});

it('leads with delivery across the USA, Shop Sweets / Shop Pickles, and best sellers with Add to Cart', async () => {
  await renderHome((host) => {
    const text = host.textContent ?? '';
    expect(text).toContain('Delivery across the USA · Free pickup in Dallas');
    const links = [...host.querySelectorAll('a')].map((a) => [a.textContent?.trim(), a.getAttribute('href')]);
    expect(links).toContainEqual(['Shop Sweets', '/sweets']);
    expect(links).toContainEqual(['Shop Pickles', '/pickles']);
    expect(text).toContain('Best Sellers');
    for (const name of ['Assorted Box — Malpuri & Malai Khaja', 'Mini Combo Pack', 'Assorted Bobbatlu Box', 'Chicken Pickle']) {
      expect(text).toContain(name);
    }
    expect([...host.querySelectorAll('button')].filter((b) => /add to cart/i.test(b.textContent ?? '')).length).toBeGreaterThanOrEqual(4);
    expect(text).toContain('Freshly Made to Order');
    expect(text).not.toMatch(/Freshly Baked|Same-Day Pickup/);
  });
});
