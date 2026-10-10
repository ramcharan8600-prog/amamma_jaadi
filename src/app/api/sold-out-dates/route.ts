import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { ok, fail } from '@/lib/api';
import { isMarkableSoldOutDate, listSoldOutDates, markSoldOutDate, reopenSoldOutDate } from '@/lib/sold-out-dates';

async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  return Boolean(session?.value && verifySessionToken(session.value));
}

/** GET /api/sold-out-dates — public: pickup dates sold out from today on (the checkout calendar). */
export async function GET() {
  try {
    if (!isDbConfigured()) return ok({ dates: [] });
    return ok({ dates: await listSoldOutDates(getDb()) });
  } catch (e) {
    console.error('Sold-out dates fetch error:', e);
    return fail('Failed to load sold-out dates', 500);
  }
}

/** Admin only: { date } marks (POST) or reopens (DELETE) a pickup date; answers the updated list. */
async function change(request: NextRequest, soldOut: boolean) {
  if (!(await isAuthenticated())) return fail('Unauthorized', 401);
  try {
    const body = await request.json().catch(() => null) as { date?: unknown } | null;
    if (!isMarkableSoldOutDate(body?.date)) {
      return fail('Choose today or a future date (up to 90 days ahead).', 400);
    }
    if (!isDbConfigured()) return fail('Database is not configured', 503);
    const db = getDb();
    if (soldOut) await markSoldOutDate(db, body.date);
    else await reopenSoldOutDate(db, body.date);
    return ok({ dates: await listSoldOutDates(db) });
  } catch (e) {
    console.error('Sold-out dates update error:', e);
    return fail('Failed to update sold-out dates', 500);
  }
}

export async function POST(request: NextRequest) {
  return change(request, true);
}

export async function DELETE(request: NextRequest) {
  return change(request, false);
}
