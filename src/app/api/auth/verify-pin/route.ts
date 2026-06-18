import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { safeEqual } from '@/lib/crypto';
import { ok, fail } from '@/lib/api';

const ANALYTICS_PIN = process.env.ANALYTICS_PIN || '';
if (!ANALYTICS_PIN) {
  throw new Error('ANALYTICS_PIN env var is not set. Analytics access is disabled until this is configured.');
}

export async function POST(request: NextRequest) {
  // Verify admin session first
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  if (!session?.value || !verifySessionToken(session.value)) {
    return fail('Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const pin = typeof body.pin === 'string' ? body.pin.trim() : '';

    if (safeEqual(pin, ANALYTICS_PIN)) {
      return ok({ verified: true });
    }

    await new Promise((r) => setTimeout(r, 300));
    return fail('Incorrect PIN', 403);
  } catch {
    return fail('Invalid request', 400);
  }
}
