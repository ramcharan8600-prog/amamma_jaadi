/**
 * The site's one public address. Carts, saved payment references and admin
 * sign-ins live in browser storage per origin, so a shopper who switches
 * between www and the bare domain would see an empty cart. Every page view on
 * www is therefore sent permanently to the same path on the bare domain.
 */
export const CANONICAL_HOST = 'amammajaadi.com';

const REDIRECTED_HOSTS: ReadonlySet<string> = new Set(['www.amammajaadi.com']);

/**
 * Paths www keeps serving itself:
 * - /api/: a checkout tab already open on www must still be able to pay and
 *   confirm (a 301 would turn its POST into a GET).
 * - /.well-known/: Apple Pay checks its domain file on every verified domain,
 *   and www is still verified in Square.
 */
const PASS_THROUGH_PREFIXES = ['/api/', '/.well-known/'];

/** A 301 to the canonical host for www page views, or null to serve normally. */
export function canonicalHostRedirect(request: { url: string; method: string }): Response | null {
  const url = new URL(request.url);
  if (!REDIRECTED_HOSTS.has(url.hostname)) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (PASS_THROUGH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;

  url.protocol = 'https:';
  url.hostname = CANONICAL_HOST;
  url.port = '';
  return new Response(null, {
    status: 301,
    headers: {
      Location: url.toString(),
      // Browsers would otherwise keep a 301 forever; a day keeps it undoable.
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
