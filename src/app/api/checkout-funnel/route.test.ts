import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { D1Database } from '@cloudflare/workers-types';
import { createTestD1 } from '@/lib/test-utils/d1';

const mocks = vi.hoisted(() => ({ db: null as D1Database | null }));
vi.mock('@/lib/db', () => ({ getDb: () => mocks.db, isDbConfigured: () => true }));
import { POST } from './route';
import { daysBetween } from '@/lib/checkout-funnel';

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => {
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('../../../lib/d1-schema.sql', import.meta.url), 'utf8'));
  mocks.db = fixture.db;
});
afterEach(() => fixture.sqlite.close());

const VISIT = '0b6c7f9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f';
const post = (body: unknown, ip = '203.0.113.7') =>
  POST(new NextRequest('https://shop.test/api/checkout-funnel', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
const rows = () => fixture.sqlite.prepare('SELECT visit_id, step, detail FROM checkout_funnel ORDER BY rowid').all();

it('records each step once per checkout visit, keeping the first detail', async () => {
  expect((await post({ visitId: VISIT, step: 'method_viewed' })).status).toBe(204);
  await post({ visitId: VISIT, step: 'pickup_chosen' });
  await post({ visitId: VISIT, step: 'pickup_soonest_sold_out', detail: '2' });
  await post({ visitId: VISIT, step: 'pickup_soonest_sold_out', detail: '3' });
  await post({ visitId: VISIT, step: 'method_viewed' });
  expect(rows()).toEqual([
    { visit_id: VISIT, step: 'method_viewed', detail: '' },
    { visit_id: VISIT, step: 'pickup_chosen', detail: '' },
    { visit_id: VISIT, step: 'pickup_soonest_sold_out', detail: '2' },
  ]);
});

it('ignores unknown steps, bad ids, long or odd details and junk, always answering 204', async () => {
  for (const body of [
    { visitId: VISIT, step: 'drop_table' },
    { visitId: 'not-a-uuid', step: 'method_viewed' },
    { visitId: VISIT, step: 'delivery_fee_shown', detail: 'Jane Doe, 1 Main St' },
    { visitId: VISIT, step: 'delivery_fee_shown', detail: 'x'.repeat(17) },
    'not json',
    'x'.repeat(600),
  ]) {
    expect((await post(body, '203.0.113.8')).status).toBe(204);
  }
  expect(rows()).toEqual([]);
});

it('counts whole days between business dates', () => {
  expect(daysBetween('2026-10-16', '2026-10-16')).toBe(0);
  expect(daysBetween('2026-10-16', '2026-10-18')).toBe(2);
  expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
});
