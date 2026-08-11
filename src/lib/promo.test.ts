import { describe, it, expect } from 'vitest';
import { PROMO_CODES, normalizePromoCode, validatePromoCode, type PromoCode } from './promo';

describe('promo codes — current state', () => {
  it('has no active codes yet (the field is for future campaigns)', () => {
    expect(PROMO_CODES).toEqual([]);
  });

  it('rejects any code while none are active', () => {
    const r = validatePromoCode('SAVE10', 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/isn't valid/i);
  });

  it('asks for a code when the field is empty', () => {
    const r = validatePromoCode('   ', 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/enter a promo code/i);
  });
});

describe('normalizePromoCode', () => {
  it('trims, strips spaces and uppercases', () => {
    expect(normalizePromoCode('  save10 ')).toBe('SAVE10');
    expect(normalizePromoCode('sa ve 10')).toBe('SAVE10');
    expect(normalizePromoCode('')).toBe('');
  });
});

/**
 * The registry is empty today, so exercise the rules against a local list to
 * prove a future campaign will behave before it is switched on for customers.
 */
describe('promo rules (against sample codes)', () => {
  const percent: PromoCode = { code: 'TEN', label: '10% off', type: 'percent', value: 10 };
  const fixed: PromoCode = { code: 'FIVE', label: '$5 off', type: 'fixed', value: 5 };

  function check(list: PromoCode[], code: string, subtotal: number, today?: Date) {
    const original = [...PROMO_CODES];
    PROMO_CODES.push(...list);
    try {
      return validatePromoCode(code, subtotal, today);
    } finally {
      PROMO_CODES.length = 0;
      PROMO_CODES.push(...original);
    }
  }

  it('applies a percentage discount', () => {
    const r = check([percent], 'ten', 50);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.discount).toBe(5);
  });

  it('applies a fixed discount', () => {
    const r = check([fixed], 'FIVE', 40);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.discount).toBe(5);
  });

  it('never discounts more than the order is worth', () => {
    const r = check([{ ...fixed, value: 999 }], 'FIVE', 20);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.discount).toBe(20);
  });

  it('enforces a minimum subtotal', () => {
    const r = check([{ ...fixed, minSubtotal: 50 }], 'FIVE', 30);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/minimum order/i);
  });

  it('rejects an expired code but accepts it on the last valid day', () => {
    const expiring = { ...fixed, expiresAt: '2026-08-01' };
    const after = check([expiring], 'FIVE', 40, new Date('2026-08-02T12:00:00Z'));
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.reason).toMatch(/expired/i);

    const onDay = check([expiring], 'FIVE', 40, new Date('2026-08-01T23:00:00Z'));
    expect(onDay.ok).toBe(true);
  });
});
