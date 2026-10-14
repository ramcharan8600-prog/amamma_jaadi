import type { D1Database, Queue } from '@cloudflare/workers-types';
import { getPickupLocationById } from '@/data/products';
import { BUSINESS_TZ } from '@/lib/constants';
import { d1TimestampToBusinessDate, toBusinessDateString } from '@/lib/date';
import { baseTemplate, escapeHtml } from '@/lib/email-service';
import { prepareEmailOutboxInsert, publishPersistedEmail, type EmailOutboxPayload, type EmailQueueMessage } from '@/lib/email-outbox';
import { isPickupClosedDate } from '@/lib/pickup-date';
import { productionSheet } from '@/lib/production';
import { loadProductionPlan, type PlanOrder, type ProductionPlan } from '@/lib/production-plan';

/**
 * The kitchen's 9 AM email: what to make today (pickups due today plus every
 * delivery order waiting to ship), today's pickup orders by location, and the
 * delivery orders still to ship. No prices. Same data as Admin → Production.
 */

/** "Thu, Oct 15" for a YYYY-MM-DD business date. */
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Round Rock, TX" from a stored multi-line delivery address. */
export function shipToCity(address: string | null | undefined): string {
  const lines = (address ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const cityLine = lines.find((l) => /,\s*[A-Z]{2}\s+\d{5}/.test(l));
  const match = cityLine?.match(/^(.*?),\s*([A-Z]{2})\b/);
  return match ? `${match[1]}, ${match[2]}` : lines.at(-1) ?? '—';
}

/** One line per item, already HTML-escaped. */
function itemsHtml(order: PlanOrder): string {
  return order.items
    .map((i) => escapeHtml(`${i.product_name}${i.selected_tier ? ` (${i.selected_tier} pcs)` : ''} × ${i.quantity}`))
    .join('<br>');
}

const th = 'text-align:left; padding:6px 8px; font-size:12px; color:#666; border-bottom:2px solid #eee;';
const td = 'padding:6px 8px; font-size:14px; border-bottom:1px solid #f0ece6; vertical-align:top;';
const num = `${td} text-align:right; white-space:nowrap;`;
const h3 = 'color:#7B1F1F; margin:24px 0 8px; font-size:17px;';

export function buildDailyPrepEmail(params: { to: string; date: string; plan: ProductionPlan }): EmailOutboxPayload {
  const pickups = params.plan.days.find((d) => d.date === params.date)?.orders ?? [];
  const delivery = params.plan.delivery;
  const pickupSheet = productionSheet(pickups.flatMap((o) => o.items));
  const deliverySheet = productionSheet(delivery.flatMap((o) => o.items));
  const totalSheet = productionSheet([...pickups, ...delivery].flatMap((o) => o.items));
  const piecesOf = (sheet: typeof totalSheet, sweet: string) => sheet.sweets.find((s) => s.sweet === sweet)?.pieces ?? 0;
  const countOf = (sheet: typeof totalSheet, label: string) => sheet.items.find((i) => i.label === label)?.count ?? 0;
  const day = dayLabel(params.date);

  const sweetsTable = totalSheet.sweets.length === 0 ? '<p style="color:#666;">No sweets to make.</p>' : `
<table style="width:100%; border-collapse:collapse;">
<tr><th style="${th}">Sweet</th><th style="${th} text-align:right;">Pickups today</th><th style="${th} text-align:right;">Delivery orders</th><th style="${th} text-align:right;">Total pcs</th></tr>
${totalSheet.sweets.map(({ sweet, pieces }) => `<tr><td style="${td}">${sweet}</td><td style="${num}">${piecesOf(pickupSheet, sweet)}</td><td style="${num}">${piecesOf(deliverySheet, sweet)}</td><td style="${num} font-weight:bold; color:#7B1F1F;">${pieces}</td></tr>`).join('')}
</table>`;

  const packTable = totalSheet.items.length === 0 ? '' : `
<h3 style="${h3}">To pack</h3>
<table style="width:100%; border-collapse:collapse;">
<tr><th style="${th}">Item</th><th style="${th} text-align:right;">Pickups today</th><th style="${th} text-align:right;">Delivery orders</th><th style="${th} text-align:right;">Total</th></tr>
${totalSheet.items.map(({ label, count, unit }) => `<tr><td style="${td}">${escapeHtml(label)}</td><td style="${num}">${countOf(pickupSheet, label)}</td><td style="${num}">${countOf(deliverySheet, label)}</td><td style="${num} font-weight:bold;">${count} ${unit}</td></tr>`).join('')}
</table>`;

  const byLocation = new Map<string, PlanOrder[]>();
  for (const order of pickups) {
    const key = order.pickup_location ?? '';
    byLocation.set(key, [...(byLocation.get(key) ?? []), order]);
  }
  const pickupSection = pickups.length === 0
    ? `<p style="color:#666;">${isPickupClosedDate(params.date) ? 'Pickup is closed today (Tuesday).' : 'No pickup orders today.'}</p>`
    : [...byLocation].map(([id, orders]) => {
        const loc = getPickupLocationById(id);
        const where = loc ? `${loc.name} · ${loc.address}, ${loc.city}` : id || 'Pickup';
        return `
<p style="margin:12px 0 4px; font-weight:bold;">📍 ${escapeHtml(where)} — ${orders.length} ${orders.length === 1 ? 'order' : 'orders'}</p>
<table style="width:100%; border-collapse:collapse;">
${orders.map((o) => `<tr><td style="${td} white-space:nowrap; font-weight:bold;">${escapeHtml(o.order_number)}</td><td style="${td}">${escapeHtml(o.customer_name)}</td><td style="${td}">${itemsHtml(o)}</td></tr>`).join('')}
</table>`;
      }).join('');

  const deliverySection = delivery.length === 0 ? '<p style="color:#666;">No delivery orders waiting. ✅</p>' : `
<table style="width:100%; border-collapse:collapse;">
<tr><th style="${th}">Order</th><th style="${th}">Customer</th><th style="${th}">Ship to</th><th style="${th}">Ordered</th><th style="${th}">Items</th></tr>
${delivery.map((o) => `<tr><td style="${td} white-space:nowrap; font-weight:bold;">${escapeHtml(o.order_number)}</td><td style="${td}">${escapeHtml(o.customer_name)}</td><td style="${td}">${escapeHtml(shipToCity(o.delivery_address))}</td><td style="${td} white-space:nowrap;">${escapeHtml(dayLabel(d1TimestampToBusinessDate(o.created_at)))}</td><td style="${td}">${itemsHtml(o)}</td></tr>`).join('')}
</table>`;

  const html = baseTemplate(`
<h2 style="color:#1B4332; margin:0 0 4px;">Today&apos;s prep — ${day}</h2>
<p style="margin:0 0 8px; color:#666;">${pickups.length} pickup ${pickups.length === 1 ? 'order' : 'orders'} today · ${delivery.length} delivery ${delivery.length === 1 ? 'order' : 'orders'} waiting to ship</p>
<h3 style="${h3}">Sweets to make</h3>
${sweetsTable}
${packTable}
<h3 style="${h3}">Pickup orders today (${pickups.length})</h3>
${pickupSection}
<h3 style="${h3}">Delivery orders waiting to ship (${delivery.length})</h3>
${deliverySection}
<p style="margin:24px 0 0; font-size:12px; color:#999;">Paid orders only (refunded and cancelled orders are left out). Live view: amammajaadi.com/admin/production</p>
`);
  return {
    to: params.to,
    subject: `Today's prep · ${day} · ${pickups.length} pickup${pickups.length === 1 ? '' : 's'} · ${delivery.length} to ship`,
    html,
    dedupeKey: `daily-prep:${params.date}`,
  };
}

/** Hour of day (0–23) in Dallas. */
function businessHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: BUSINESS_TZ }).format(now));
}

/**
 * Called by the cron at 14:00 and 15:00 UTC; only the run that is 9 AM in
 * Dallas sends (CDT in summer, CST in winter). One email per day.
 */
export async function sendDailyPrepEmail(
  db: D1Database,
  options: { to: string; emailQueue?: Queue<EmailQueueMessage>; now?: Date }
): Promise<'sent' | 'skipped'> {
  const now = options.now ?? new Date();
  if (businessHour(now) !== 9) return 'skipped';
  const date = toBusinessDateString(now);
  const plan = await loadProductionPlan(db, [date]);
  const email = buildDailyPrepEmail({ to: options.to, date, plan });
  await prepareEmailOutboxInsert(db, email).statement.run();
  await publishPersistedEmail(db, email.dedupeKey, options.emailQueue);
  return 'sent';
}
