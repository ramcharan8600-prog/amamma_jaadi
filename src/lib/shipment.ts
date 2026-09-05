import type { D1Database } from '@cloudflare/workers-types';

export const SHIPMENT_STATUSES = ['yet_to_ship', 'shipped', 'delivered'] as const;
export type ShipmentStatusValue = typeof SHIPMENT_STATUSES[number];

export interface ShipmentUpdate {
  orderId: string;
  shipmentStatus: ShipmentStatusValue;
  trackingId: string | null;
}

export interface ShipmentBatchResult {
  updatedOrderIds: string[];
  notUpdatedOrderIds: string[];
}

export function isShipmentStatus(value: string): value is ShipmentStatusValue {
  return SHIPMENT_STATUSES.includes(value as ShipmentStatusValue);
}

export async function updateShipmentDetails(
  db: D1Database,
  input: ShipmentUpdate
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE orders
       SET shipment_status = ?, tracking_id = ?
       WHERE id = ? AND order_type = 'delivery'`
    )
    .bind(input.shipmentStatus, input.trackingId, input.orderId)
    .run();

  return Boolean(result.meta.changes);
}

/** Save multiple delivery rows in one transactional D1 batch. */
export async function updateShipmentDetailsBatch(
  db: D1Database,
  updates: ShipmentUpdate[]
): Promise<ShipmentBatchResult> {
  if (updates.length === 0) {
    return { updatedOrderIds: [], notUpdatedOrderIds: [] };
  }

  const statements = updates.map((input) => db
    .prepare(
      `UPDATE orders
       SET shipment_status = ?, tracking_id = ?
       WHERE id = ? AND order_type = 'delivery'`
    )
    .bind(input.shipmentStatus, input.trackingId, input.orderId));

  const results = await db.batch(statements);
  const updatedOrderIds: string[] = [];
  const notUpdatedOrderIds: string[] = [];

  results.forEach((result, index) => {
    const destination = Number(result.meta.changes) > 0
      ? updatedOrderIds
      : notUpdatedOrderIds;
    destination.push(updates[index].orderId);
  });

  return { updatedOrderIds, notUpdatedOrderIds };
}
