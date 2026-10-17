import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { ok, fail } from '@/lib/api';
import { deliveryWeeksStatus, offeredShipWeeks, parseWeeklyLimit, setWeeklyDeliveryLimit } from '@/lib/delivery-limit';

/** The week being shipped now plus the weeks customers can book. */
function adminStatus(db: Parameters<typeof deliveryWeeksStatus>[0]) {
  const current = offeredShipWeeks(new Date(Date.now() - 7 * 86_400_000), 1);
  return deliveryWeeksStatus(db, new Date(), current);
}

async function isAuthenticated(): Promise<boolean> {
  const session = (await cookies()).get(SESSION_COOKIE);
  return Boolean(session?.value && verifySessionToken(session.value));
}

const noStore = { 'Cache-Control': 'private, no-store' };

/** GET /api/admin/delivery-limit — Admin: { limit, weeks: [{ week, days, used, full }], allFull } (this week's shipment + the bookable weeks). */
export async function GET() {
  if (!(await isAuthenticated())) return fail('Unauthorized', 401);
  if (!isDbConfigured()) return fail('Database not configured', 503);
  const status = await adminStatus(getDb());
  return Response.json(status, { headers: noStore });
}

/** PUT /api/admin/delivery-limit — Admin: { limit: 1–1000 } sets the weekly cap; { limit: null } removes it. */
export async function PUT(request: NextRequest) {
  if (!(await isAuthenticated())) return fail('Unauthorized', 401);
  if (!isDbConfigured()) return fail('Database not configured', 503);
  try {
    const body = await request.json().catch(() => null) as { limit?: unknown } | null;
    const limit = parseWeeklyLimit(body?.limit);
    if (!body || !('limit' in body) || limit === undefined) return fail('Enter a whole number from 1 to 1000, or leave it empty for no limit.', 400);
    const db = getDb();
    await setWeeklyDeliveryLimit(db, limit);
    return ok(await adminStatus(db));
  } catch (e) {
    console.error('Delivery limit update error:', e);
    return fail('Failed to save the weekly delivery limit', 500);
  }
}
