import { describe, it, expect } from 'vitest';
import {
  PRODUCTS,
  PICKUP_LOCATIONS,
  ACTIVE_PICKUP_LOCATIONS,
  isActivePickupLocation,
  getProductById,
  getProductBySlug,
  getProductsByCategory,
  getPickupLocationById,
  calculateSweetPrice,
  getTotalPieces,
  productNamesFromIds,
  isProductTaxExempt,
  isStockTracked,
  stockUnits,
  getBobbatluPieces,
} from '@/data/products';

describe('product catalog integrity', () => {
  it('offers Kova Bobbatlu with the same image, price and prep time as Bobbatlu', () => {
    const original = getProductById('sweet-bobbatlu')!;
    const kovaBobbatlu = getProductBySlug('kova-bobbatlu')!;
    expect(kovaBobbatlu.name).toBe('Kova Bobbatlu');
    for (const key of ['category', 'image', 'unitPrice', 'inStock', 'prepNotice'] as const) {
      expect(kovaBobbatlu[key]).toEqual(original[key]);
    }
    // Only plain Bobbatlu has the discounted 25/50 packs.
    expect(kovaBobbatlu.quantityOptions?.map(tier => calculateSweetPrice(kovaBobbatlu, tier))).toEqual([48, 75, 150]);
    expect(kovaBobbatlu.quantityOptions).toEqual(original.quantityOptions);
    expect(original.quantityOptions?.map(tier => calculateSweetPrice(original, tier))).toEqual([48, 70, 135]);
    expect(isStockTracked(kovaBobbatlu)).toBe(true);
    expect(isProductTaxExempt(kovaBobbatlu)).toBe(true);
  });

  it('counts each Bobbatlu variant inventory independently in pieces', () => {
    const items = [
      { productId: 'sweet-bobbatlu', quantity: 2, selectedTier: 16 },
      { productId: 'sweet-kova-bobbatlu', quantity: 2, selectedTier: 25 },
      { productId: 'sweet-kova-bobbatlu', quantity: 1, selectedTier: 50 },
    ];
    expect(getBobbatluPieces(items)).toBe(32);
    expect(getBobbatluPieces(items, 'sweet-kova-bobbatlu')).toBe(100);
    expect(stockUnits('sweet-kova-bobbatlu', 3)).toBe(48);
  });
  it('uses the approved pickle jar prices', () => {
    expect(getProductById('pickle-chicken')?.unitPrice).toBe(18);
    expect(getProductById('pickle-gongura-chicken')?.unitPrice).toBe(19);
    expect(getProductById('pickle-mutton')?.unitPrice).toBe(21);
    expect(getProductById('pickle-prawns')?.unitPrice).toBe(21);
  });

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

  it('keeps the $30 Sweet Memories box for pickup only, labelled on its photo', () => {
    const box = getProductById('gift-box-sweet-memories')!;
    expect(box.unitPrice).toBe(30);
    expect(box.pickupOnly).toBe(true);
    expect(box.ribbon).toBe('#Pick-up limited');
    expect(box.description).toContain('Pickup only');
    expect(box.deliveryStateCodes).toBeUndefined();
  });

  it('names the $50 box Mini Party Box, open to pickup and delivery at standard rates', () => {
    const box = getProductById('gift-box-party')!;
    expect(box).toMatchObject({ name: 'Mini Party Box', slug: 'mini-party-box', unitPrice: 50 });
    expect(box.name + box.description).not.toMatch(/event/i);
    expect(box.description).toContain('Available for pickup or delivery; standard delivery charges apply.');
    expect(box.pickupOnly).toBeUndefined();
    expect(box.deliveryZones).toBeUndefined();
    expect(box.deliveryStateCodes).toBeUndefined();
  });

  it('offers the $40 Mini Combo Pack (8 + 8) for delivery in Texas and nearby states', () => {
    const box = getProductById('gift-box-mini-combo')!;
    expect(box).toMatchObject({ unitPrice: 40, category: 'gift-boxes', isFixedQuantity: true, deliveryZones: ['texas', 'nearby'] });
    expect(box.pickupOnly).toBeUndefined();
    expect(box.variantOptions).toEqual(['Assorted: 8 Malpuri + 8 Malai Khaja']);
    expect(isProductTaxExempt(box)).toBe(true);
    // Listed between the $30 and $50 boxes.
    expect(getProductsByCategory('gift-boxes').map((p) => p.unitPrice)).toEqual([30, 40, 50]);
  });

  it('gift box piece counts match the box size', () => {
    // The $30 box opens on the 6 + 6 mix (first option); the others stay in the list.
    expect(getProductById('gift-box-sweet-memories')!.variantOptions).toEqual([
      'Mix: 6 Malpuri + 6 Malai Khaja',
      '12 pcs Guntur Malpuri',
      '12 pcs Nellore Malai Khaja',
    ]);
    expect(getProductById('gift-box-party')!.variantOptions).toEqual([
      '20 pcs Guntur Malpuri',
      '20 pcs Nellore Malai Khaja',
      'Mix: 10 Malpuri + 10 Malai Khaja',
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
    expect(calculateSweetPrice({ unitPrice: 3 }, 16)).toBe(48);
    expect(calculateSweetPrice({ unitPrice: 4 }, 25)).toBe(100);
    expect(calculateSweetPrice({ unitPrice: 2 }, 50)).toBe(100);
  });

  it('uses a fixed tier price when one is set (Assorted Box: 22 pcs for $60)', () => {
    const box = getProductById('sweet-assorted-box')!;
    expect(box.name).toBe('Assorted Box — Malpuri & Malai Khaja');
    expect(box.ribbon).toBe('Special Edition');
    expect(box.quantityOptions).toEqual([22]);
    expect(calculateSweetPrice(box, 22)).toBe(60);
    expect(calculateSweetPrice({ unitPrice: 2.5, tierPrices: { 22: 60 } }, 16)).toBe(40);
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

describe('pickup locations', () => {
  it('offers only current partners for new orders but still resolves retired ones for past orders', () => {
    expect(ACTIVE_PICKUP_LOCATIONS.map((l) => l.id)).toEqual(['plano-biryanify', 'frisco-ravibabu', 'irving-ravibabu']);
    expect(isActivePickupLocation('irving-biryanify')).toBe(false);
    expect(isActivePickupLocation('frisco-ravibabu')).toBe(true);
    expect(isActivePickupLocation(undefined)).toBe(false);
    expect(getPickupLocationById('irving-biryanify')?.address).toBe('9400 N MacArthur Blvd #150');
  });
});

it('keeps the Bobbatlu Taste Pack off the product pages', () => {
  const pack = getProductById('sweet-bobbatlu-taste-pack')!;
  expect(pack).toMatchObject({ name: 'Bobbatlu Taste Pack', addOnOnly: true, addOnFor: 'sweet-assorted-box', quantityOptions: [8], emailDetails: ['• 8 Bobbatlu'] });
  expect(calculateSweetPrice(pack, 8)).toBe(24);
  expect(getProductsByCategory('sweets').map(p => p.id)).not.toContain('sweet-bobbatlu-taste-pack');
});

it('asks for 1–2 days to prepare Kova without calling it a delivery delay', () => {
  const kova = getProductById('sweet-kova')!;
  expect(kova.prepNotice).toBe('Made fresh to order — pickup available from tomorrow. Please allow 1–2 days for preparation.');
  expect(kova.prepNotice).not.toMatch(/delivery/i);
});
