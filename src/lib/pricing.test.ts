import { describe, it, expect } from 'vitest';
import {
  calculateOrderTotals,
  calculateShippingQuote,
  DELIVERY_STATE_OPTIONS,
  roundMoney,
  isTexas,
  getShippingZone,
  getDeliveryMinimumSubtotal,
  getDeliveryMinimumShortfall,
  isSupportedDeliveryState,
  normalizeStateCode,
  shippingMethodLabel,
  deliveryService,
  deliveryServiceLabel,
  isExpressDeliveryService,
  isGroundShippingCart,
  groundShippingKind,
  deliveryRestriction,
  containsAssortedBox,
  SALES_TAX_RATE,
  SALES_TAX_LABEL,
  salesTaxLineLabel,
} from './pricing';
import { getProductById } from '@/data/products';

describe('pricing — Texas sales tax on the taxable portion only', () => {
  it('uses the 8.25% Texas rate', () => {
    expect(SALES_TAX_RATE).toBe(0.0825);
    expect(SALES_TAX_LABEL).toBe('Sales Tax (8.25%)');
    expect(salesTaxLineLabel(1.49)).toBe('Sales Tax (8.25%)');
    expect(salesTaxLineLabel(0)).toBe('Sales tax (sweets are tax-free)');
  });

  it('charges NO tax on an all-exempt order (bakery items)', () => {
    expect(calculateOrderTotals(40, { taxableSubtotal: 0 })).toEqual({
      subtotal: 40,
      tax: 0,
      shipping: 0,
      total: 40,
    });
  });

  it('taxes a fully taxable order (pickles only)', () => {
    expect(calculateOrderTotals(14, { taxableSubtotal: 14 })).toEqual({
      subtotal: 14,
      tax: 1.16,
      shipping: 0,
      total: 15.16,
    });
  });

  it('taxes only the taxable share of a MIXED order', () => {
    expect(calculateOrderTotals(54, { taxableSubtotal: 14 })).toEqual({
      subtotal: 54,
      tax: 1.16,
      shipping: 0,
      total: 55.16,
    });
  });

  it('treats the whole subtotal as taxable when not told otherwise', () => {
    expect(calculateOrderTotals(100).tax).toBe(8.25);
  });

  it('never taxes more than the subtotal, even on bad input', () => {
    expect(calculateOrderTotals(10, { taxableSubtotal: 999 }).tax).toBe(roundMoney(10 * 0.0825));
    expect(calculateOrderTotals(10, { taxableSubtotal: -5 }).tax).toBe(0);
  });
});

describe('isTexas helper', () => {
  it('recognises TX in any case', () => {
    expect(isTexas('TX')).toBe(true);
    expect(isTexas('tx')).toBe(true);
    expect(isTexas('Tx')).toBe(true);
    expect(isTexas(' TX ')).toBe(true);
  });
  it('rejects non-Texas states', () => {
    expect(isTexas('AZ')).toBe(false);
    expect(isTexas('OR')).toBe(false);
    expect(isTexas('')).toBe(false);
    expect(isTexas(undefined)).toBe(false);
    expect(isTexas(null)).toBe(false);
  });
});


// ── Shipping rate card (owner, 2026-10-12) ─────────────────────────
const box = (quantity = 1) => ({ productId: 'sweet-assorted-box', quantity });
const pack = { productId: 'sweet-bobbatlu-taste-pack' };
const bobBox = (quantity = 1) => ({ productId: 'sweet-assorted-bobbatlu-box', quantity });
const malpuri = { productId: 'sweet-malpuri' };
const khaja = { productId: 'sweet-malai-khaja' };
const mini = { productId: 'gift-box-mini-combo' };

/** Shipping the checkout and server charge for these cart lines. */
function ship(items: Array<{ productId: string; quantity?: number }>, subtotal: number, state: string, picklesOnly = false) {
  return calculateShippingQuote(subtotal, {
    fulfillmentType: 'delivery', deliveryState: state, picklesOnly,
    groundShipping: groundShippingKind(items), assortedBoxInCart: containsAssortedBox(items),
  }).shipping;
}

