import { describe, expect, it } from 'vitest';
import {
  isValidCustomerName,
  isValidEmail,
  isValidPhone,
  normalizeUsPhone,
  toUsE164,
  validateRequiredContact,
} from '@/lib/contact-validation';

describe('checkout contact validation', () => {
  it('requires a meaningful customer name', () => {
    expect(isValidCustomerName('Siri')).toBe(true);
    expect(isValidCustomerName(' ')).toBe(false);
    expect(isValidCustomerName('A')).toBe(false);
  });

  it('accepts normal emails and rejects malformed values', () => {
    expect(isValidEmail('buyer@example.com')).toBe(true);
    expect(isValidEmail('buyer@')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it.each([
    ['4695550123', '4695550123'],
    ['(469) 555-0123', '4695550123'],
    ['469-555-0123', '4695550123'],
    ['14695550123', '4695550123'],
    ['+1 (469) 555-0123', '4695550123'],
    ['+1 469 555 0123', '4695550123'],
  ])('normalizes US phone %j to %s', (value, digits) => {
    expect(normalizeUsPhone(value)).toBe(digits);
    expect(isValidPhone(value)).toBe(true);
    expect(toUsE164(value)).toBe(`+1${digits}`);
  });

  it.each(['', '   ', '123', '4695550', '469555012', '24695550123', '1469555012',
    '1234567890', '0695550123', '4691550123', '+91 98765 43210', '123456789012345',
    4695550123, null, undefined])('rejects non-US or invalid phone value %j', value => {
    expect(normalizeUsPhone(value)).toBeNull();
    expect(isValidPhone(value)).toBe(false);
    expect(toUsE164(value)).toBeUndefined();
  });

  it('returns the first missing or invalid required field', () => {
    expect(validateRequiredContact({ name: '', phone: '4695550123', email: 'buyer@example.com' }))
      .toBe('Customer name is required');
    expect(validateRequiredContact({ name: 'Buyer', phone: '123', email: 'buyer@example.com' }))
      .toBe('Enter a 10-digit US phone number');
    expect(validateRequiredContact({ name: 'Buyer', phone: '4695550123', email: 'bad' }))
      .toBe('Valid email address is required');
    expect(validateRequiredContact({ name: 'Buyer', phone: '4695550123', email: 'buyer@example.com' }))
      .toBeNull();
  });
});
