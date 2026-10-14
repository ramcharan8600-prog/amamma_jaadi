import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { businessDateOffset } from '@/lib/date';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { PLAN_DAYS, loadProductionPlan } from '@/lib/production-plan';

const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

/**
 * GET /api/admin/production-plan — Admin only: what to make for the next three
 * days. Pickup orders by pickup date (today, tomorrow, the day after) and
 * delivery orders still waiting to ship, each with their items. Paid and
 * partially refunded orders only; fully refunded, cancelled and owner-confirmed
 * test orders are left out.
 */
export async function GET() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session || !verifySessionToken(session)) return json({ error: 'Unauthorized' }, 401);
  if (!isDbConfigured()) return json({ error: 'Database unavailable' }, 503);

  try {
    const dates = Array.from({ length: PLAN_DAYS }, (_, i) => businessDateOffset(i));
    const plan = await loadProductionPlan(getDb(), dates);
    return json(plan);
  } catch (e) {
    console.error('Production plan error:', e);
    return json({ error: 'Failed to load the production plan' }, 500);
  }
}
