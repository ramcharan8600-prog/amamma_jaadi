import { describe, it, expect } from 'vitest';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

describe('rateLimit (sliding window)', () => {
  it('allows up to the limit then blocks', () => {
    const key = `test-${Math.random()}`;
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(false); // 4th blocked
  });

  it('tracks distinct keys independently', () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    expect(rateLimit(a, 1, 60_000)).toBe(true);
    expect(rateLimit(a, 1, 60_000)).toBe(false);
    expect(rateLimit(b, 1, 60_000)).toBe(true); // different bucket
  });

  it('resets after the window elapses', () => {
    const key = `win-${Math.random()}`;
    expect(rateLimit(key, 1, 1)).toBe(true);
    // Window is 1ms; wait a tick so it resets.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(rateLimit(key, 1, 1)).toBe(true);
        resolve();
      }, 5);
    });
  });
});

describe('getClientIp', () => {
  it('reads the first x-forwarded-for entry', () => {
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18' },
    });
    expect(getClientIp(req)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip', () => {
    const req = new Request('http://x', { headers: { 'x-real-ip': '198.51.100.2' } });
    expect(getClientIp(req)).toBe('198.51.100.2');
  });

  it('returns "unknown" with no ip headers', () => {
    expect(getClientIp(new Request('http://x'))).toBe('unknown');
  });
});
