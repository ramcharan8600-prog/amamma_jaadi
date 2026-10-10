// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { getProductById } from '@/data/products';
import { useCartStore } from '@/store/cart';
import GiftBoxCard from './GiftBoxCard';

vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => createElement('img', { alt: props.alt as string }) }));

it('opens the $30 box on the 6 + 6 mix and adds it to the cart, with the other mixes still offered', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useCartStore.getState().clearCart();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(GiftBoxCard, { product: getProductById('gift-box-sweet-memories')! })));
    const select = host.querySelector('select')!;
    expect(select.value).toBe('Mix: 6 Malpuri + 6 Malai Khaja');
    expect([...select.options].map((o) => o.value)).toEqual([
      'Mix: 6 Malpuri + 6 Malai Khaja', '12 pcs Guntur Malpuri', '12 pcs Nellore Malai Khaja',
    ]);
    const add = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Add to Cart'))!;
    await act(async () => add.click());
    expect(useCartStore.getState().items.map((i) => i.selectedVariant)).toEqual(['Mix: 6 Malpuri + 6 Malai Khaja']);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    useCartStore.getState().clearCart();
    vi.unstubAllGlobals();
  }
});
