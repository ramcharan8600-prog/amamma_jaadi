import { cookies } from 'next/headers';
import { PRODUCTS } from '@/data/products';
import { getDb, isDbConfigured } from '@/lib/db';
import { businessDateUtcRange } from '@/lib/date';
import { getPickleSalesByState, type PickleStateProductTotal } from '@/lib/pickle-state-sales';
import { getSalesTimeSeries, REVENUE_YEARS } from '@/lib/sales-analytics';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import type { OrderRecord } from '@/types';

const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });
type RevenueOrder = Pick<OrderRecord, 'created_at' | 'total_price' | 'refunded_amount' | 'payment_status'>;

/** Complete annual sales charts, independent of the order list's row limit. */
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
    const pickleNames = PRODUCTS.filter(({ category }) => category === 'pickles').map(({ name }) => name.trim().toLowerCase());
    // Checkout saves delivery_address as display text. Read the structured paid
    // session first; all joins are one-to-one so historical sessions cannot multiply jars.
    const stateSales = await getDb().prepare(`
      SELECT
        CASE WHEN lower(trim(o.order_type)) = 'pickup' THEN json_array('TX')
          ELSE json_array(
            CASE WHEN json_valid(ps.fulfillment_data) THEN json_extract(ps.fulfillment_data, '$.state') END,
            tax.destination_state,
            CASE WHEN f.order_id IS NULL THEN (
              SELECT CASE WHEN json_valid(legacy.fulfillment_data) THEN json_extract(legacy.fulfillment_data, '$.state') END
              FROM payment_sessions legacy
              WHERE legacy.order_id = o.id AND legacy.payment_status IN ('paid', 'partially_refunded')
              ORDER BY datetime(legacy.created_at) DESC, legacy.id DESC LIMIT 1
            ) END,
            CASE WHEN json_valid(o.delivery_address_normalized) THEN json_extract(o.delivery_address_normalized, '$.state') END,
            CASE WHEN json_valid(o.delivery_address) THEN json_extract(o.delivery_address, '$.state') END
          ) END AS state_candidates,
        lower(trim(i.product_name)) AS product_name,
        SUM(i.quantity) AS jars
      FROM orders o
      JOIN order_items i ON i.order_id = o.id
      LEFT JOIN order_finalizations f ON f.order_id = o.id
      LEFT JOIN payment_sessions ps ON ps.id = f.payment_session_id
      LEFT JOIN order_tax_records tax ON tax.order_id = o.id
      WHERE o.payment_status IN ('paid', 'partially_refunded')
        AND lower(trim(o.status)) NOT IN ('cancelled', 'canceled')
        AND NOT EXISTS (SELECT 1 FROM order_reporting_exclusions x WHERE x.order_id = o.id)
        AND datetime(o.created_at) >= ? AND datetime(o.created_at) < ?
        AND lower(trim(i.product_name)) IN (${pickleNames.map(() => '?').join(', ')})
        AND typeof(i.quantity) = 'integer' AND i.quantity > 0
      GROUP BY state_candidates, lower(trim(i.product_name))
    `).bind(start, end, ...pickleNames).all<PickleStateProductTotal>();
    if (!stateSales.success || !Array.isArray(stateSales.results)) throw new Error('State sales query failed');
    const pickleSalesByState = getPickleSalesByState(stateSales.results);
    return json({ year, weeklyRevenue, monthlyRevenue, pickleSalesByState });
  } catch {
    console.error('Annual revenue could not be loaded');
    return json({ error: 'Could not load revenue. Please try again.' }, 500);
  }
}
