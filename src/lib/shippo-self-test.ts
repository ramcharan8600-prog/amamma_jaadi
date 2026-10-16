import type { D1Database, Queue } from '@cloudflare/workers-types';
import type { EmailQueueMessage } from '@/lib/email-outbox';
import { defaultShipDate, loadShippingOrder, purchaseLabel, quoteLabel, voidOrderLabel } from '@/lib/shipping-labels';
import { getTrackingStatus } from '@/lib/shippo';

/**
 * SANDBOX ONLY. Runs the real Shippo test API through the same code the Ship
 * panel uses, for rows queued in shippo_self_tests, and stores what came back
 * (never the key). Lets the integration be verified without an admin login.
 */
export async function runShippoSelfTests(db: D1Database, env: {
  environment: string; apiKey: string; shopEmail: string | null; queue?: Queue<EmailQueueMessage>;
}): Promise<number> {
  if (env.environment === 'production' || !env.apiKey) return 0;
  const rows = await db.prepare(`SELECT id, order_id, mode FROM shippo_self_tests WHERE status = 'requested' ORDER BY requested_at LIMIT 3`)
    .all<{ id: string; order_id: string | null; mode: 'label' | 'void' | 'track' }>();
  for (const row of rows.results ?? []) {
    const result: Record<string, unknown> = { mode: row.mode };
    let ok = true;
    try {
      if (row.mode === 'track') {
        // Shippo's test carrier: SHIPPO_PRE_TRANSIT / SHIPPO_TRANSIT / SHIPPO_DELIVERED.
        result.preTransit = await getTrackingStatus(env.apiKey, 'shippo', 'SHIPPO_PRE_TRANSIT');
        result.transit = await getTrackingStatus(env.apiKey, 'shippo', 'SHIPPO_TRANSIT');
      } else if (row.mode === 'void') {
        await voidOrderLabel(db, env.apiKey, row.order_id ?? '');
        result.labels = (await loadShippingOrder(db, row.order_id ?? ''))?.labels.map((l) => ({ status: l.status, service: l.service_name }));
      } else {
        const shipDate = defaultShipDate();
        const quote = await quoteLabel(db, env.apiKey, { orderId: row.order_id ?? '', box: '9x9x6', weightLb: 2.4, shipDate });
        result.quote = { shipDate, addressCheck: quote.addressCheck, messages: quote.messages, rates: quote.rates };
        const pick = quote.rates.find((r) => r.recommended);
        if (pick) {
          const label = await purchaseLabel(db, env.apiKey, {
            orderId: row.order_id ?? '', rateId: pick.rateId, shipDate, confirmOverLimit: true, shopEmail: env.shopEmail, queue: env.queue,
          });
          result.label = {
            status: label.status, service: label.service_name, amount: label.amount, tracking: label.tracking_number,
            hasLabelPdf: Boolean(label.label_url), labelUrlHost: label.label_url ? new URL(label.label_url).host : null,
          };
        }
      }
    } catch (error) {
      ok = false;
      result.error = error instanceof Error ? error.message : String(error);
    }
    await db.prepare(`UPDATE shippo_self_tests SET status = ?, result_json = ?, ran_at = datetime('now') WHERE id = ?`)
      .bind(ok ? 'done' : 'failed', JSON.stringify(result), row.id).run();
  }
  return rows.results?.length ?? 0;
}
