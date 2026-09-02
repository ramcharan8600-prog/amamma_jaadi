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
/**
 * `frame-src` is deliberately broad, site-wide. Read this before narrowing it.
 *
 * When a card issuer requires a 3-D Secure challenge, Square renders it in an
 * iframe served by *the bank's own domain*, chosen per transaction. Square
 * neither controls nor publishes that set (confirmed by Square support; Adyen
 * documents the identical constraint and also recommends a wildcard), so no
 * allowlist can ever be complete.
 *
 * This was first scoped to /checkout only — which does NOT work, and the
 * failure is invisible in testing. CSP binds to the *document*, and the App
 * Router's client-side navigation never creates a new one, so a customer who
 * lands on the homepage and clicks through to checkout keeps the homepage's
 * policy through the entire payment. Only a direct load of /checkout got the
 * relaxed rule. Verified in production: an https iframe is allowed on a direct
 * /checkout load and blocked on the same page reached by clicking.
 *
 * A refused frame does not throw — tokenize() simply never settles, so the
 * customer watches a spinner forever and no payment reaches Square.
 *
 * What this does NOT give up: `frame-ancestors 'none'` still stops anyone
 * embedding *us*, and script-src / connect-src / object-src are unchanged.
 * Issuer 3DS frames are sandboxed, so embedding one adds no script-execution
 * surface.
 */
const FRAME_SRC = "frame-src 'self' https:";

/** Same-origin collector for violation reports (see /api/csp-report). */
const CSP_REPORT_PATH = '/api/csp-report';

/**
 * Build the policy. Identical on every route — see FRAME_SRC above for why a
 * per-route policy cannot work under client-side navigation.
 */
export function buildCsp(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    // Square's 3DS challenge starts in an about:blank iframe and POSTs to the
    // card issuer. The iframe inherits this document's CSP, so restricting
    // form-action to self leaves the issuer challenge visibly blank.
    "form-action 'self' https:",
    "img-src 'self' data: https:",
    "font-src 'self' data: https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net https://cash-f.squarecdn.com",
    "style-src 'self' 'unsafe-inline' https://web.squarecdn.com https://sandbox.web.squarecdn.com",
    "script-src 'self' 'unsafe-inline' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://js.squareup.com https://static.cloudflareinsights.com",
    FRAME_SRC,
    // o160250.ingest.sentry.io is Square's own SDK error reporting — documented
    // by Square and previously blocked, which silently hid SDK failures.
    "connect-src 'self' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://connect.squareup.com https://connect.squareupsandbox.com https://static.cloudflareinsights.com https://cloudflareinsights.com https://o160250.ingest.sentry.io",
    'upgrade-insecure-requests',
    `report-uri ${CSP_REPORT_PATH}`,
    'report-to csp-endpoint',
  ].join('; ');
}

/** Apply hardening headers to every response (redirects included). */
function withSecurityHeaders(response: NextResponse, request: NextRequest): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const { pathname } = request.nextUrl;

  // Preview/sandbox Workers URLs must not compete with the production domain
  // in search results. This never applies to the custom amammajaadi.com host.
  if (isPreviewHost(request.nextUrl.hostname)) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }

  // CSP + HSTS only in production: local `next dev` serves over plain http and
  // uses inline eval for HMR, so enforcing these would only add dev-console noise.
  if (process.env.NODE_ENV === 'production') {
    // `report-to` needs this companion header naming the endpoint group.
    // `report-uri` above is the legacy form — both are sent because browser
    // support is still split between them.
    response.headers.set(
      'Reporting-Endpoints',
      `csp-endpoint="${CSP_REPORT_PATH}"`
    );
    response.headers.set('Content-Security-Policy', buildCsp());
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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
