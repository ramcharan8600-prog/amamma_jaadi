import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { isShipmentStatus, updateShipmentDetails } from '@/lib/shipment';

describe('shipment tracking', () => {
  it('accepts only the supported statuses', () => {
    expect(isShipmentStatus('yet_to_ship')).toBe(true);
    expect(isShipmentStatus('shipped')).toBe(true);
    expect(isShipmentStatus('delivered')).toBe(true);
    expect(isShipmentStatus('lost')).toBe(false);
  });

  it('updates only a delivery order', async () => {
    let sql = '';
    let binds: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) {
        binds = values;
        return statement;
      },
      async run() {
        return { meta: { changes: 1 } };
      },
    };
    const db = {
      prepare(value: string) {
        sql = value;
        return statement;
      },
    } as unknown as D1Database;

    const updated = await updateShipmentDetails(db, {
      orderId: 'ORDER_1',
      shipmentStatus: 'shipped',
      trackingId: 'TRACK123',
    });

    expect(updated).toBe(true);
    expect(sql).toContain("order_type = 'delivery'");
    expect(binds).toEqual(['shipped', 'TRACK123', 'ORDER_1']);
  });
});
