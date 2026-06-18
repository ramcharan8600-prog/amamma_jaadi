// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore } from '@/store/cart';
import { getProductById } from '@/data/products';

const sweet = getProductById('sweet-bobbatlu')!; // unitPrice 4
const pickle = getProductById('pickle-chicken')!; // unitPrice 14

function reset() {
  useCartStore.getState().clearCart();
}

describe('cart store', () => {
  beforeEach(reset);

  it('adds a sweet with the correct tier-based line total', () => {
    useCartStore.getState().addItem(sweet, 1, 16);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].lineTotal).toBe(4 * 16); // 64
    expect(useCartStore.getState().getSubtotal()).toBe(64);
  });

  it('adds a pickle priced by unit', () => {
    useCartStore.getState().addItem(pickle, 2);
    expect(useCartStore.getState().getSubtotal()).toBe(28);
    expect(useCartStore.getState().getItemCount()).toBe(2);
  });

  it('merges quantities for the same product+tier and recomputes total', () => {
    useCartStore.getState().addItem(sweet, 1, 16);
    useCartStore.getState().addItem(sweet, 2, 16);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
    expect(items[0].lineTotal).toBe(4 * 16 * 3); // 192
  });

  it('keeps different tiers of the same sweet as separate lines', () => {
    useCartStore.getState().addItem(sweet, 1, 16);
    useCartStore.getState().addItem(sweet, 1, 50);
    expect(useCartStore.getState().items).toHaveLength(2);
  });

  it('removeItem removes only the matching tier line', () => {
    useCartStore.getState().addItem(sweet, 1, 16);
    useCartStore.getState().addItem(sweet, 1, 50);
    useCartStore.getState().removeItem(sweet.id, 16);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].selectedTier).toBe(50);
  });

  it('updateQuantity to 0 removes the line', () => {
    useCartStore.getState().addItem(pickle, 1);
    useCartStore.getState().updateQuantity(pickle.id, 0);
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('isLargeOrder flips above 150 pieces', () => {
    expect(useCartStore.getState().isLargeOrder()).toBe(false);
    useCartStore.getState().addItem(sweet, 4, 50); // 200 pieces
    expect(useCartStore.getState().isLargeOrder()).toBe(true);
  });
});
