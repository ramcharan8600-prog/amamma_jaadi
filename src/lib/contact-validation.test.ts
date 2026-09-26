import { describe, expect, it } from 'vitest';
import {
  isValidCustomerName,
  isValidEmail,
  isValidPhone,
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

  it.each(['4695550123', '14695550123', '+1 (469) 555-0123', '(469) 555-0123', '469-555-0123',
    '4695550', '+91 98765 43210', '123456789012345'])('accepts phone value %j (7-15 digits)', value => {
    expect(isValidPhone(value)).toBe(true);
  });

  it.each(['', '   ', '123', '469555', '1234567890123456', '+1 (469) 555-0123 ext 99999',
    4695550123, null, undefined])('rejects invalid phone value %j', value => {
    expect(isValidPhone(value)).toBe(false);
  });

  it('returns the first missing or invalid required field', () => {
    expect(validateRequiredContact({ name: '', phone: '4695550123', email: 'buyer@example.com' }))
      .toBe('Customer name is required');
    expect(validateRequiredContact({ name: 'Buyer', phone: '123', email: 'buyer@example.com' }))
      .toBe('Valid phone number is required');
    expect(validateRequiredContact({ name: 'Buyer', phone: '4695550123', email: 'bad' }))
      .toBe('Valid email address is required');
    expect(validateRequiredContact({ name: 'Buyer', phone: '4695550123', email: 'buyer@example.com' }))
      .toBeNull();
  });
});
