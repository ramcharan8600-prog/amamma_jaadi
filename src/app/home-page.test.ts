// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import HomePage from './page';

vi.mock('next/image', () => ({ default: ({ alt, src }: { alt: string; src: string }) => createElement('img', { alt, src }) }));
vi.mock('next/link', () => ({ default: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) => createElement('a', { href, className }, children) }));

it('shows a Buy now button on each featured sweet, taking the shopper to that sweet', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(HomePage)));
    const cards = [...host.querySelectorAll('a')].filter((a) => a.textContent?.includes('Buy now'));
    expect(cards.map((a) => a.getAttribute('href'))).toEqual(['/sweets#guntur-malpuri', '/sweets#nellore-malai-khaja', '/sweets#bobbatlu']);
    for (const card of cards) expect(card.textContent).toMatch(/Starting at \$\d+.*Buy now/);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
