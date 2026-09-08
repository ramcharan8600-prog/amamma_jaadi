import { describe, expect, it } from 'vitest';
import { getProductById } from '@/data/products';
import { MAX_PRODUCT_QUANTITY, validateCart } from './cart-validation';

const sweet = { productId: 'sweet-malpuri', quantity: 1, selectedTier: 16 };
const gift = {
  productId: 'gift-box-sweet-memories', quantity: 1,
  selectedVariant: '12 pcs Guntur Malpuri',
};

describe('new checkout cart validation', () => {
  it.each([
    undefined, null, NaN, Infinity, -Infinity, 0, -1, 1.5, '1', 'NaN', 'garbage',
    true, false, {}, [], MAX_PRODUCT_QUANTITY + 1, Number.MAX_SAFE_INTEGER,
  ])('rejects unsafe quantity %j before price calculation', (quantity) => {
    expect(validateCart([{ ...sweet, quantity }])).toMatchObject({ ok: false, status: 400 });
  });

  it.each([undefined, null, [], {}, [null], [true], ['item'], [[]]])(
    'rejects malformed cart %j',
    (input) => expect(validateCart(input)).toMatchObject({ ok: false, status: 400 })
  );

  it('limits both line count and aggregate quantity across different tiers', () => {
    expect(validateCart(Array.from({ length: 51 }, () => sweet)))
      .toMatchObject({ ok: false, status: 400 });
    expect(validateCart([
      { ...sweet, quantity: 600 },
      { ...sweet, quantity: 401, selectedTier: 25 },
    ])).toMatchObject({ ok: false, status: 400 });
    expect(validateCart([{ ...sweet, quantity: MAX_PRODUCT_QUANTITY }]).ok).toBe(true);
  });

  it.each([undefined, null, '16', 1, 15, 16.5, NaN, Infinity, true, [], {}])(
    'rejects unoffered or malformed sweet tier %j',
    (selectedTier) => expect(validateCart([{ ...sweet, selectedTier }]))
      .toMatchObject({ ok: false, status: 400 })
  );

  it('rejects unknown products and choices on products that do not offer them', () => {
    for (const item of [
      { ...sweet, productId: 'unknown' },
      { ...sweet, productId: null },
      { ...sweet, selectedVariant: 'extra sweets' },
      { ...gift, selectedTier: 50 },
      { productId: 'pickle-chicken', quantity: 1, selectedVariant: 'extra jars' },
    ]) expect(validateCart([item])).toMatchObject({ ok: false, status: 400 });
  });

  it.each([undefined, null, 12, true, [], {}, 'arbitrary kitchen instructions'])(
    'rejects malformed gift contents %j',
    (selectedVariant) => expect(validateCart([{ ...gift, selectedVariant }]))
      .toMatchObject({ ok: false, status: 400 })
  );

  it('rebuilds names, catalog metadata and every line amount from authoritative products', () => {
    const result = validateCart([
      { ...sweet, quantity: 2, product: { name: '100 free boxes', unitPrice: 0.01 }, lineTotal: 0.01 },
      { productId: 'pickle-chicken', quantity: 2, lineTotal: 999999 },
      { ...gift, product: { deliveryStateCodes: [] }, lineTotal: -500 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.subtotal).toBe(138);
    expect(result.taxableSubtotal).toBe(28);
    expect(result.items.map(({ lineTotal }) => lineTotal)).toEqual([80, 28, 30]);
    expect(result.items[0].product).toEqual(getProductById('sweet-malpuri'));
    expect(result.items[2].product.deliveryStateCodes).toEqual(['TX']);
    expect(result.items[2].selectedVariant).toBe(gift.selectedVariant);
    expect(result.requestedByProduct.get('sweet-malpuri')).toBe(2);
  });

  it('keeps valid gift variants and sweet tiers separate while aggregating stock quantities', () => {
    const result = validateCart([
      gift,
      { ...gift, selectedVariant: '12 pcs Nellore Malai Khaja' },
      sweet,
      { ...sweet, selectedTier: 25 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.items).toHaveLength(4);
    expect(result.subtotal).toBe(162.5);
    expect(result.requestedByProduct.get(gift.productId)).toBe(2);
    expect(result.requestedByProduct.get(sweet.productId)).toBe(2);
  });

  it('rejects unavailable products and invalid authoritative catalog prices', () => {
    const product = getProductById(sweet.productId)!;
    const originalStock = product.inStock;
    const originalPrice = product.unitPrice;
    try {
      product.inStock = false;
      expect(validateCart([sweet])).toMatchObject({ ok: false, status: 409 });
      product.inStock = true;
      for (const price of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
        product.unitPrice = price;
        expect(validateCart([sweet])).toMatchObject({ ok: false, status: 400 });
      }
    } finally {
      product.inStock = originalStock;
      product.unitPrice = originalPrice;
    }
  });
});
