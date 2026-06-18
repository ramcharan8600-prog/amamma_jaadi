import crypto from 'crypto';

/**
 * Constant-time string comparison — avoids leaking length/content via timing.
 * For comparing secrets (passwords, PINs) in Node runtime route handlers.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Run a fixed comparison anyway to keep timing uniform across length mismatches.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
