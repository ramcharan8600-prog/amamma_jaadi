import { describe, it, expect } from 'vitest';
import {
  PRODUCTS,
  PICKUP_LOCATIONS,
  getProductById,
  getProductBySlug,
  getProductsByCategory,
  getPickupLocationById,
  calculateSweetPrice,
  getTotalPieces,
  productNamesFromIds,
  isProductTaxExempt,
} from '@/data/products';

describe('product catalog integrity', () => {
  it('every product has a unique id', () => {
    const ids = PRODUCTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every product has a unique slug', () => {
    const slugs = PRODUCTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every product has a positive price and an image', () => {
    for (const p of PRODUCTS) {
      expect(p.unitPrice).toBeGreaterThan(0);
      expect(p.image).toMatch(/^\/images\//);
    }
  });

  it('every sweet defines quantityOptions; non-sweets do not require them', () => {
    for (const p of PRODUCTS) {
      if (p.category === 'sweets') {
        expect(Array.isArray(p.quantityOptions)).toBe(true);
        expect(p.quantityOptions!.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('lookups', () => {
  it('getProductById returns the right product or undefined', () => {
    expect(getProductById('pickle-chicken')?.name).toBe('Chicken Pickle');
    expect(getProductById('does-not-exist')).toBeUndefined();
  });

  it('getProductBySlug resolves by slug', () => {
    expect(getProductBySlug('kova')?.id).toBe('sweet-kova');
  });

  it('productNamesFromIds maps ids to readable names for the event email', () => {
    expect(productNamesFromIds(['sweet-kova', 'sweet-bobbatlu'])).toBe('Kova, Bobbatlu');
    // Unknown ids are kept as-is rather than dropped.
    expect(productNamesFromIds(['sweet-kova', 'mystery'])).toBe('Kova, mystery');
    expect(productNamesFromIds([])).toBe('');
  });

  it('taxes pickles but exempts bakery items (Texas bakery exemption)', () => {
    // Sweets and gift boxes are baked goods → exempt. Pickles are taxable.
    expect(isProductTaxExempt(getProductById('sweet-kova')!)).toBe(true);
    expect(isProductTaxExempt(getProductById('sweet-bobbatlu')!)).toBe(true);
    expect(isProductTaxExempt(getProductById('gift-box-sweet-memories')!)).toBe(true);
    expect(isProductTaxExempt(getProductById('pickle-chicken')!)).toBe(false);
    expect(isProductTaxExempt(getProductById('pickle-mutton')!)).toBe(false);
  });

  it('both gift boxes offer three contents options at one price', () => {
    for (const id of ['gift-box-sweet-memories', 'gift-box-party']) {
      const box = getProductById(id)!;
      expect(box.variantOptions).toHaveLength(3);
      // All-Malpuri, all-Malai Khaja, and an even mix.
      expect(box.variantOptions!.some((v) => /Malpuri/.test(v))).toBe(true);
      expect(box.variantOptions!.some((v) => /Malai Khaja/.test(v))).toBe(true);
      expect(box.variantOptions!.some((v) => /^Mix/.test(v))).toBe(true);
    }
  });

  it('gift box piece counts match the box size', () => {
    expect(getProductById('gift-box-sweet-memories')!.variantOptions).toEqual([
      '12 pcs Guntur Malpuri',
      '12 pcs Nellore Malai Khaja',
      'Mix — 6 pcs Malpuri + 6 pcs Malai Khaja',
    ]);
    expect(getProductById('gift-box-party')!.variantOptions).toEqual([
      '20 pcs Guntur Malpuri',
      '20 pcs Nellore Malai Khaja',
      'Mix — 10 pcs Malpuri + 10 pcs Malai Khaja',
    ]);
  });

  it('getProductsByCategory filters correctly', () => {
    const sweets = getProductsByCategory('sweets');
    expect(sweets.length).toBeGreaterThan(0);
    expect(sweets.every((p) => p.category === 'sweets')).toBe(true);
  });

  it('getPickupLocationById resolves a known DFW location', () => {
    expect(getPickupLocationById('plano-biryanify')?.city).toBe('Plano');
    expect(getPickupLocationById('nope')).toBeUndefined();
  });

  it('all pickup locations are in TX', () => {
    expect(PICKUP_LOCATIONS.every((l) => l.state === 'TX')).toBe(true);
  });
});

describe('pricing math (money path)', () => {
  it('calculateSweetPrice multiplies unit price by tier', () => {
    expect(calculateSweetPrice(3, 16)).toBe(48);
    expect(calculateSweetPrice(4, 25)).toBe(100);
    expect(calculateSweetPrice(2, 50)).toBe(100);
  });

  it('getTotalPieces counts sweet tiers as pieces', () => {
    const sweet = getProductById('sweet-bobbatlu')!;
    const pieces = getTotalPieces([{ quantity: 2, selectedTier: 25, product: sweet }]);
    expect(pieces).toBe(50); // 2 boxes * 25 pcs
  });

  it('getTotalPieces counts pickles as whole units', () => {
    const pickle = getProductById('pickle-chicken')!;
    const pieces = getTotalPieces([{ quantity: 3, product: pickle }]);
    expect(pieces).toBe(3);
  });

  it('getTotalPieces sums a mixed cart', () => {
    const sweet = getProductById('sweet-kova')!;
    const pickle = getProductById('pickle-mutton')!;
    const pieces = getTotalPieces([
      { quantity: 1, selectedTier: 16, product: sweet },
      { quantity: 2, product: pickle },
    ]);
    expect(pieces).toBe(18);
  });
});
