/**
 * Stock tracking for countable products (currently the pickles).
 *
 * Design rules:
 *  1. A product with NO `inventory` row is UNTRACKED and always purchasable.
 *     Sweets/gift boxes are made fresh to order, so they simply have no row —
 *     and adding this feature can never hide an existing product by accident.
 *  2. Availability is enforced SERVER-SIDE in create-session (before payment).
 *  3. Stock is decremented only when a paid order is created, and a failed
 *     decrement NEVER fails the order — the customer has already been charged.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { PRODUCTS, TRACKED_CATEGORY } from '@/data/products';

export interface StockRow {
  product_id: string;
  stock_count: number;
}

/**
 * Product ids that participate in stock tracking — derived from the catalog,
 * so adding a new pickle makes it tracked automatically with no code change.
 */
export const TRACKED_PRODUCT_IDS = PRODUCTS.filter(
  (p) => p.category === TRACKED_CATEGORY
).map((p) => p.id);

/**
 * Current stock for every tracked product, as `{ productId: count }`.
 * Returns an empty map (= nothing tracked) if the table is missing, so a
 * storefront read can never break the page.
 */
export async function getStockMap(db: D1Database): Promise<Record<string, number>> {
  try {
    const res = await db
      .prepare('SELECT product_id, stock_count FROM inventory')
      .all<StockRow>();
    const map: Record<string, number> = {};
    for (const row of res.results ?? []) {
      map[String(row.product_id)] = Math.max(0, Number(row.stock_count) || 0);
    }
    return map;
  } catch (e) {
    console.error('[inventory] stock read failed:', e);
    return {};
  }
}

/**
 * Set an absolute stock count (admin action). Creates the row if absent.
 * Negative input is clamped to 0.
 */
export async function setStock(
  db: D1Database,
  productId: string,
  count: number
): Promise<void> {
  const safe = Math.max(0, Math.floor(Number(count) || 0));
  await db
    .prepare(
      `INSERT INTO inventory (product_id, stock_count, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(product_id) DO UPDATE
         SET stock_count = excluded.stock_count, updated_at = datetime('now')`
    )
    .bind(productId, safe)
    .run();
}

/**
 * Decrement stock for the items in a paid order — best effort, never throws.
 *
 * The guarded `WHERE stock_count >= ?` makes each decrement atomic: D1
 * serializes writes, so two concurrent orders can't both pass the check and
 * drive the count negative. If the guard fails (a genuine oversell — two
 * customers paid for the last jar at the same moment) the count is floored at 0
 * and a LOUD warning is logged for the owner. The order still stands, because
 * refusing an already-paid order would be far worse than an inventory fix-up.
 */
export async function decrementStockForOrder(
  db: D1Database,
  items: Array<{ productId?: string; quantity?: number }>,
  orderNumber: string
): Promise<void> {
  for (const item of items) {
    const productId = item?.productId;
    if (!productId || !TRACKED_PRODUCT_IDS.includes(productId)) continue;

    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
    try {
      const res = await db
        .prepare(
          `UPDATE inventory
             SET stock_count = stock_count - ?, updated_at = datetime('now')
           WHERE product_id = ? AND stock_count >= ?`
        )
        .bind(qty, productId, qty)
        .run();

      if (!res.meta?.changes) {
        // Either untracked, or not enough stock to satisfy this line.
        await db
          .prepare(
            `UPDATE inventory SET stock_count = 0, updated_at = datetime('now')
             WHERE product_id = ? AND stock_count > 0`
          )
          .bind(productId)
          .run();
        console.warn(
          `[inventory] OVERSOLD: order ${orderNumber} took ${qty} x ${productId} but stock was insufficient — count floored at 0. Restock/verify manually.`
        );
      }
    } catch (e) {
      // Never let an inventory problem break a paid order.
      console.error(`[inventory] decrement failed for ${productId} (order ${orderNumber}):`, e);
    }
  }
}