describe('shipping rate card — normal carts', () => {
  it.each([
    ['TX', 40, 5.99], ['TX', 99.99, 5.99], ['TX', 100, 3.99], ['TX', 250, 3.99],
    ['GA', 40, 6.99], ['GA', 59.99, 6.99], ['GA', 60, 5.99], ['GA', 99.99, 5.99], ['GA', 100, 4.99], ['OK', 150, 4.99],
    ['AZ', 60, 11.99], ['OR', 150, 11.99],
  ])('%s at $%s pays $%s', (state, subtotal, rate) => {
    expect(ship([malpuri], subtotal as number, state as string)).toBe(rate);
  });

  it('shows the Texas $3.99 from $100 as savings on the $5.99 rate', () => {
    expect(calculateShippingQuote(120, { fulfillmentType: 'delivery', deliveryState: 'TX' }))
      .toEqual({ shipping: 3.99, regularShipping: 5.99, referenceShipping: 5.99, savings: 2, discountedShippingMinimum: 100 });
    expect(calculateShippingQuote(80, { fulfillmentType: 'delivery', deliveryState: 'TX' }))
      .toEqual({ shipping: 5.99, regularShipping: 5.99, referenceShipping: 5.99, savings: 0 });
  });

  it('keeps the $60 far-state minimum for sweets, but not for pickles', () => {
    expect(getDeliveryMinimumShortfall(40, 'AZ')).toBe(20);
    expect(getDeliveryMinimumShortfall(60, 'AZ')).toBe(0);
    expect(getDeliveryMinimumShortfall(40, 'GA')).toBe(0);
    expect(getDeliveryMinimumShortfall(18, 'AZ', true)).toBe(0);
  });

  it('is free for pickup', () => {
    expect(calculateShippingQuote(40, { fulfillmentType: 'pickup', deliveryState: 'TX' }).shipping).toBe(0);
  });
});

describe('shipping rate card — 10:10 box only', () => {
  it.each([
    ['one box', [box()], 60], ['two boxes', [box(2)], 120], ['three boxes', [box(3)], 180],
    ['box + Taste Pack', [box(), pack], 84],
  ])('%s: $3.99 Texas, $6.99 nearby, $7.99 far, no minimum', (_name, items, subtotal) => {
    expect(['TX', 'GA', 'AZ'].map((state) => ship(items as never, subtotal as number, state))).toEqual([3.99, 6.99, 7.99]);
    // No state extra on a box-only cart, even to California.
    expect(ship(items as never, subtotal as number, 'CA')).toBe(7.99);
    expect(getDeliveryMinimumSubtotal('AZ', false, groundShippingKind(items as never))).toBe(0);
  });
});

describe('shipping rate card — 10:10 box with other items (the higher rate)', () => {
  it.each([
    ['TX', 100, 3.99], ['TX', 99, 5.99],
    ['GA', 80, 6.99], ['GA', 100, 6.99], ['GA', 160, 6.99],
    ['AZ', 100, 11.99],
  ])('%s at $%s pays $%s', (state, subtotal, rate) => {
    expect(ship([box(), malpuri], subtotal as number, state as string)).toBe(rate);
  });

  it('keeps the far-state minimum, which the box already meets', () => {
    expect(getDeliveryMinimumShortfall(100, 'AZ', false, groundShippingKind([box(), malpuri]))).toBe(0);
  });
});

describe('shipping rate card — 8:8 Bobbatlu box only', () => {
  it.each([[1, 49.99], [2, 99.98], [3, 149.97]])('%s box(es): $4.99 Texas, $7.99 nearby, $9.99 far', (quantity, subtotal) => {
    expect(['TX', 'GA', 'AZ'].map((state) => ship([bobBox(quantity)], subtotal, state))).toEqual([4.99, 7.99, 9.99]);
  });

  it('cannot ship one box to a far state (the $60 minimum), but can ship two', () => {
    expect(getDeliveryMinimumShortfall(49.99, 'AZ', false, groundShippingKind([bobBox()]))).toBe(10.01);
    expect(getDeliveryMinimumShortfall(99.98, 'AZ', false, groundShippingKind([bobBox(2)]))).toBe(0);
  });

  it('pays normal rates when mixed or for loose Bobbatlu packs', () => {
    expect(groundShippingKind([bobBox(), malpuri])).toBeUndefined();
    expect(groundShippingKind([{ productId: 'sweet-bobbatlu' }])).toBeUndefined();
    expect(ship([{ productId: 'sweet-bobbatlu' }], 48, 'GA')).toBe(6.99);
  });
});

