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
    expect(getProductBySlug('kaju-katli')?.id).toBe('sweet-kaju-katli');
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
