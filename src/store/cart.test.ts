// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore } from '@/store/cart';
import { getProductById } from '@/data/products';

// Prices come from the catalog (per piece / per unit) so these tests don't
// hardcode a value that lives in data/products.ts.
const sweet = getProductById('sweet-bobbatlu')!;
const pickle = getProductById('pickle-chicken')!;

function reset() {
  useCartStore.getState().clearCart();
}

describe('cart store', () => {
  beforeEach(reset);

  it('adds a sweet with the correct tier-based line total', () => {
    useCartStore.getState().addItem(sweet, 1, 16);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].lineTotal).toBe(sweet.unitPrice * 16);
    expect(useCartStore.getState().getSubtotal()).toBe(sweet.unitPrice * 16);
  });

  it('adds a pickle priced by unit', () => {
    useCartStore.getState().addItem(pickle, 2);
    expect(useCartStore.getState().getSubtotal()).toBe(pickle.unitPrice * 2);
    expect(useCartStore.getState().getItemCount()).toBe(2);
  });

  it('merges quantities for the same product+tier and recomputes total', () => {
    useCartStore.getState().addItem(sweet, 1, 16);
    useCartStore.getState().addItem(sweet, 2, 16);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
    expect(items[0].lineTotal).toBe(sweet.unitPrice * 16 * 3);
  });

  it('keeps different gift-box contents as separate lines', () => {
    const box = getProductById('gift-box-sweet-memories')!;
    const [malpuri, khaja] = box.variantOptions!;
    useCartStore.getState().addItem(box, 1, undefined, malpuri);
    useCartStore.getState().addItem(box, 1, undefined, khaja);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.selectedVariant)).toEqual([malpuri, khaja]);
  });

  it('merges gift boxes only when the contents match', () => {
    const box = getProductById('gift-box-sweet-memories')!;
    const [malpuri] = box.variantOptions!;
    useCartStore.getState().addItem(box, 1, undefined, malpuri);
    useCartStore.getState().addItem(box, 2, undefined, malpuri);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });

  it('removeItem removes only the matching gift-box variant', () => {
    const box = getProductById('gift-box-sweet-memories')!;
    const [malpuri, khaja] = box.variantOptions!;
    useCartStore.getState().addItem(box, 1, undefined, malpuri);
    useCartStore.getState().addItem(box, 1, undefined, khaja);
    useCartStore.getState().removeItem(box.id, undefined, malpuri);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].selectedVariant).toBe(khaja);
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
