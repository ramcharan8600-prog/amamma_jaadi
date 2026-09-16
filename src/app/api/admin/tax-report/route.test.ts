import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestD1 } from '@/lib/test-utils/d1';
import type { D1Database } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({ token: '', db: null as D1Database | null }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => mocks.token ? { value: mocks.token } : undefined }) }));
vi.mock('@/lib/session', () => ({ SESSION_COOKIE: 'session', verifySessionToken: (value: string) => value === 'valid' }));
vi.mock('@/lib/db', () => ({ getDb: () => mocks.db, isDbConfigured: () => true }));
vi.mock('@/lib/square', () => ({ getSquarePublicConfig: () => ({ environment: 'sandbox' }) }));
import { GET, POST } from './route';
let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => {
  fixture = createTestD1(); fixture.sqlite.exec(readFileSync(new URL('../../../../lib/d1-schema.sql', import.meta.url), 'utf8'));
  mocks.db = fixture.db; mocks.token = 'valid';
});
afterEach(() => fixture.sqlite.close());
const url = 'https://shop.test/api/admin/tax-report';

describe('admin tax report access and exports', () => {
  it.each(['', 'invalid'])('rejects missing or invalid admin authentication', async token => {
    mocks.token = token;
    expect((await GET(new Request(`${url}?year=2026&quarter=3`))).status).toBe(401);
    expect((await POST(new Request(url, { method: 'POST' }))).status).toBe(401);
  });
  it.each(['', '?year=2026&quarter=5', '?year=NaN&quarter=3', '?year=2026&quarter=1.5', '?year=2026&quarter=3&view=bad'])
    ('rejects invalid report parameters %s', async query => {
      expect((await GET(new Request(url + query))).status).toBe(400);
    });
  it('returns an uncached report and downloads identified as sandbox test data', async () => {
    const response = await GET(new Request(`${url}?year=2026&quarter=3`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ year: 2026, quarter: 3, environment: 'sandbox', rows: [] });
    const csv = await GET(new Request(`${url}?year=2026&quarter=3&format=csv`));
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toContain('sandbox-2026-Q3-transactions.csv');
    expect(await csv.text()).toContain('Configured rate (%)');
  });
  it('requires same-origin requests and validates amounts before storing allocations', async () => {
    expect((await POST(new Request(url, { method: 'POST', headers: { origin: 'https://other.test' }, body: '{}' }))).status).toBe(403);
    expect((await POST(new Request(url, { method: 'POST', headers: { origin: 'https://shop.test' }, body: '{' }))).status).toBe(400);
    expect((await POST(new Request(url, { method: 'POST', headers: { origin: 'https://shop.test' }, body: '{}' }))).status).toBe(400);
  });
  it('fails without returning a misleading partial report when the database fails', async () => {
    fixture.faults.failOnSql = /FROM orders o/; fixture.faults.failuresRemaining = 1;
    const response = await GET(new Request(`${url}?year=2026&quarter=3`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Could not load the tax report. No partial report was returned.' });
  });
});
