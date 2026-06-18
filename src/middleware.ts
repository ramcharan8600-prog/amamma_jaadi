import { NextRequest, NextResponse } from 'next/server';

const SESSION_SECRET = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;
const SESSION_COOKIE = 'admin_session';

/** Verify HMAC-signed session token using Web Crypto API (Edge-compatible) */
async function verifyToken(token: string): Promise<boolean> {
  try {
    // Fail closed: never verify against an empty/unknown key. An empty HMAC
    // key is publicly known and would let an attacker forge session tokens.
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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login')) {
    const session = request.cookies.get(SESSION_COOKIE);

    if (!session?.value || !(await verifyToken(session.value))) {
      const response = NextResponse.redirect(new URL('/admin/login', request.url));
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }
  }

  // Security headers for all routes
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/((?!_next/static|_next/image|favicon.ico|images/).*)'],
};
