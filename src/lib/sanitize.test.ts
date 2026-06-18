import { describe, it, expect } from 'vitest';
import { sanitize } from '@/lib/sanitize';

describe('sanitize', () => {
  it('trims whitespace', () => {
    expect(sanitize('  hello  ')).toBe('hello');
  });

  it('strips angle brackets (basic XSS hardening)', () => {
    expect(sanitize('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
  });

  it('caps length to maxLen', () => {
    expect(sanitize('abcdefghij', 4)).toBe('abcd');
  });

  it('returns empty string for non-string input', () => {
    expect(sanitize(undefined)).toBe('');
    expect(sanitize(null)).toBe('');
    expect(sanitize(42)).toBe('');
    expect(sanitize({})).toBe('');
  });

  it('defaults maxLen to 500', () => {
    const long = 'x'.repeat(600);
    expect(sanitize(long).length).toBe(500);
  });
});
