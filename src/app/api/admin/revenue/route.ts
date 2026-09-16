import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { businessDateUtcRange } from '@/lib/date';
import { getSalesTimeSeries, REVENUE_YEARS } from '@/lib/sales-analytics';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import type { OrderRecord } from '@/types';

const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });
type RevenueOrder = Pick<OrderRecord, 'created_at' | 'total_price' | 'refunded_amount' | 'payment_status'>;

/** Complete calendar-year revenue, independent of the order list's row limit. */
export async function GET(request: Request) {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session || !verifySessionToken(session)) return json({ error: 'Unauthorized' }, 401);

  const rawYear = new URL(request.url).searchParams.get('year') ?? '';
  const year = Number(rawYear);
  if (!/^\d{4}$/.test(rawYear) || !REVENUE_YEARS.some((option) => option === year)) {
    return json({ error: 'Choose a year from 2026 to 2031.' }, 400);
  }
  if (!isDbConfigured()) return json({ error: 'Database unavailable' }, 503);

  try {
    const start = businessDateUtcRange(`${year}-${year === 2026 ? '07' : '01'}-01`)!.start;
    const end = businessDateUtcRange(`${year + 1}-01-01`)!.start;
    const result = await getDb().prepare(`
      SELECT o.created_at, o.total_price, o.refunded_amount, o.payment_status
      FROM orders o
      WHERE o.payment_status IN ('paid', 'partially_refunded')
        AND NOT EXISTS (SELECT 1 FROM order_reporting_exclusions x WHERE x.order_id = o.id)
        AND datetime(o.created_at) >= ? AND datetime(o.created_at) < ?
    `).bind(start, end).all<RevenueOrder>();
    if (!result.success || !Array.isArray(result.results)) throw new Error('Revenue query failed');
    const { weeklyRevenue, monthlyRevenue } = getSalesTimeSeries(result.results, year);
    return json({ year, weeklyRevenue, monthlyRevenue });
  } catch {
    console.error('Annual revenue could not be loaded');
    return json({ error: 'Could not load revenue. Please try again.' }, 500);
  }
}
