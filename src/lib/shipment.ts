import type { D1Database } from '@cloudflare/workers-types';

export const SHIPMENT_STATUSES = ['yet_to_ship', 'shipped', 'delivered'] as const;
export type ShipmentStatusValue = typeof SHIPMENT_STATUSES[number];

export function isShipmentStatus(value: string): value is ShipmentStatusValue {
  return SHIPMENT_STATUSES.includes(value as ShipmentStatusValue);
}

export async function updateShipmentDetails(
  db: D1Database,
  input: { orderId: string; shipmentStatus: ShipmentStatusValue; trackingId: string | null }
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
