import { NextRequest } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { sanitize } from '@/lib/sanitize';
import { ok, fail } from '@/lib/api';
import { validateUsAddress } from '@/lib/address-validation';

/**
 * POST /api/address/validate
 *
 * Frontend UX pre-check for delivery addresses. Returns a typed
 * AddressValidationResult (200) describing whether the address is valid,
 * corrected (with a suggestion), or rejected. The authoritative check still
 * runs again server-side in /api/payments/create-session.
 */
export async function POST(request: NextRequest) {
  // Throttle abuse: 20 lookups per minute per IP.
  if (!rateLimit(`address:${getClientIp(request)}`, 20, 60_000)) {
    return fail('Too many requests. Please slow down.', 429);
  }

  try {
    const body = await request.json();
    const result = await validateUsAddress({
      addressLine1: sanitize(body.addressLine1, 200),
      addressLine2: sanitize(body.addressLine2, 200),
      city: sanitize(body.city, 100),
      state: sanitize(body.state, 50),
      zip: sanitize(body.zip, 20),
    });
    // Always 200 — the discriminated `status` carries the outcome.
    return ok(result);
  } catch (e) {
    console.error('[api address/validate] error:', e);
    return fail('Address validation failed', 500);
  }
}
