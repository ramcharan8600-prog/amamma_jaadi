import { NextRequest, NextResponse } from 'next/server';
import { buildCsp, HARDENING_HEADERS, PREVIEW_HOST_ROBOTS, productionSecurityHeaders } from '@/lib/security-headers.mjs';

export { buildCsp };

const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;
const SESSION_COOKIE = 'admin_session';

/**
 * Read the signing secret at REQUEST time, not module load — on Cloudflare/
 * OpenNext, runtime secrets aren't reliably populated during module evaluation,
 * which would otherwise fail-close admin auth even when the secret is set.
 */
function getSessionSecret(): string {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
}

/** Verify HMAC-signed session token using Web Crypto API (Edge-compatible) */
async function verifyToken(token: string): Promise<boolean> {
  try {
    // Fail closed: never verify against an empty/unknown key. An empty HMAC
    // key is publicly known and would let an attacker forge session tokens.
    const SESSION_SECRET = getSessionSecret();
    if (!SESSION_SECRET) {
      console.error('SESSION_SECRET not set — rejecting all admin sessions');
      return false;
    }

    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [timestamp, nonce, sig] = parts;

    const age = Date.now() - parseInt(timestamp, 10);
    if (isNaN(age) || age < 0 || age > SESSION_MAX_AGE) return false;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(SESSION_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`${timestamp}.${nonce}`)
    );

    const expectedBytes = new Uint8Array(signatureBuffer);
    const sigBytes = new Uint8Array(
      sig.match(/.{2}/g)!.map((h) => parseInt(h, 16))
    );

    // Timing-safe comparison — prevent side-channel attacks
    if (sigBytes.length !== expectedBytes.length) return false;
    let diff = 0;
    for (let i = 0; i < expectedBytes.length; i++) diff |= sigBytes[i] ^ expectedBytes[i];
    return diff === 0;
  } catch {
    return false;
  }
}

/** Apply hardening headers to every response (redirects included). */
function withSecurityHeaders(response: NextResponse, request: NextRequest): NextResponse {
  for (const [name, value] of HARDENING_HEADERS) response.headers.set(name, value);

  const { pathname } = request.nextUrl;

  // Preview/sandbox Workers URLs must not compete with the production domain
  // in search results. This never applies to the custom amammajaadi.com host.
  if (isPreviewHost(request.nextUrl.hostname)) {
    response.headers.set('X-Robots-Tag', PREVIEW_HOST_ROBOTS);
  } else if (isNoIndexPath(pathname)) {
    // Cart/payment, admin and API addresses stay out of Google. robots.txt lets
    // Google fetch checkout and admin so it can read this (Search Console
    // otherwise reports them as "Blocked by robots.txt").
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  // CSP + HSTS only in production: local `next dev` serves over plain http and
  // uses inline eval for HMR, so enforcing these would only add dev-console noise.
  if (process.env.NODE_ENV === 'production') {
    for (const [name, value] of productionSecurityHeaders()) response.headers.set(name, value);
  }

  // HTML pages must revalidate on every visit so a deploy never leaves browsers
  // loading stale HTML that references JS chunks that no longer exist (white
  // blank page). Static assets under /_next/static/ are content-hashed and
  // already cached immutably by Next.js — this only targets page navigations.
  //
  // `s-maxage` additionally lets Cloudflare's *shared* edge cache answer repeat
  // views for a short window without invoking the Worker at all. That matters
  // during a traffic spike: 50 homepage views in a minute become 1 invocation
  // instead of 50, which is what pushes a busy moment past the CPU limit.
  // `max-age=0` keeps browsers revalidating, so stale HTML still cannot come
  // back; the only cost is up to 60s of previous content right after a deploy.
  //
  // Deliberately NOT edge-cached:
  //   /api   — per-request data (stock counts, coupon checks); a shared copy
  //            would hand one customer another's answer.
  //   /admin — authenticated pages must never sit in a cache shared by everyone.
  if (!pathname.startsWith('/_next/') && !pathname.startsWith('/images/')) {
    response.headers.set('Cache-Control', cacheControlForPath(pathname));
  }

  return response;
}

/** Keep customer/admin data out of browser and shared intermediary caches. */
export function cacheControlForPath(pathname: string): string {
  const isPrivate = pathname.startsWith('/api/') || pathname.startsWith('/admin');
  return isPrivate
    ? 'private, no-store'
    : 'public, max-age=0, s-maxage=60, must-revalidate';
}

/** Pages that must never appear in search results. */
export function isNoIndexPath(pathname: string): boolean {
  return pathname === '/checkout' || pathname.startsWith('/checkout/') ||
    pathname.startsWith('/admin') || pathname.startsWith('/api/');
}

export function isPreviewHost(hostname: string): boolean {
  return hostname.endsWith('.workers.dev');
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login')) {
    const session = request.cookies.get(SESSION_COOKIE);

    if (!session?.value || !(await verifyToken(session.value))) {
      const redirect = NextResponse.redirect(new URL('/admin/login', request.url));
      redirect.cookies.delete(SESSION_COOKIE);
      return withSecurityHeaders(redirect, request);
    }
  }

  return withSecurityHeaders(NextResponse.next(), request);
}

export const config = {
  matcher: ['/admin/:path*', '/((?!_next/static|_next/image|favicon.ico|images/).*)'],
};
