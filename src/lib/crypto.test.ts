import { describe, it, expect } from 'vitest';
import { safeEqual } from '@/lib/crypto';

describe('safeEqual (constant-time compare)', () => {
  it('returns true for identical strings', () => {
    expect(safeEqual('REDACTED', 'REDACTED')).toBe(true);
  });

  it('returns false for different same-length strings', () => {
    expect(safeEqual('abcdef', 'abcxef')).toBe(false);
  });

  it('returns false for different-length strings without throwing', () => {
    expect(safeEqual('short', 'a-much-longer-secret')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(safeEqual('', '')).toBe(true);
  });

  it('is unicode-safe', () => {
    expect(safeEqual('jaadi-🍬', 'jaadi-🍬')).toBe(true);
    expect(safeEqual('jaadi-🍬', 'jaadi-🍭')).toBe(false);
  });
});
