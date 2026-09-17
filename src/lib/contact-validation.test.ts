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

  it('accepts exactly ten digits', () => {
    expect(isValidPhone('4695550123')).toBe(true);
  });

  it.each(['', '123', '4695550', '469555012', '14695550123', '123456789012345',
    '+1 (469) 555-0123', '(469) 555-0123', '4695550123x', '4695550123\n',
    ' 4695550123', 4695550123, null, undefined])('rejects invalid phone value %j', value => {
    expect(isValidPhone(value)).toBe(false);
  });

  it('returns the first missing or invalid required field', () => {
    expect(validateRequiredContact({ name: '', phone: '4695550123', email: 'buyer@example.com' }))
      .toBe('Customer name is required');
    expect(validateRequiredContact({ name: 'Buyer', phone: '123', email: 'buyer@example.com' }))
      .toBe('Phone number must contain exactly 10 digits');
    expect(validateRequiredContact({ name: 'Buyer', phone: '4695550123', email: 'bad' }))
      .toBe('Valid email address is required');
    expect(validateRequiredContact({ name: 'Buyer', phone: '4695550123', email: 'buyer@example.com' }))
      .toBeNull();
  });
});
