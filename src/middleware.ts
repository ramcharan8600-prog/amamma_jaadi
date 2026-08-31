import { NextRequest, NextResponse } from 'next/server';

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

/**
 * Content-Security-Policy for the storefront + admin.
 *
 * `'unsafe-inline'` is required for `script-src` because the Next.js App Router
 * injects inline bootstrap/hydration scripts; tightening this to a per-request
 * nonce is a worthwhile future step. The Square Web Payments SDK is allowed
 * explicitly — it loads `square.js`, mounts the card fields inside an iframe,
 * and posts the card token to `pci-connect.*`, so `script-src` / `frame-src` /
 * `connect-src` must include Square's origins. Both production and sandbox
 * hosts are listed so the same policy works in either environment.
 *
 * ⚠️  A wrong directive here silently breaks the LIVE card form. Verify checkout
 *     on a preview deploy before promoting any change to this policy. To debug
 *     without blocking, temporarily send this value as the
 *     `Content-Security-Policy-Report-Only` header instead.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: https:",
  "font-src 'self' data: https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net https://cash-f.squarecdn.com",
  "style-src 'self' 'unsafe-inline' https://web.squarecdn.com https://sandbox.web.squarecdn.com",
  "script-src 'self' 'unsafe-inline' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://js.squareup.com https://static.cloudflareinsights.com",
  "frame-src https://web.squarecdn.com https://sandbox.web.squarecdn.com https://connect.squareup.com https://connect.squareupsandbox.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com",
  "connect-src 'self' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://connect.squareup.com https://connect.squareupsandbox.com https://static.cloudflareinsights.com https://cloudflareinsights.com",
  'upgrade-insecure-requests',
].join('; ');

/** Apply hardening headers to every response (redirects included). */
function withSecurityHeaders(response: NextResponse, request: NextRequest): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // CSP + HSTS only in production: local `next dev` serves over plain http and
  // uses inline eval for HMR, so enforcing these would only add dev-console noise.
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Content-Security-Policy', CSP);
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // HTML pages must revalidate on every visit so a deploy never leaves browsers
  // loading stale HTML that references JS chunks that no longer exist (white
  // blank page). Static assets under /_next/static/ are content-hashed and
  // already cached immutably by Next.js — this only targets page navigations.
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/_next/') && !pathname.startsWith('/images/')) {
    response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  }

  return response;
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