describe('shipping rate card — Mini Combo only', () => {
  it('ships $3.99 in Texas at any value and pays normal nearby rates', () => {
    expect(ship([mini], 48, 'TX')).toBe(3.99);
    expect(ship([{ ...mini, quantity: 3 }], 144, 'TX')).toBe(3.99);
    expect(ship([mini], 48, 'GA')).toBe(6.99);
    expect(ship([{ ...mini, quantity: 2 }], 96, 'GA')).toBe(5.99);
    expect(ship([{ ...mini, quantity: 3 }], 144, 'GA')).toBe(4.99);
  });

  it('pays normal rates when mixed', () => {
    expect(ship([mini, malpuri], 88, 'TX')).toBe(5.99);
  });
});

describe('shipping rate card — Malai Khaja only', () => {
  it('pays normal Texas rates, $7.99 / $6.99 to nearby states, and a flat $10.99 far with no minimum', () => {
    expect(ship([khaja], 40, 'TX')).toBe(5.99);
    expect(ship([khaja], 125, 'TX')).toBe(3.99);
    // Nearby (owner, 2026-10-15): $7.99 under $60, $6.99 from $60 — including $100 and up.
    expect(ship([khaja], 40, 'GA')).toBe(7.99);
    expect(ship([khaja], 59.99, 'IL')).toBe(7.99);
    expect(ship([khaja], 60, 'OK')).toBe(6.99);
    expect(ship([khaja], 62.5, 'GA')).toBe(6.99);
    expect(ship([khaja], 125, 'GA')).toBe(6.99);
    expect(getDeliveryMinimumShortfall(40, 'GA', false, groundShippingKind([khaja]))).toBe(0);
    expect(ship([khaja], 40, 'AZ')).toBe(10.99);
    expect(ship([khaja], 125, 'OR')).toBe(10.99);
    expect(getDeliveryMinimumShortfall(40, 'AZ', false, groundShippingKind([khaja]))).toBe(0);
  });
});

describe('Malai Khaja mixed with anything else', () => {
  it('goes back to the regular nearby rates', () => {
    expect(ship([khaja, malpuri], 40, 'GA')).toBe(6.99);
    expect(ship([khaja, malpuri], 80, 'GA')).toBe(5.99);
    expect(ship([khaja, malpuri], 125, 'GA')).toBe(4.99);
  });
});

/** California, New York, New Jersey, Virginia and Washington pay $1 more on every delivery rate (owner, 2026-10-23). */
const extra = (code: string) => (['CA', 'NY', 'NJ', 'VA', 'WA'].includes(code) ? 1 : 0);

describe('shipping rate card — $1 extra for California, New York, New Jersey, Virginia and Washington', () => {
  it.each(['CA', 'NY', 'NJ', 'VA', 'WA'])('%s pays a dollar more on every rate', (state) => {
    expect(ship([malpuri], 60, state)).toBe(12.99);
    expect(ship([box()], 60, state)).toBe(7.99); // a 10:10 box-only cart keeps its flat rate
    expect(ship([bobBox()], 60, state)).toBe(10.99);
    expect(ship([khaja], 40, state)).toBe(11.99);
    expect(ship([], 18, state, true)).toBe(7.99);
    expect(ship([box(), malpuri], 100, state)).toBe(12.99);
  });

  it('leaves other far states, pickup and free delivery alone', () => {
    expect(ship([malpuri], 60, 'AZ')).toBe(11.99);
    expect(ship([malpuri], 60, ' ca ')).toBe(12.99);
    expect(calculateShippingQuote(60, { fulfillmentType: 'pickup', deliveryState: 'CA' }).shipping).toBe(0);
    expect(calculateShippingQuote(60, { fulfillmentType: 'delivery', deliveryState: 'NY', freeDelivery: true }).shipping).toBe(0);
  });

  it('keeps saved per-jar pickle quotes as they were', () => {
    expect(calculateShippingQuote(40, { fulfillmentType: 'delivery', deliveryState: 'NY', picklesOnly: true, legacyPickleRates: true, pickleJarCount: 1 }).shipping).toBe(6.99);
  });
});

