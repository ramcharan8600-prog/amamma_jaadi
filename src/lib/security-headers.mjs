// Security headers shared by the Worker (src/middleware.ts) and the shop pages
// served as plain static files (scripts/populate-page-cache.mjs writes them into
// the static-assets `_headers` file). Plain JavaScript so the build script can
// import it without a TypeScript step; keep both users on this one copy.

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
export const CSP_REPORT_PATH = '/api/csp-report';

/**
 * Build the policy. Identical on every route — see FRAME_SRC above for why a
 * per-route policy cannot work under client-side navigation.
 */
export function buildCsp() {
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

/**
 * Hardening headers sent with every response, in every environment.
 * @type {Array<[string, string]>}
 */
export const HARDENING_HEADERS = [
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
];

/**
 * CSP + HSTS, sent only by production builds: local `next dev` serves over plain
 * http and uses inline eval for HMR, so enforcing these would only add noise.
 * @returns {Array<[string, string]>}
 */
export function productionSecurityHeaders() {
  return [
    // `report-to` needs this companion header naming the endpoint group.
    // `report-uri` above is the legacy form — both are sent because browser
    // support is still split between them.
    ['Reporting-Endpoints', `csp-endpoint="${CSP_REPORT_PATH}"`],
    ['Content-Security-Policy', buildCsp()],
    ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
  ];
}

/** Sent on preview/sandbox workers.dev hosts so they stay out of search results. */
export const PREVIEW_HOST_ROBOTS = 'noindex, nofollow, noarchive';
