import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken } from '@/lib/session';

describe('session tokens (HMAC)', () => {
  it('creates a token that verifies successfully', async () => {
    const token = await createSessionToken();
    expect(verifySessionToken(token)).toBe(true);
  });

  it('has the timestamp.nonce.signature shape', async () => {
    const token = await createSessionToken();
    expect(token.split('.')).toHaveLength(3);
  });

  it('rejects a tampered signature', async () => {
    const token = await createSessionToken();
    const [ts, nonce] = token.split('.');
    const forged = `${ts}.${nonce}.${'0'.repeat(64)}`;
    expect(verifySessionToken(forged)).toBe(false);
  });

  it('rejects a tampered payload (timestamp changed, signature reused)', async () => {
    const token = await createSessionToken();
    const [ts, nonce, sig] = token.split('.');
    // Use a clearly different timestamp so the signature no longer matches.
    const forged = `${Number(ts) + 1000}.${nonce}.${sig}`;
    expect(verifySessionToken(forged)).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(verifySessionToken('garbage')).toBe(false);
    expect(verifySessionToken('a.b')).toBe(false);
    expect(verifySessionToken('')).toBe(false);
  });

  it('rejects an expired token', async () => {
    // Forge a token dated 9 hours ago (max age is 8h). Sign it with the same
    // secret used in tests so only the age check fails.
    const crypto = await import('node:crypto');
    const secret = process.env.SESSION_SECRET!;
    const ts = (Date.now() - 9 * 60 * 60 * 1000).toString();
    const nonce = 'deadbeef';
    const sig = crypto
      .createHmac('sha256', secret)
      .update(`${ts}.${nonce}`)
      .digest('hex');
    expect(verifySessionToken(`${ts}.${nonce}.${sig}`)).toBe(false);
  });
});
