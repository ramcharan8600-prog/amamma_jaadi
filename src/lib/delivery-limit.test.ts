import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestD1 } from '@/lib/test-utils/d1';
import {
  countShipWeekOrders, deliveryWeeksStatus, firstOpenWeek, getWeeklyDeliveryLimit, isShipWeek, isShipWeekOpen,
  offeredShipWeeks, parseWeeklyLimit, setWeeklyDeliveryLimit, shipWeekDays,
} from './delivery-limit';

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => {
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('./d1-schema.sql', import.meta.url), 'utf8'));
});
afterEach(() => fixture.sqlite.close());

let n = 0;
function order(shipWeek: string | null, fields: Record<string, unknown> = {}) {
  const id = `o${++n}`;
  const row = { order_number: `AJ-${n}`, customer_name: 'C', phone_number: '1', order_type: 'delivery', total_price: 50,
    payment_status: 'paid', status: 'confirmed', ship_week: shipWeek, ...fields };
  fixture.sqlite.prepare(`INSERT INTO orders (id, ${Object.keys(row).join(', ')}) VALUES (?, ${Object.keys(row).map(() => '?').join(', ')})`)
    .run(id, ...Object.values(row));
  return id;
}

// Sat 2026-10-17, noon Dallas (CDT = UTC-5).
const now = new Date('2026-10-17T17:00:00Z');

describe('shipment weeks offered at checkout', () => {
  it('starts with the coming Monday and offers four weeks', () => {
    expect(offeredShipWeeks(now)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
    // Sunday 11:30 PM Dallas still makes the next morning's shipment…
    expect(offeredShipWeeks(new Date('2026-10-19T04:30:00Z'))[0]).toBe('2026-10-19');
    // …from Monday 12:05 AM that week has closed.
    expect(offeredShipWeeks(new Date('2026-10-19T05:05:00Z'))[0]).toBe('2026-10-26');
    // After the November clock change (CST = UTC-6).
    expect(offeredShipWeeks(new Date('2026-11-04T18:00:00Z'))[0]).toBe('2026-11-09');
  });

  it('names a week by its Monday/Tuesday dispatch days', () => {
    expect(shipWeekDays('2026-10-26')).toBe('Mon Oct 26 / Tue Oct 27');
    expect(shipWeekDays('2026-11-30')).toBe('Mon Nov 30 / Tue Dec 1');
    expect(isShipWeek('2026-10-26')).toBe(true);
    expect(isShipWeek('2026-10-27')).toBe(false);
    expect(isShipWeek('26-10-2026')).toBe(false);
  });
});

describe('counting a shipment week', () => {
  it('counts paid and partly refunded delivery orders booked into that week only', async () => {
    order('2026-10-26');
    order('2026-10-26', { payment_status: 'partially_refunded' });
    order('2026-11-02');
    order('2026-10-26', { order_type: 'pickup' });
    order('2026-10-26', { payment_status: 'refunded' });
    order('2026-10-26', { status: 'cancelled' });
    order('2026-10-26', { status: 'on_hold' });
    order(null);
    const test = order('2026-10-26');
    fixture.sqlite.prepare("INSERT INTO order_reporting_exclusions (order_id, reason, recorded_by) VALUES (?, 'test', 'owner')").run(test);
    expect(await countShipWeekOrders(fixture.db, ['2026-10-26', '2026-11-02', '2026-11-09'])).toEqual({
      '2026-10-26': 2, '2026-11-02': 1, '2026-11-09': 0,
    });
  });
});

describe('weekly limit per shipment week', () => {
  it('marks each week full at the limit, offers the earliest open week, and greys out only when all are full', async () => {
    expect(await getWeeklyDeliveryLimit(fixture.db)).toBeNull();
    order('2026-10-19');
    order('2026-10-19');
    order('2026-10-26');
    let status = await deliveryWeeksStatus(fixture.db, now);
    expect(status.allFull).toBe(false);
    expect(firstOpenWeek(status, now)).toBe('2026-10-19');

    await setWeeklyDeliveryLimit(fixture.db, 2);
    status = await deliveryWeeksStatus(fixture.db, now);
    expect(status.weeks.map((w) => [w.week, w.used, w.full])).toEqual([
      ['2026-10-19', 2, true], ['2026-10-26', 1, false], ['2026-11-02', 0, false], ['2026-11-09', 0, false],
    ]);
    expect(status.weeks[1].days).toBe('Mon Oct 26 / Tue Oct 27');
    expect(firstOpenWeek(status, now)).toBe('2026-10-26');
    expect(await isShipWeekOpen(fixture.db, '2026-10-19')).toBe(false);
    expect(await isShipWeekOpen(fixture.db, '2026-10-26')).toBe(true);

    await setWeeklyDeliveryLimit(fixture.db, 1);
    status = await deliveryWeeksStatus(fixture.db, now);
    expect(status.allFull).toBe(false);
    for (const week of ['2026-11-02', '2026-11-09']) order(week);
    status = await deliveryWeeksStatus(fixture.db, now);
    expect(status.allFull).toBe(true);
    expect(firstOpenWeek(status, now)).toBeNull();

    await setWeeklyDeliveryLimit(fixture.db, null);
    expect((await deliveryWeeksStatus(fixture.db, now)).allFull).toBe(false);
  });

  it('can include the week being shipped now for the admin view', async () => {
    order('2026-10-12');
    const status = await deliveryWeeksStatus(fixture.db, now, ['2026-10-12']);
    expect(status.weeks[0]).toMatchObject({ week: '2026-10-12', used: 1 });
    expect(status.weeks).toHaveLength(5);
  });

  it('fails open when the settings table is missing', async () => {
    fixture.sqlite.exec('DROP TABLE shop_settings');
    const original = console.error;
    console.error = () => {};
    try {
      expect((await deliveryWeeksStatus(fixture.db, now)).allFull).toBe(false);
      expect(await isShipWeekOpen(fixture.db, '2026-10-19')).toBe(true);
    } finally {
      console.error = original;
    }
  });

  it('accepts whole numbers from 1 to 1000, or empty for no limit', () => {
    expect(parseWeeklyLimit(30)).toBe(30);
    expect(parseWeeklyLimit('30')).toBe(30);
    expect(parseWeeklyLimit(null)).toBeNull();
    expect(parseWeeklyLimit('')).toBeNull();
    for (const bad of [0, -5, 2.5, 1001, 'abc', undefined, {}]) expect(parseWeeklyLimit(bad)).toBeUndefined();
  });
});