describe('shipping rate card — pickles only', () => {
  it('pays $5.99 in Texas ($3.99 from $100) and $6.99 everywhere else, with no minimum', () => {
    expect(ship([], 18, 'TX', true)).toBe(5.99);
    expect(ship([], 108, 'TX', true)).toBe(3.99);
    expect(ship([], 18, 'GA', true)).toBe(6.99);
    expect(ship([], 108, 'GA', true)).toBe(6.99);
    expect(ship([], 18, 'AZ', true)).toBe(6.99);
  });

  it.each(DELIVERY_STATE_OPTIONS)('$code: pickles only pay the flat rate with no minimum', ({ code }) => {
    expect(ship([], 19, code, true)).toBe(code === 'TX' ? 5.99 : roundMoney(6.99 + extra(code)));
    expect(getDeliveryMinimumShortfall(19, code, true)).toBe(0);
  });

  it.each(DELIVERY_STATE_OPTIONS)('$code: one 10:10 box ships at its zone rate with no minimum', ({ code }) => {
    const zone = getShippingZone(code);
    expect(ship([box()], 60, code)).toBe(zone === 'texas' ? 3.99 : zone === 'nearby' ? 6.99 : 7.99);
    expect(getDeliveryMinimumShortfall(60, code, false, groundShippingKind([box()]))).toBe(0);
  });

  it('keeps the old per-jar rates only for quotes saved before the flat rate', () => {
    const legacy = (jars: number) => calculateShippingQuote(40, { fulfillmentType: 'delivery', deliveryState: 'GA', picklesOnly: true, legacyPickleRates: true, pickleJarCount: jars }).shipping;
    expect([legacy(1), legacy(2), legacy(3)]).toEqual([6.99, 5.99, 4.99]);
  });
});

describe('cart kinds', () => {
  it('recognises box-only and product-only carts', () => {
    expect(groundShippingKind([])).toBeUndefined();
    expect(groundShippingKind([khaja, khaja])).toBe('malai-khaja');
    expect(groundShippingKind([box(2)])).toBe('assorted-box');
    expect(groundShippingKind([box(), pack])).toBe('assorted-box');
    expect(groundShippingKind([pack])).toBeUndefined();
    expect(groundShippingKind([bobBox(3)])).toBe('bobbatlu-box');
    expect(groundShippingKind([mini])).toBe('mini-combo');
    expect(groundShippingKind([box(), malpuri])).toBeUndefined();
    expect(isGroundShippingCart([box()])).toBe(true);
    expect(isGroundShippingCart([malpuri])).toBe(false);
    expect(containsAssortedBox([malpuri, box()])).toBe(true);
    expect(containsAssortedBox([malpuri])).toBe(false);
  });

  it('classifies zones', () => {
    expect(getShippingZone('tx')).toBe('texas');
    expect(getShippingZone('GA')).toBe('nearby');
    expect(getShippingZone('AZ')).toBe('far');
  });
});

