import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { buildDailyPrepEmail, sendDailyPrepEmail, shipToCity } from '@/lib/daily-prep-email';
import type { PlanOrder, ProductionPlan } from '@/lib/production-plan';

vi.mock('@/lib/email-outbox', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/email-outbox')>(),
  publishPersistedEmail: vi.fn(async () => true),
}));

const order = (over: Partial<PlanOrder>): PlanOrder => ({
  id: 'o', order_number: 'AJ-1', customer_name: 'Test', order_type: 'pickup', pickup_date: '2026-10-15',
  pickup_location: 'plano-biryanify', created_at: '2026-10-13 15:00:00', items: [], ...over,
});

const plan: ProductionPlan = {
  days: [{ date: '2026-10-15', orders: [
    order({ id: 'p1', order_number: 'AJ-1301', customer_name: 'Asha <b>', items: [{ product_name: 'Kova Bobbatlu', quantity: 1, selected_tier: 16 }] }),
  ] }],
  delivery: [
    order({ id: 'd1', order_number: 'AJ-1290', customer_name: 'Ravi', order_type: 'delivery', pickup_date: null, pickup_location: null,
      delivery_address: '1 Main St\nApt 2\nRound Rock, TX 78665\nUS',
      items: [{ product_name: 'Guntur Malpuri', quantity: 2, selected_tier: 15 }, { product_name: 'Chicken Pickle', quantity: 1, selected_tier: null }] }),
  ],
};

describe('9 AM daily prep email', () => {
  it('lists sweets to make (pickups + deliveries), pickups by location and deliveries waiting', () => {
    const email = buildDailyPrepEmail({ to: 'kitchen@example.com', date: '2026-10-15', plan });
    expect(email.subject).toBe("Today's prep · Thu, Oct 15 · 1 pickup · 1 to ship");
    expect(email.dedupeKey).toBe('daily-prep:2026-10-15');
    for (const text of [
      'Sweets to make', 'Kova Bobbatlu', '>16<', 'Malpuri', '>30<', 'To pack', 'Chicken Pickle',
      'Pickup orders today (1)', 'Biryanify - Plano · 4006W Plano Pkwy, Plano', 'AJ-1301', 'Kova Bobbatlu (16 pcs) × 1',
      'Delivery orders waiting to ship (1)', 'AJ-1290', 'Round Rock, TX', 'Oct 13', 'Guntur Malpuri (15 pcs) × 2',
    ]) expect(email.html).toContain(text);
    expect(email.html).toContain('Asha &lt;b&gt;');
    expect(email.html).not.toContain('$');
  });

  it('shows each waiting delivery order\'s shipment week', () => {
    const withWeek: ProductionPlan = { ...plan, delivery: [{ ...plan.delivery[0], ship_week: '2026-10-26' }] };
    expect(buildDailyPrepEmail({ to: 'k@example.com', date: '2026-10-15', plan: withWeek }).html).toContain('Mon Oct 26 / Tue Oct 27');
  });

  it("shows the owner's note under that order's items, escaped", () => {
    const noted: ProductionPlan = { ...plan, days: [{ date: '2026-10-15', orders: [
      order({ id: 'p2', order_number: 'AJ-1197', admin_note: 'Free Kova 16 <gift>\nPickup Sunday', items: [{ product_name: 'Kova', quantity: 1, selected_tier: 16 }] }),
    ] }] };
    const html = buildDailyPrepEmail({ to: 'k@example.com', date: '2026-10-15', plan: noted }).html;
    expect(html).toContain('Note: Free Kova 16 &lt;gift&gt;<br>Pickup Sunday');
  });

  it('says so when there are no pickups, and on Tuesdays that pickup is closed', () => {
    const empty = { days: [{ date: '2026-10-20', orders: [] }], delivery: [] };
    const tue = buildDailyPrepEmail({ to: 'k@example.com', date: '2026-10-20', plan: empty }).html;
    expect(tue).toContain('Pickup is closed today (Tuesday).');
    expect(tue).toContain('No delivery orders waiting.');
    expect(buildDailyPrepEmail({ to: 'k@example.com', date: '2026-10-21', plan: { ...empty, days: [{ date: '2026-10-21', orders: [] }] } }).html)
      .toContain('No pickup orders today.');
  });

  it('reads the ship-to city from a stored address', () => {
    expect(shipToCity('1 Main St\nRound Rock, TX 78665\nUS')).toBe('Round Rock, TX');
    expect(shipToCity(null)).toBe('—');
  });

  it('sends only at 9 AM Dallas time, summer and winter', async () => {
    const runs: string[] = [];
    const db = {
      prepare: (sql: string) => {
        const st = { bind: () => st, all: async () => ({ results: [] }), run: async () => { runs.push(sql); return {}; } };
        return st;
      },
    } as unknown as D1Database;
    expect(await sendDailyPrepEmail(db, { to: 'k@example.com', now: new Date('2026-10-15T14:00:00Z') })).toBe('sent'); // 9 AM CDT
    expect(await sendDailyPrepEmail(db, { to: 'k@example.com', now: new Date('2026-10-15T15:00:00Z') })).toBe('skipped'); // 10 AM CDT
    expect(await sendDailyPrepEmail(db, { to: 'k@example.com', now: new Date('2026-12-15T15:00:00Z') })).toBe('sent'); // 9 AM CST
    expect(await sendDailyPrepEmail(db, { to: 'k@example.com', now: new Date('2026-12-15T14:00:00Z') })).toBe('skipped'); // 8 AM CST
    expect(runs.filter((sql) => sql.includes('INSERT INTO email_outbox'))).toHaveLength(2);
  });
});
