import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import {
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from '@/lib/session';
import { safeEqual } from '@/lib/crypto';
import { ok, fail } from '@/lib/api';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

/** POST /api/auth — Login */
export async function POST(request: NextRequest) {
  try {
    if (!ADMIN_PASSWORD) {
      return fail('Admin login is not configured.', 503);
    }

    const body = await request.json();
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!userId || !password) {
      return fail('Missing credentials', 400);
    }

    if (safeEqual(userId, ADMIN_USERNAME) && safeEqual(password, ADMIN_PASSWORD)) {
      const token = await createSessionToken();
      const cookieStore = await cookies();
      cookieStore.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
      return ok({ success: true });
    }

    // Constant-time delay to prevent timing-based user enumeration
    await new Promise((r) => setTimeout(r, 200 + Math.floor(Math.random() * 100)));
    return fail('Invalid credentials', 401);
  } catch {
    return fail('Invalid request', 400);
  }
}

/** DELETE /api/auth — Logout */
export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  return ok({ success: true });
}

/** GET /api/auth — Verify session */
export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);

  if (session?.value && verifySessionToken(session.value)) {
    return ok({ authenticated: true });
  }

  // Clear invalid/expired cookie
  const cookieWriter = await cookies();
  cookieWriter.delete(SESSION_COOKIE);
  return ok({ authenticated: false }, 401);
}
