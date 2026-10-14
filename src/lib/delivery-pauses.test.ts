import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createTestD1 } from '@/lib/test-utils/d1';
import { isDeliveryPausedFor, isDeliveryZone, listPausedZones, setPausedZones } from '@/lib/delivery-pauses';

function db() {
  const fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('./migrations/023-delivery-pauses.sql', import.meta.url), 'utf8'));
  return fixture.db;
}

describe('delivery pauses', () => {
  it('pauses any mix of Texas, nearby and far-away states', async () => {
    const d = db();
    expect(await listPausedZones(d)).toEqual([]);
    await setPausedZones(d, ['far', 'texas']);
    expect(await listPausedZones(d)).toEqual(['texas', 'far']);
    expect(await isDeliveryPausedFor(d, 'TX')).toBe(true);
    expect(await isDeliveryPausedFor(d, 'ok')).toBe(false); // Oklahoma is nearby
    expect(await isDeliveryPausedFor(d, 'NY')).toBe(true);
    await setPausedZones(d, []);
    expect(await isDeliveryPausedFor(d, 'NY')).toBe(false);
  });

  it('accepts only the three areas', () => {
    expect(['texas', 'nearby', 'far'].every(isDeliveryZone)).toBe(true);
    expect(isDeliveryZone('alaska')).toBe(false);
  });

  it('fails open when the table is missing, so checkout keeps working', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await isDeliveryPausedFor(createTestD1().db as D1Database, 'TX')).toBe(false);
  });
});
