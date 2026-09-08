import { describe, expect, it } from 'vitest';
import { getPickupDateBounds, getPickupDateError } from './pickup-date';

const now = new Date('2026-09-08T18:00:00Z');

describe('pickup date validation in Dallas time', () => {
  it('allows today through day 90 inclusive, not day 91', () => {
    expect(getPickupDateBounds(150, now)).toEqual({ today: '2026-09-08', min: '2026-09-08', max: '2026-12-07' });
    for (const value of ['2026-09-08', '2026-09-09', '2026-12-07']) {
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
    expect(getPickupDateError('2026-09-08', 150, now)).toBeNull();
    expect(getPickupDateError('2026-09-08', 151, now)).toContain('1 day notice');
    expect(getPickupDateError('2026-09-09', 151, now)).toBeNull();
    expect(getPickupDateBounds(151, now).max).toBe('2026-12-07');
  });

  it('uses Dallas midnight, not UTC or the customer timezone', () => {
    expect(getPickupDateError('2026-09-08', 16, new Date('2026-09-09T04:59:59Z'))).toBeNull();
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
    expect(getPickupDateError('2028-02-29', 16, new Date('2028-02-01T18:00:00Z'))).toBeNull();
    expect(getPickupDateError('2000-02-29', 16, new Date('2000-02-01T18:00:00Z'))).toBeNull();
    expect(getPickupDateError('2100-02-29', 16, new Date('2100-02-01T18:00:00Z'))).toContain('valid');
  });
});
