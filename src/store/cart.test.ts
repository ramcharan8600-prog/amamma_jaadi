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

  it('removes the Taste Pack with the last 10:10 box, but keeps it while a box remains', () => {
    const box = getProductById('sweet-assorted-box')!;
    const pack = getProductById('sweet-bobbatlu-taste-pack')!;
    useCartStore.getState().addItem(box, 2, 20);
    useCartStore.getState().addItem(pack, 1, 8);
    useCartStore.getState().addItem(sweet, 1, 16);
    useCartStore.getState().updateQuantity(box.id, 1, 20);
    useCartStore.getState().removeItem(sweet.id, 16);
    expect(useCartStore.getState().items.map(i => i.productId)).toEqual([box.id, pack.id]);
    useCartStore.getState().updateQuantity(box.id, 0, 20);
    expect(useCartStore.getState().items).toEqual([]);
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

  it('re-reads saved cart lines from the current catalog, so old prices and sizes never reach checkout', async () => {
    const box = getProductById('sweet-assorted-box')!;
    // A cart saved with the old 22-piece 11:11 box moves to today's 10:10 box at today's price.
    const oldBox = { ...box, unitPrice: 2.5, tierPrices: { 22: 60 }, quantityOptions: [22] };
    localStorage.setItem('amamma-jaadi-cart', JSON.stringify({ version: 0, state: { items: [
      { productId: box.id, product: oldBox, quantity: 2, selectedTier: 22, lineTotal: 120 },
      { productId: 'retired-product', product: { ...oldBox, id: 'retired-product' }, quantity: 1, selectedTier: 22, lineTotal: 60 },
    ] } }));
    await useCartStore.persist.rehydrate();
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ selectedTier: 20, quantity: 2, lineTotal: (box.tierPrices?.[20] ?? 0) * 2 });
    expect(items[0].product.tierPrices).toEqual(box.tierPrices);
    localStorage.removeItem('amamma-jaadi-cart');
  });
});
