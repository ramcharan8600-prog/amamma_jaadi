import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { ok, fail } from '@/lib/api';
import { DELIVERY_ZONES, isDeliveryZone, listPausedZones, setPausedZones } from '@/lib/delivery-pauses';
import { currentShipWeek, deliveryWeeksStatus, offeredShipWeeks } from '@/lib/delivery-limit';

async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  return Boolean(session?.value && verifySessionToken(session.value));
}

/**
 * GET /api/delivery-pauses — public: delivery areas paused right now, this
 * week's shipment (shown as SOLD OUT) and the future shipment weeks checkout
 * offers, each open or full (no counts are shown to shoppers). weekFull =
 * every offered week is full. Fails open.
 */
export async function GET() {
  const currentWeek = currentShipWeek();
  const open = () => offeredShipWeeks().map((week) => ({ week, full: false }));
  try {
    if (!isDbConfigured()) return ok({ paused: [], weekFull: false, currentWeek, weeks: open() });
    const db = getDb();
    const [paused, status] = await Promise.all([listPausedZones(db), deliveryWeeksStatus(db)]);
    return ok({ paused, weekFull: status.allFull, currentWeek, weeks: status.weeks.map(({ week, full }) => ({ week, full })) });
  } catch (e) {
    console.error('Delivery pauses fetch error:', e);
    return ok({ paused: [], weekFull: false, currentWeek, weeks: open() });
  }
}

/** Admin only: { paused: ['texas' | 'nearby' | 'far', ...] } replaces the paused areas. */
export async function PUT(request: NextRequest) {
  if (!(await isAuthenticated())) return fail('Unauthorized', 401);
  try {
    const body = await request.json().catch(() => null) as { paused?: unknown } | null;
    if (!Array.isArray(body?.paused) || !body.paused.every(isDeliveryZone)) {
      return fail(`Choose delivery areas from: ${DELIVERY_ZONES.join(', ')}.`, 400);
    }
    if (!isDbConfigured()) return fail('Database is not configured', 503);
    const db = getDb();
    await setPausedZones(db, [...new Set(body.paused)]);
    return ok({ paused: await listPausedZones(db) });
  } catch (e) {
    console.error('Delivery pauses update error:', e);
    return fail('Failed to update delivery areas', 500);
  }
}
