import { afterEach, describe, expect, it, vi } from 'vitest';
import { cartLines, productLine, trackFunnel } from '@/lib/analytics';
import type { CartItem, Product } from '@/types';

const product = { id: 'kova-bobbatlu', name: 'Kova Bobbatlu', category: 'sweets' } as Product;

describe('shopping funnel analytics (Zaraz → GA4)', () => {
  afterEach(() => { delete (globalThis as { zaraz?: unknown }).zaraz; });

  it('does nothing when Zaraz is not on the page (sandbox, tests, ad blockers)', () => {
    expect(() => trackFunnel('Product Added', { products: [], value: 10 })).not.toThrow();
  });

  it('never lets a failing tracker break shopping', () => {
    (globalThis as { zaraz?: unknown }).zaraz = { ecommerce: () => { throw new Error('blocked'); } };
    expect(() => trackFunnel('Cart Viewed', { products: [], value: 10 })).not.toThrow();
  });

  it('sends product lines in USD with per-unit price, and revenue on Order Completed', () => {
    const ecommerce = vi.fn();
    (globalThis as { zaraz?: unknown }).zaraz = { ecommerce };
    const items = [{ productId: product.id, product, quantity: 2, selectedTier: 16, lineTotal: 79.98 }] as CartItem[];
    trackFunnel('Order Completed', { order_id: 'AJ-1300', products: cartLines(items), value: 85.97, shipping: 5.99, tax: 0 });
    expect(ecommerce).toHaveBeenCalledWith('Order Completed', {
      order_id: 'AJ-1300',
      products: [{ product_id: 'kova-bobbatlu', name: 'Kova Bobbatlu', category: 'sweets', variant: '16 pcs', price: 39.99, quantity: 2 }],
      value: 85.97, revenue: 85.97, total: 85.97, shipping: 5.99, tax: 0, currency: 'USD',
    });
  });

  it('sends no customer details', () => {
    const line = productLine(product, 1, 30, undefined, 'Malpuri & Malai Khaja');
    expect(Object.keys(line).sort()).toEqual(['category', 'name', 'price', 'product_id', 'quantity', 'variant']);
    expect(line.variant).toBe('Malpuri & Malai Khaja');
  });
});
