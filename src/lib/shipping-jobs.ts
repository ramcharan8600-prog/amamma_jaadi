import type { D1Database, Queue } from '@cloudflare/workers-types';
import { toBusinessDateString, d1TimestampToBusinessDate } from '@/lib/date';
import { prepareEmailOutboxInsert, publishPersistedEmail, type EmailOutboxPayload, type EmailQueueMessage } from '@/lib/email-outbox';
import { buildShippingWaitingEmail, buildTrackingEmail } from '@/lib/email-service';
import { effectiveShipRoute, stateFromAddress } from '@/lib/ship-routing';
import { getTrackingStatus, voidLabel } from '@/lib/shippo';
import type { LabelRow } from '@/lib/shipping-labels';

export interface ShippingJobEnv {
  apiKey: string;
  shopEmail: string | null;
  trackingEmails: boolean;
  /** Copied on customer tracking emails (the shop inbox in production). */
  trackingCc?: string[];
  queue?: Queue<EmailQueueMessage>;
}

async function queueEmail(db: D1Database, payload: EmailOutboxPayload, queue?: Queue<EmailQueueMessage>) {
  await prepareEmailOutboxInsert(db, payload).statement.run();
  await publishPersistedEmail(db, payload.dedupeKey, queue);
}

/** Dallas wall-clock hour and minute for a moment. */
export function dallasClock(now: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(now);
  return { hour: Number(parts.find((p) => p.type === 'hour')?.value), minute: Number(parts.find((p) => p.type === 'minute')?.value) };
}

/** UPS has the package once tracking moves past PRE_TRANSIT. */
const SCANNED = new Set(['TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE']);

/**
 * 6:30 PM: each paid delivery order with a tracking number gets ONE email.
 * Shippo labels wait until UPS has scanned the box (a voided or unshipped label
 * never emails); hand-shipped (Pirate Ship) orders use the number the owner saved.
 * With emails switched off, orders are only marked done, so nothing old is sent later.
 */
export async function sendTrackingEmails(
  db: D1Database, env: ShippingJobEnv, options: { labelsOnly?: boolean } = {},
): Promise<{ emailed: number; waiting: number }> {
  const orders = await db.prepare(
    `SELECT id, order_number, customer_name, email, tracking_id, shipment_status FROM orders
     WHERE order_type = 'delivery' AND payment_status IN ('paid', 'partially_refunded') AND status != 'cancelled'
       AND tracking_id IS NOT NULL AND TRIM(tracking_id) != '' AND tracking_emailed_at IS NULL
       AND (? = 0 OR EXISTS (SELECT 1 FROM shipping_labels l
         WHERE l.order_id = orders.id AND l.status = 'purchased' AND l.tracking_number = orders.tracking_id))
     ORDER BY created_at LIMIT 100`,
  ).bind(options.labelsOnly ? 1 : 0).all<{ id: string; order_number: string; customer_name: string; email: string | null; tracking_id: string; shipment_status: string }>();
  let emailed = 0;
  let waiting = 0;
  for (const order of orders.results ?? []) {
    const label = await db.prepare(
      `SELECT * FROM shipping_labels WHERE order_id = ? AND status = 'purchased' AND tracking_number = ?`,
    ).bind(order.id, order.tracking_id).first<LabelRow>();
    let delivered = order.shipment_status === 'delivered';
    if (label && !label.scanned_at) {
      // Without the Shippo key the scan can't be checked: leave Shippo-label orders for later.
      if (!env.apiKey) { waiting++; continue; }
      let status = 'UNKNOWN';
      try {
        status = await getTrackingStatus(env.apiKey, 'ups', order.tracking_id);
      } catch (error) {
        console.error(JSON.stringify({ event: 'tracking_lookup_failed', orderId: order.id, error: String(error) }));
      }
      if (!SCANNED.has(status)) { waiting++; continue; }
      delivered = status === 'DELIVERED';
      await db.batch([
        db.prepare(`UPDATE shipping_labels SET scanned_at = datetime('now') WHERE id = ?`).bind(label.id),
        db.prepare(`UPDATE orders SET shipment_status = ? WHERE id = ? AND shipment_status = 'yet_to_ship'`)
          .bind(status === 'DELIVERED' ? 'delivered' : 'shipped', order.id),
      ]);
    }
    if (env.trackingEmails && order.email) {
      await queueEmail(db, buildTrackingEmail({
        to: order.email, cc: env.trackingCc, orderId: order.id, orderNumber: order.order_number,
        customerName: order.customer_name, trackingNumber: order.tracking_id.trim(), delivered,
      }), env.queue);
      emailed++;
    }
    await db.prepare(`UPDATE orders SET tracking_emailed_at = ? WHERE id = ?`)
      .bind(env.trackingEmails && order.email ? new Date().toISOString() : 'emails-off', order.id).run();
  }
  return { emailed, waiting };
}

