import { describe, expect, it } from 'vitest';
import { canonicalHostRedirect } from '@/lib/canonical-host';

const get = (url: string, method = 'GET') => canonicalHostRedirect(new Request(url, { method }));

describe('canonicalHostRedirect', () => {
  it('sends www page views to the same path and query on the bare domain', () => {
    const res = get('https://www.amammajaadi.com/sweets?utm_source=reel&x=1');
    expect(res?.status).toBe(301);
    expect(res?.headers.get('Location')).toBe('https://amammajaadi.com/sweets?utm_source=reel&x=1');
    expect(get('https://www.amammajaadi.com/')?.headers.get('Location')).toBe('https://amammajaadi.com/');
    expect(get('http://www.amammajaadi.com/checkout')?.headers.get('Location')).toBe('https://amammajaadi.com/checkout');
    expect(get('https://www.amammajaadi.com/about', 'HEAD')?.status).toBe(301);
  });

  it('keeps a short browser cache so the redirect can be undone', () => {
    expect(get('https://www.amammajaadi.com/')?.headers.get('Cache-Control')).toBe('public, max-age=86400');
  });

  it('lets www keep serving API calls and the Apple Pay domain file', () => {
    expect(get('https://www.amammajaadi.com/api/payments/process', 'POST')).toBeNull();
    expect(get('https://www.amammajaadi.com/api/inventory')).toBeNull();
    expect(get('https://www.amammajaadi.com/.well-known/apple-developer-merchantid-domain-association')).toBeNull();
  });

  it('never redirects non-GET requests, even to pages', () => {
    expect(get('https://www.amammajaadi.com/checkout', 'POST')).toBeNull();
  });

  it('leaves the bare domain, sandbox and look-alike hosts alone', () => {
    expect(get('https://amammajaadi.com/sweets')).toBeNull();
    expect(get('https://amammajaadi-sandbox.ramcharan8600.workers.dev/')).toBeNull();
    expect(get('http://localhost:3000/')).toBeNull();
    expect(get('https://www.amammajaadi.com.evil.example/')).toBeNull();
    expect(get('https://shop.amammajaadi.com/')).toBeNull();
  });
});
