import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  isShipmentStatus,
  updateShipmentDetails,
  updateShipmentDetailsBatch,
} from '@/lib/shipment';

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

  it('saves a sheet of delivery changes in one D1 batch and reports missing rows', async () => {
    const binds: unknown[][] = [];
    const db = {
      prepare() {
        const statement = {
          bind(...values: unknown[]) {
            binds.push(values);
            return statement;
          },
        };
        return statement;
      },
      async batch() {
        return [
          { meta: { changes: 1 } },
          { meta: { changes: 0 } },
        ];
      },
    } as unknown as D1Database;

    const result = await updateShipmentDetailsBatch(db, [
      { orderId: 'ORDER_1', shipmentStatus: 'shipped', trackingId: 'TRACK123' },
      { orderId: 'ORDER_2', shipmentStatus: 'delivered', trackingId: null },
    ]);

    expect(binds).toEqual([
      ['shipped', 'TRACK123', 'ORDER_1'],
      ['delivered', null, 'ORDER_2'],
    ]);
    expect(result).toEqual({
      updatedOrderIds: ['ORDER_1'],
      notUpdatedOrderIds: ['ORDER_2'],
    });
  });
});