/** About 10 PM: the shop's list of paid delivery orders with no label or tracking number yet (sent even when empty). */
export async function sendWaitingList(db: D1Database, env: ShippingJobEnv, now = new Date()): Promise<number> {
  if (!env.shopEmail) return 0;
  const rows = await db.prepare(
    `SELECT o.id, o.order_number, o.customer_name, o.delivery_address, o.ship_route, o.created_at
     FROM orders o
     WHERE o.order_type = 'delivery' AND o.payment_status IN ('paid', 'partially_refunded') AND o.status != 'cancelled'
       AND o.shipment_status = 'yet_to_ship' AND (o.tracking_id IS NULL OR TRIM(o.tracking_id) = '')
       AND NOT EXISTS (SELECT 1 FROM shipping_labels l WHERE l.order_id = o.id AND l.status IN ('buying', 'purchased'))
       AND NOT EXISTS (SELECT 1 FROM order_reporting_exclusions x WHERE x.order_id = o.id)
     ORDER BY o.created_at`,
  ).all<{ id: string; order_number: string; customer_name: string; delivery_address: string | null; ship_route: string | null; created_at: string }>();
  const waiting = [];
  for (const row of rows.results ?? []) {
    const items = await db.prepare('SELECT product_name, quantity, selected_tier FROM order_items WHERE order_id = ?')
      .bind(row.id).all<{ product_name: string; quantity: number; selected_tier: number | null }>();
    const state = stateFromAddress(row.delivery_address);
    const route = effectiveShipRoute(row.ship_route, state, items.results ?? []).route;
    const cityLine = (row.delivery_address ?? '').split('\n').find((l) => /,\s*[A-Za-z]{2}\s+\d{5}/.test(l)) ?? '';
    waiting.push({
      orderNumber: row.order_number, customerName: row.customer_name, cityState: cityLine.replace(/\s+\d{5}(-\d{4})?$/, ''),
      route: route === 'shippo' ? 'Shippo' : 'Pirate Ship', orderedOn: d1TimestampToBusinessDate(row.created_at),
    });
  }
  await queueEmail(db, buildShippingWaitingEmail({ to: env.shopEmail, date: toBusinessDateString(now), waiting }), env.queue);
  return waiting.length;
}

/** Every run: void unused labels on orders that were fully refunded or cancelled (Shippo refunds the cost). */
export async function voidLabelsOfRefundedOrders(db: D1Database, env: ShippingJobEnv): Promise<number> {
  const labels = await db.prepare(
    `SELECT l.* FROM shipping_labels l JOIN orders o ON o.id = l.order_id
     WHERE l.status = 'purchased' AND l.scanned_at IS NULL AND l.shippo_transaction_id IS NOT NULL
       AND (o.payment_status = 'refunded' OR o.status = 'cancelled')`,
  ).all<LabelRow>();
  let voided = 0;
  for (const label of labels.results ?? []) {
    try {
      const result = await voidLabel(env.apiKey, label.shippo_transaction_id!);
      if (!['QUEUED', 'PENDING', 'SUCCESS'].includes(result.status)) throw new Error(`void status ${result.status}`);
      await db.batch([
        db.prepare(`UPDATE shipping_labels SET status = 'voided', voided_at = datetime('now'), error = 'Voided: order refunded' WHERE id = ?`).bind(label.id),
        db.prepare('UPDATE orders SET tracking_id = NULL WHERE id = ? AND tracking_id = ?').bind(label.order_id, label.tracking_number),
      ]);
      voided++;
    } catch (error) {
      await db.prepare('UPDATE shipping_labels SET error = ? WHERE id = ?').bind(`Auto-void failed: ${String(error)}`.slice(0, 300), label.id).run();
    }
  }
  return voided;
}

/**
 * Called by the 15-minute cron: refund voids every run (needs the Shippo key)
 * and the waiting list at 10 PM Dallas time. Tracking emails start at 6:30 PM
 * and keep checking every run until midnight, so a box UPS scans at 8 PM is
 * emailed that evening, not a day later; from 7 AM to noon only scan-checked
 * Shippo labels are looked at (a number typed in by hand in the morning waits
 * for the evening, after the drop-off). Hand-shipped orders and the waiting
 * list also run without a key.
 */
export async function runShippingJobs(db: D1Database, env: ShippingJobEnv, now = new Date()) {
  const { hour, minute } = dallasClock(now);
  const result: Record<string, unknown> = { voided: env.apiKey ? await voidLabelsOfRefundedOrders(db, env) : 0 };
  const evening = (hour === 18 && minute >= 30) || hour >= 19;
  const morning = hour >= 7 && hour < 12;
  if (evening || morning) result.tracking = await sendTrackingEmails(db, env, { labelsOnly: !evening });
  if (hour === 22 && minute < 15) result.waiting = await sendWaitingList(db, env, now);
  return result;
}
