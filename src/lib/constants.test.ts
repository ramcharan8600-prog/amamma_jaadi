import { describe, it, expect } from 'vitest';
import { SITE_URL } from './constants';

describe('SITE_URL', () => {
  /**
   * Regression guard. SITE_URL used to read the build-time NEXT_PUBLIC_SITE_URL,
   * so a local build baked `http://localhost:3000` into order confirmation
   * emails — recipients' mail clients tried to load the logo from their own
   * machine and showed a broken image. It must stay a hardcoded absolute
   * production URL.
   */
  it('is the absolute production origin', () => {
    expect(SITE_URL).toBe('https://amammajaadi.com');
  });

  it('is never localhost, even when the env var says so', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    expect(SITE_URL).not.toContain('localhost');
    expect(SITE_URL.startsWith('https://')).toBe(true);
  });

  it('has no trailing slash, so `${SITE_URL}/path` stays well formed', () => {
    expect(SITE_URL.endsWith('/')).toBe(false);
  });
});