describe('delivery-state validation', () => {
  it('offers every contiguous state plus DC exactly once', () => {
    const codes = DELIVERY_STATE_OPTIONS.map(({ code }) => code);
    expect(codes).toEqual([
      'AL', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA',
      'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA',
      'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
      'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD',
      'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
    ]);
    expect(new Set(codes).size).toBe(49);
    expect(codes.every((code) => isSupportedDeliveryState(code))).toBe(true);
    for (const excluded of ['AK', 'HI', 'PR', 'VI', 'TE', 'TC']) {
      expect(codes).not.toContain(excluded);
    }
    expect(codes.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
  });

  it('rejects full names, state typos, empty values and malformed input', () => {
    for (const state of [
      'T', 'Tex', 'Texas', 'TE', 'TC', 'Not a state', '', '   ', undefined, null, 42, {}, [],
    ]) {
      expect(isSupportedDeliveryState(state)).toBe(false);
    }
  });

  it('normalizes valid code casing and safely handles non-text API input', () => {
    expect(normalizeStateCode(' tx ')).toBe('TX');
    expect(normalizeStateCode(42)).toBe('');
    expect(normalizeStateCode({ state: 'TX' })).toBe('');
  });

  it('accepts all configured contiguous destinations and DC', () => {
    for (const state of ['TX', 'OK', 'OR', 'AZ', 'DC']) {
      expect(isSupportedDeliveryState(state)).toBe(true);
    }
  });

  it('does not allow Alaska, Hawaii, territories or arbitrary input', () => {
    for (const state of ['AK', 'HI', 'PR', 'XX', '', undefined]) {
      expect(isSupportedDeliveryState(state)).toBe(false);
    }
  });
});

describe('pricing — pickup and general', () => {
  it('identifies the standard shipping service consistently', () => {
    expect(shippingMethodLabel('standard')).toBe('UPS 2nd Day Air');
    expect(shippingMethodLabel(undefined)).toBe('UPS 2nd Day Air');
    expect(shippingMethodLabel('standard', true)).toBe('Express shipping');
    expect(shippingMethodLabel(undefined, true)).toBe('Express shipping');
    expect(shippingMethodLabel(null, true)).toBe('Express shipping');
    expect(shippingMethodLabel('ground', true)).toBe('Ground — estimated 2–5 business days in transit');
    expect(shippingMethodLabel('expedited', true)).toBe('Expedited — estimated 2 business days in transit');
  });

  it('does NOT charge shipping for pickup, even below $60', () => {
    expect(calculateOrderTotals(30, { fulfillmentType: 'pickup' }).shipping).toBe(0);
  });

  it('pickup remains free regardless of the merchandise subtotal', () => {
    expect(
      calculateOrderTotals(14, { fulfillmentType: 'pickup' }).shipping
    ).toBe(0);
  });

  it('taxes the delivery fee when Texas merchandise is taxable', () => {
    const t = calculateOrderTotals(30, { fulfillmentType: 'delivery', taxableSubtotal: 30, deliveryState: 'TX' });
    expect(t.tax).toBe(roundMoney((30 + 5.99) * 0.0825));
    expect(t.total).toBe(roundMoney(30 + t.tax + 5.99));
  });

  it('subtotal + tax + shipping always equals total exactly (no float dust), with no operational fee', () => {
    for (const s of [2.5, 5, 14, 16, 30, 37.5, 49.99, 123.45, 999.99]) {
      const totals = calculateOrderTotals(s, { fulfillmentType: 'delivery', deliveryState: 'TX', taxableSubtotal: s });
      expect(Object.keys(totals).sort()).toEqual(['shipping', 'subtotal', 'tax', 'total']);
      expect(roundMoney(totals.subtotal + totals.tax + totals.shipping)).toBe(totals.total);
    }
    for (const s of [2.5, 14, 30, 49.99, 123.45]) {
      const { subtotal, tax, shipping, total } = calculateOrderTotals(s, { fulfillmentType: 'delivery', deliveryState: 'AZ' });
      expect(roundMoney(subtotal + tax + shipping)).toBe(total);
    }
  });

  it('never returns fractional cents', () => {
    for (const s of [2.5, 14, 33.33, 66.67, 87.77]) {
      const { tax, total } = calculateOrderTotals(s);
      expect(Number.isInteger(Math.round(tax * 100))).toBe(true);
      expect(tax * 100).toBeCloseTo(Math.round(tax * 100), 9);
      expect(total * 100).toBeCloseTo(Math.round(total * 100), 9);
    }
  });

  it('coerces junk and negatives to a zero order', () => {
    expect(calculateOrderTotals(0)).toEqual({ subtotal: 0, tax: 0, shipping: 0, total: 0 });
    expect(calculateOrderTotals(-5)).toEqual({ subtotal: 0, tax: 0, shipping: 0, total: 0 });
    expect(calculateOrderTotals(NaN as unknown as number)).toEqual({
      subtotal: 0, tax: 0, shipping: 0, total: 0,
    });
  });

  it('rounds half up to the nearest cent', () => {
    expect(roundMoney(1.155)).toBe(1.16);
    expect(roundMoney(0.005)).toBe(0.01);
    expect(roundMoney(2.674999)).toBe(2.67);
  });
});



describe('deliveryService', () => {
  it('names the service customers are told about, by zone and cart', () => {
    // Texas: always the 1-day estimate.
    expect(deliveryService('TX', false, undefined)).toBe('texas');
    expect(deliveryService('TX', true, undefined)).toBe('texas');
    // Nearby states: Express, including box-only and Malai Khaja-only carts.
    expect(deliveryService('OK', false, undefined)).toBe('express');
    expect(deliveryService('FL', false, 'assorted-box')).toBe('express');
    expect(deliveryService('IA', false, 'malai-khaja')).toBe('express');
    // Other states: UPS 2nd Day Air, except box/product-only carts ("Express shipping").
    expect(deliveryService('AZ', false, undefined)).toBe('second-day-air');
    expect(deliveryService('OR', false, 'assorted-box')).toBe('standard');
    expect(deliveryService('OR', false, 'bobbatlu-box')).toBe('standard');
    expect(deliveryService('AZ', false, 'malai-khaja')).toBe('standard');
    // Pickle-only outside Texas: Standard everywhere.
    expect(deliveryService('OK', true, undefined)).toBe('standard');
    expect(deliveryService('AZ', true, undefined)).toBe('standard');
  });

  it('labels each service, keeping a legacy recorded method', () => {
    expect(deliveryServiceLabel('texas')).toBe('Shipping (estimated 1 business day after dispatch)');
    expect(deliveryServiceLabel('express')).toBe('Express shipping (2-day ETA)');
    expect(deliveryServiceLabel('second-day-air')).toBe('UPS 2nd Day Air');
    expect(deliveryServiceLabel('standard', 'standard')).toBe('Express shipping');
    expect(deliveryServiceLabel('express', 'ground')).toBe('Ground — estimated 2–5 business days in transit');
  });

  it('treats nearby Express and UPS 2nd Day Air as express for the sweets note', () => {
    expect(isExpressDeliveryService('express')).toBe(true);
    expect(isExpressDeliveryService('second-day-air')).toBe(true);
    expect(isExpressDeliveryService('standard')).toBe(false);
    expect(isExpressDeliveryService('texas')).toBe(false);
  });
});


describe('deliveryRestriction', () => {
  const sweetMemories = getProductById('gift-box-sweet-memories')!;
  const mini = getProductById('gift-box-mini-combo')!;

  it('refuses delivery of the pickup-only $30 box anywhere, at any subtotal', () => {
    for (const state of ['TX', 'OK', 'AZ', null]) {
      expect(deliveryRestriction(sweetMemories, state, 500)).toContain('is pickup only');
    }
  });

  it('delivers the Mini Combo Pack only within Texas and nearby states', () => {
    expect(deliveryRestriction(mini, 'TX', 48)).toBeNull();
    expect(deliveryRestriction(mini, 'FL', 48)).toBeNull();
    expect(deliveryRestriction(mini, 'AZ', 500)).toBe(
      'Mini Combo Pack - #Delivery is delivered within Texas and nearby states only. Choose pickup, remove it from your cart, or select an address in Texas and nearby states.'
    );
  });

  it('leaves unrestricted products alone', () => {
    expect(deliveryRestriction(getProductById('sweet-malpuri')!, 'AZ', 40)).toBeNull();
  });

  it('still supports a state list with an out-of-state minimum', () => {
    const product = { name: 'Test Box', deliveryStateCodes: ['TX'], deliveryOutsideStateMinimum: 60 };
    expect(deliveryRestriction(product, 'TX', 30)).toBeNull();
    expect(deliveryRestriction(product, 'OK', 60)).toBeNull();
    expect(deliveryRestriction(product, 'OK', 30)).toContain('Add $30.00 more');
  });
});

