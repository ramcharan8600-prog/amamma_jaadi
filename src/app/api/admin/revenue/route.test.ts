import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createTestD1 } from '@/lib/test-utils/d1';

const mocks = vi.hoisted(() => ({ token: 'valid', configured: true, db: null as D1Database | null }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => mocks.token ? { value: mocks.token } : undefined }) }));
vi.mock('@/lib/session', () => ({ SESSION_COOKIE: 'session', verifySessionToken: (token: string) => token === 'valid' }));
vi.mock('@/lib/db', () => ({ getDb: () => mocks.db, isDbConfigured: () => mocks.configured }));
import { GET } from './route';

let fixture: ReturnType<typeof createTestD1>;
const url = 'https://shop.test/api/admin/revenue';
type RevenueResponse = {
  year: number;
  weeklyRevenue: { label: string; value: number }[];
  monthlyRevenue: { label: string; value: number }[];
};
const total = (bars: { value: number }[]) => Math.round(bars.reduce((sum, bar) => sum + bar.value, 0) * 100) / 100;

beforeEach(() => {
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('../../../../lib/d1-schema.sql', import.meta.url), 'utf8'));
  mocks.db = fixture.db;
  mocks.token = 'valid';
  mocks.configured = true;
});
afterEach(() => { fixture.sqlite.close(); vi.restoreAllMocks(); });

function addOrder(id: string, createdAt: string, amount = 10, status = 'paid', refunded = 0) {
  fixture.sqlite.prepare(`INSERT INTO orders
    (id, order_number, customer_name, phone_number, order_type, total_price, payment_status, refunded_amount, created_at)
    VALUES (?, ?, 'Fixture customer', '555', 'pickup', ?, ?, ?, ?)`)
    .run(id, `AJ-${id}`, amount, status, refunded, createdAt);
}

describe('annual revenue API', () => {
  it.each(['', 'invalid'])('requires a valid admin session (%s)', async token => {
    mocks.token = token;
    const response = await GET(new Request(`${url}?year=2026`));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it.each(['', '?year=2025', '?year=2032', '?year=2026.5', '?year=NaN', '?year=2026.0', '?year=2.026e3'])
    ('rejects invalid years %s', async query => {
      const response = await GET(new Request(url + query));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Choose a year from 2026 to 2031.' });
    });

  it.each([2026, 2027, 2028, 2029, 2030, 2031])('returns uncached, empty calendar periods for %i', async year => {
    const response = await GET(new Request(`${url}?year=${year}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const report: RevenueResponse = await response.json();
    expect(report.year).toBe(year);
    expect(report.monthlyRevenue).toHaveLength(year === 2026 ? 6 : 12);
    expect(total(report.weeklyRevenue)).toBe(0);
    expect(total(report.monthlyRevenue)).toBe(0);
    expect(Object.keys(report).sort()).toEqual(['monthlyRevenue', 'weeklyRevenue', 'year']);
  });

  it('includes every qualifying order beyond the order-list cap and returns only aggregates', async () => {
    for (let index = 0; index < 251; index += 1) {
      addOrder(`paid-${index}`, '2026-07-15 12:00:00', 1.01);
    }
    addOrder('partial', '2026-08-15 12:00:00', 100, 'partially_refunded', 25.25);
    addOrder('refunded', '2026-08-15 12:00:00', 200, 'refunded', 200);
    addOrder('pending', '2026-08-15 12:00:00', 300, 'pending');
    addOrder('failed', '2026-08-15 12:00:00', 400, 'failed');
    addOrder('test', '2026-08-15 12:00:00', 500);
    fixture.sqlite.prepare(`INSERT INTO order_reporting_exclusions (order_id, reason, recorded_by)
      VALUES ('test', 'Owner-confirmed test', 'owner')`).run();
    const response = await GET(new Request(`${url}?year=2026`));
    expect(response.status).toBe(200);
    const report: RevenueResponse = await response.json();
    expect(total(report.weeklyRevenue)).toBe(328.26);
    expect(total(report.monthlyRevenue)).toBe(328.26);
    expect(report.monthlyRevenue[0].value).toBe(253.51);
    expect(report.monthlyRevenue[1].value).toBe(74.75);
    expect(JSON.stringify(report)).not.toContain('Fixture customer');
    expect(JSON.stringify(report)).not.toContain('paid-');
  });

  it('uses Central midnight at the July launch and year boundaries for D1 and ISO timestamps', async () => {
    addOrder('before-launch', '2026-07-01 04:59:59', 1000);
    addOrder('launch', '2026-07-01T05:00:00Z', 1);
    addOrder('last-2026', '2027-01-01 05:59:59', 2);
    addOrder('first-2027', '2027-01-01T06:00:00Z', 4);
    addOrder('last-2027', '2028-01-01T05:59:59Z', 8);
    addOrder('first-2028', '2028-01-01 06:00:00', 16);
    const report2026: RevenueResponse = await (await GET(new Request(`${url}?year=2026`))).json();
    const report2027: RevenueResponse = await (await GET(new Request(`${url}?year=2027`))).json();
    expect(total(report2026.weeklyRevenue)).toBe(3);
    expect(total(report2026.monthlyRevenue)).toBe(3);
    expect(report2026.monthlyRevenue[0].value).toBe(1);
    expect(report2026.monthlyRevenue.at(-1)?.value).toBe(2);
    expect(total(report2027.weeklyRevenue)).toBe(12);
    expect(total(report2027.monthlyRevenue)).toBe(12);
    expect(report2027.monthlyRevenue[0].value).toBe(4);
    expect(report2027.monthlyRevenue.at(-1)?.value).toBe(8);
  });

  it('reports database unavailability instead of fabricated zero revenue', async () => {
    mocks.configured = false;
    const response = await GET(new Request(`${url}?year=2026`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Database unavailable' });
  });

  it('fails without partial data if the database query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fixture.faults.failOnSql = /FROM orders o/;
    fixture.faults.failuresRemaining = 1;
    const response = await GET(new Request(`${url}?year=2026`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Could not load revenue. Please try again.' });
  });
});
