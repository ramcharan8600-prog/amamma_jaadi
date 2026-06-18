/**
 * Session Management — Production Grade
 *
 * Uses HMAC-SHA256 signed tokens.
 * Session = timestamp:nonce:signature
 * Middleware verifies the signature, not just cookie existence.
 */
import crypto from 'crypto';
import { webcrypto } from 'crypto';

const SESSION_SECRET = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET env var is not set. Admin auth is disabled until this is configured.');
}
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours in ms
export const SESSION_COOKIE = 'admin_session';

/**
 * Generate a cryptographically secure, HMAC-signed session token.
 * Format: timestamp.nonce.signature
 */
export async function createSessionToken(): Promise<string> {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(32).toString('hex');
  const payload = `${timestamp}.${nonce}`;

  const encoder = new TextEncoder();
  const key = await webcrypto.subtle.importKey(
    'raw',
    encoder.encode(SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await webcrypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload)
  );
  const signature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${payload}.${signature}`;
}

/**
 * Verify a session token's signature and expiration.
 * Returns true only if signature is valid AND token is not expired.
 */
export function verifySessionToken(token: string): boolean {
  // Sync check used by API routes (not middleware).
  // Uses Node.js crypto which is available in the Node.js runtime.
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const [timestamp, nonce, providedSignature] = parts;

    const tokenAge = Date.now() - parseInt(timestamp, 10);
    if (isNaN(tokenAge) || tokenAge < 0 || tokenAge > SESSION_MAX_AGE) return false;

    const payload = `${timestamp}.${nonce}`;
    const expectedSignature = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(payload)
      .digest('hex');

    if (providedSignature.length !== expectedSignature.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

/** Cookie options for session cookie */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 8, // 8 hours
};
