import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { buildCsp, cacheControlForPath, isNoIndexPath, isPreviewHost } from './middleware';

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

describe('search engines (Search Console "Blocked by robots.txt")', () => {
  it('marks checkout, admin and API addresses noindex, and leaves shop pages indexable', () => {
    for (const path of ['/checkout', '/admin/login', '/admin/orders', '/api/sold-out-dates']) expect(isNoIndexPath(path)).toBe(true);
    for (const path of ['/', '/sweets', '/pickles', '/gift-boxes', '/events', '/about', '/checkouts-guide']) expect(isNoIndexPath(path)).toBe(false);
  });

  it('robots.txt lets Google read checkout and admin pages (they carry noindex) and still skips the API', () => {
    const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).not.toMatch(/Disallow: \/checkout/);
    expect(robots).not.toMatch(/Disallow: \/admin/);
    expect(robots).toContain('Sitemap: https://amammajaadi.com/sitemap.xml');
  });
});
