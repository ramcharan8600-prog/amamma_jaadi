import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestD1 } from '@/lib/test-utils/d1';
import {
  countWeekDeliveryOrders, deliveryWeek, deliveryWeekStatus, getWeeklyDeliveryLimit, isDeliveryWeekFull,
  parseWeeklyLimit, setWeeklyDeliveryLimit,
} from './delivery-limit';

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => {
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('./d1-schema.sql', import.meta.url), 'utf8'));
});
afterEach(() => fixture.sqlite.close());

let n = 0;
function order(createdAtUtc: string, fields: Record<string, unknown> = {}) {
  const id = `o${++n}`;
  const row = { order_number: `AJ-${n}`, customer_name: 'C', phone_number: '1', order_type: 'delivery', total_price: 50,
    payment_status: 'paid', status: 'confirmed', created_at: createdAtUtc, ...fields };
  fixture.sqlite.prepare(`INSERT INTO orders (id, ${Object.keys(row).join(', ')}) VALUES (?, ${Object.keys(row).map(() => '?').join(', ')})`)
    .run(id, ...Object.values(row));
  return id;
}

// Wed 2026-10-21, noon Dallas (CDT = UTC-5).
const now = new Date('2026-10-21T17:00:00Z');

describe('delivery week (Monday–Sunday, Dallas time)', () => {
  it('runs from Monday 12:00 AM to Sunday 11:59 PM Dallas time', () => {
    expect(deliveryWeek(now)).toEqual({
      monday: '2026-10-19', sunday: '2026-10-25', nextMonday: '2026-10-26',
      start: '2026-10-19 05:00:00', end: '2026-10-26 05:00:00',
    });
    // Sunday 11:30 PM Dallas is still the same week; Monday 12:05 AM starts the next one.
    expect(deliveryWeek(new Date('2026-10-26T04:30:00Z')).monday).toBe('2026-10-19');
    expect(deliveryWeek(new Date('2026-10-26T05:05:00Z')).monday).toBe('2026-10-26');
    // After the November clock change (CST = UTC-6).
    expect(deliveryWeek(new Date('2026-11-04T18:00:00Z'))).toMatchObject({ monday: '2026-11-02', start: '2026-11-02 06:00:00' });
  });
});

describe("counting this week's delivery orders", () => {
  it('counts paid and partly refunded delivery orders of this week only', () => {
    order('2026-10-19 05:00:00');                                   // Mon 12:00 AM Dallas: counts
    order('2026-10-21 16:00:00', { payment_status: 'partially_refunded' }); // counts
    order('2026-10-19 04:59:59');                                   // Sun night before: last week
    order('2026-10-26 05:00:00');                                   // next Monday
    order('2026-10-20 12:00:00', { order_type: 'pickup' });         // pickup
    order('2026-10-20 12:00:00', { payment_status: 'refunded' });   // refunded gives the spot back
    order('2026-10-20 12:00:00', { status: 'cancelled' });          // cancelled
    const test = order('2026-10-20 12:00:00');                       // owner test order
    fixture.sqlite.prepare("INSERT INTO order_reporting_exclusions (order_id, reason, recorded_by) VALUES (?, 'test', 'owner')").run(test);
    return expect(countWeekDeliveryOrders(fixture.db, now)).resolves.toBe(2);
  });
});

describe('weekly limit', () => {
  it('is off until set, fills at the limit, and can be raised or removed', async () => {
    expect(await getWeeklyDeliveryLimit(fixture.db)).toBeNull();
    order('2026-10-20 12:00:00');
    order('2026-10-20 13:00:00');
    expect(await isDeliveryWeekFull(fixture.db, now)).toBe(false);

    await setWeeklyDeliveryLimit(fixture.db, 2);
    expect(await deliveryWeekStatus(fixture.db, now)).toEqual({
      limit: 2, used: 2, full: true, monday: '2026-10-19', sunday: '2026-10-25', reopensOn: '2026-10-26',
    });
    await setWeeklyDeliveryLimit(fixture.db, 30);
    expect(await deliveryWeekStatus(fixture.db, now)).toMatchObject({ limit: 30, used: 2, full: false });
    // Next Monday the count starts again.
    await setWeeklyDeliveryLimit(fixture.db, 2);
    expect(await isDeliveryWeekFull(fixture.db, new Date('2026-10-26T15:00:00Z'))).toBe(false);
    await setWeeklyDeliveryLimit(fixture.db, null);
    expect(await getWeeklyDeliveryLimit(fixture.db)).toBeNull();
  });

  it('fails open when the settings table is missing', async () => {
    fixture.sqlite.exec('DROP TABLE shop_settings');
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      expect(await isDeliveryWeekFull(fixture.db, now)).toBe(false);
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
  });

  it('accepts whole numbers from 1 to 1000, or empty for no limit', () => {
    expect(parseWeeklyLimit(30)).toBe(30);
    expect(parseWeeklyLimit('30')).toBe(30);
    expect(parseWeeklyLimit(null)).toBeNull();
    expect(parseWeeklyLimit('')).toBeNull();
    for (const bad of [0, -5, 2.5, 1001, 'abc', undefined, {}]) expect(parseWeeklyLimit(bad)).toBeUndefined();
  });
});
