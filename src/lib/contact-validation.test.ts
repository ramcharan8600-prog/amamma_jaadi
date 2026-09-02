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

  it('accepts formatted international phone numbers with 7-15 digits', () => {
    expect(isValidPhone('+1 (469) 555-0123')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
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
