import { describe, expect, it } from 'vitest';
import { getPickupDateBounds, getPickupDateError, getNextPickupRefreshDelay, isPickupClosedDate, requiresNextDayPickup } from './pickup-date';

const now = new Date('2026-09-08T18:00:00Z');

describe('pickup date validation in Dallas time', () => {
  it('allows today through day 90 inclusive, not day 91', () => {
    expect(getPickupDateBounds(150, now)).toEqual({ today: '2026-09-08', min: '2026-09-08', max: '2026-12-07' });
    // Today (Tuesday, Sept 8) is in range but closed; see the Tuesday tests below.
    for (const value of ['2026-09-09', '2026-09-10', '2026-12-07']) {
      expect(getPickupDateError(value, 150, now)).toBeNull();
    }
    expect(getPickupDateError('2026-12-08', 150, now)).toContain('90 days');
    expect(getPickupDateError('2026-09-07', 150, now)).toContain('past');
  });

  it.each([undefined, null, '', 20260909, {}, [], true, '122026-01-09', '2099-01-01',
    '2026-9-09', '2026-09-9', ' 2026-09-09', '2026-09-09 ', '2026-09-09T00:00:00Z',
    '2026-02-29', '2026-02-30', '2026-09-31', '2026-00-01', '2026-13-01', '2026-09-00'])
    ('rejects malformed or unavailable date %j', (value) => {
      expect(getPickupDateError(value, 16, now)).not.toBeNull();
    });

  it('preserves the large-order lead time and does not extend its maximum', () => {
    const wednesday = new Date('2026-09-09T18:00:00Z');
    expect(getPickupDateError('2026-09-09', 150, wednesday)).toBeNull();
    expect(getPickupDateError('2026-09-09', 151, wednesday)).toContain('1 day notice');
    expect(getPickupDateError('2026-09-10', 151, wednesday)).toBeNull();
    expect(getPickupDateBounds(151, now).max).toBe('2026-12-07');
  });

  it('uses Dallas midnight, not UTC or the customer timezone', () => {
    expect(getPickupDateBounds(16, new Date('2026-09-09T04:59:59Z'))).toMatchObject({ today: '2026-09-08', min: '2026-09-09' });
    expect(getPickupDateError('2026-09-08', 16, new Date('2026-09-09T05:00:00Z'))).toContain('past');
  });

  it.each([
    ['2026-03-08T05:30:00Z', '2026-03-07', '2026-03-08', '2026-06-05'],
    ['2026-11-01T04:30:00Z', '2026-10-31', '2026-11-01', '2027-01-29'],
    ['2026-12-31T18:00:00Z', '2026-12-31', '2027-01-01', '2027-03-31'],
  ])('uses calendar days across DST/year rollover at %s', (instant, today, min, max) => {
    expect(getPickupDateBounds(151, new Date(instant))).toEqual({ today, min, max });
  });

  it('handles real leap days, including century rules', () => {
    // Both leap days fall on a Tuesday: accepted as real dates, then closed.
    expect(getPickupDateError('2028-02-29', 16, new Date('2028-02-01T18:00:00Z'))).toContain('Tuesdays');
    expect(getPickupDateError('2000-02-29', 16, new Date('2000-02-01T18:00:00Z'))).toContain('Tuesdays');
    expect(getPickupDateError('2100-02-29', 16, new Date('2100-02-01T18:00:00Z'))).toContain('valid');
  });
});

describe('Tuesday pickup closure', () => {
  it('marks every Tuesday closed and no other day', () => {
    expect(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-06', '2026-10-04'].map(isPickupClosedDate))
      .toEqual([false, true, false, true, false]);
  });

  it('rejects a Tuesday pickup, including today, while other days stay open', () => {
    const monday = new Date('2026-09-28T15:00:00Z');
    expect(getPickupDateError('2026-09-29', 16, monday)).toBe('Pickup is not available on Tuesdays. Please select another date.');
    expect(getPickupDateError('2026-09-28', 16, monday)).toBeNull();
    expect(getPickupDateError('2026-09-30', 16, monday)).toBeNull();
    expect(getPickupDateError('2026-09-08', 16, now)).toContain('Tuesdays');
  });
});

describe('same-day pickup cutoff and product restrictions', () => {
  it.each([
    ['2026-09-17T18:29:59.999Z', '2026-09-17'],
    ['2026-09-17T18:30:00.000Z', '2026-09-17'],
    ['2026-09-17T18:30:00.001Z', '2026-09-18'],
    ['2026-01-17T19:29:59.999Z', '2026-01-17'],
    ['2026-01-17T19:30:00.000Z', '2026-01-17'],
    ['2026-01-17T19:30:00.001Z', '2026-01-18'],
    ['2026-03-08T18:30:00.000Z', '2026-03-08'],
    ['2026-03-08T18:30:00.001Z', '2026-03-09'],
    ['2026-11-01T19:30:00.000Z', '2026-11-01'],
    ['2026-11-01T19:30:00.001Z', '2026-11-02'],
    ['2026-12-31T19:30:00.000Z', '2026-12-31'],
    ['2026-12-31T19:30:00.001Z', '2027-01-01'],
  ])('starts pickup at %s with minimum %s', (instant, min) => {
    const time = new Date(instant);
    const bounds = getPickupDateBounds(16, time);
    expect(bounds.min).toBe(min);
    expect(getPickupDateError(min, 16, time)).toBeNull();
    if (bounds.today !== min) expect(getPickupDateError(bounds.today, 16, time)).toContain('1:30 PM Central');
  });

  it.each(['sweet-bobbatlu', 'sweet-kova-bobbatlu', 'sweet-kova'])('requires tomorrow for %s alone and in mixed carts before the cutoff', productId => {
    for (const items of [[{ productId }], [{ productId: 'pickle-chicken' }, { productId }]]) {
      const hasNextDayProduct = requiresNextDayPickup(items);
      expect(hasNextDayProduct).toBe(true);
      expect(getPickupDateBounds(16, now, hasNextDayProduct).min).toBe('2026-09-09');
      expect(getPickupDateError('2026-09-08', 16, now, hasNextDayProduct)).toContain('Bobbatlu or Kova');
      expect(getPickupDateError('2026-09-09', 16, now, hasNextDayProduct)).toBeNull();
    }
  });

  it('does not impose the product restriction on other sweets, pickles, or gift boxes', () => {
    expect(requiresNextDayPickup([
      { productId: 'sweet-malpuri' }, { productId: 'sweet-malai-khaja' },
      { productId: 'pickle-chicken' }, { productId: 'gift-box-sweet-memories' },
    ])).toBe(false);
  });

  it.each([
    ['2026-09-17T18:29:59.999Z', 2],
    ['2026-09-17T18:30:00.000Z', 1],
    ['2026-09-17T18:30:00.001Z', (10 * 60 + 30) * 60_000 - 1],
    ['2026-09-18T04:59:59Z', 1000],
    ['2026-09-18T05:00:00Z', (13 * 60 + 30) * 60_000 + 1],
    ['2026-03-08T06:00:00Z', (12 * 60 + 30) * 60_000 + 1],
    ['2026-11-01T05:00:00Z', (14 * 60 + 30) * 60_000 + 1],
  ])('refreshes at the next cutoff or midnight from %s without polling', (instant, delay) => {
    expect(getNextPickupRefreshDelay(new Date(instant))).toBe(delay);
  });
});
