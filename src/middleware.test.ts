import { describe, expect, it } from 'vitest';

import { buildCsp, cacheControlForPath, isPreviewHost } from './middleware';

describe('checkout Content Security Policy', () => {
  it('allows issuer-hosted HTTPS frames and 3-D Secure form submissions', () => {
    const csp = buildCsp();

    expect(csp).toContain("frame-src 'self' https:");
    expect(csp).toContain("form-action 'self' https:");
  });
});

describe('response cache privacy', () => {
  it('never permits API or admin responses to be stored', () => {
    expect(cacheControlForPath('/api/orders')).toBe('private, no-store');
    expect(cacheControlForPath('/admin/dashboard')).toBe('private, no-store');
  });

  it('keeps the short shared cache for public storefront pages', () => {
    expect(cacheControlForPath('/sweets')).toBe(
      'public, max-age=0, s-maxage=60, must-revalidate'
    );
  });
});

describe('sandbox indexing protection', () => {
  it('identifies workers.dev preview hosts without affecting production', () => {
    expect(isPreviewHost('amammajaadi-sandbox.ramcharan8600.workers.dev')).toBe(true);
    expect(isPreviewHost('amammajaadi.com')).toBe(false);
  });
});
