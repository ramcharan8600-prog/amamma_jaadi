import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { getProductById } from '@/data/products';
import SweetsPage from './page';

vi.mock('@/components/product/SweetCard', () => ({ default: ({ product }: { product: { id: string } }) => createElement('div', { 'data-sweet': product.id }) }));
vi.mock('@/components/product/GiftBoxCard', () => ({ default: ({ product }: { product: { id: string } }) => createElement('div', { 'data-box': product.id }) }));
vi.mock('@/components/JsonLd', () => ({ default: () => null }));

it('shows the $30 pickup-only Texas Limited Edition box after the sweets', () => {
  const html = renderToStaticMarkup(createElement(SweetsPage));
  expect(html).toContain('data-box="gift-box-sweet-memories"');
  expect(html.lastIndexOf('data-sweet=')).toBeLessThan(html.indexOf('data-box='));
  // Same product as on Sweets Gift Packs, so the pickup-only rule comes with it.
  const box = getProductById('gift-box-sweet-memories')!;
  expect(box.unitPrice).toBe(30);
  expect(box.pickupOnly).toBe(true);
});
