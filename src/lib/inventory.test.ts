import { describe, it, expect, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { decrementStockForOrder, getStockMap, TRACKED_PRODUCT_IDS } from './inventory';

/**
 * In-memory D1 double for the `inventory` table. Mirrors the production
 * guarded-update semantics: `WHERE stock_count >= ?` only matches (and reports
 * `changes: 1`) when there is enough stock, which is what makes the decrement
 * atomic against concurrent orders.
 */
function makeFakeDb(initial: Record<string, number>, opts: { throwOnUpdate?: boolean } = {}) {
  const rows = { ...initial };
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (opts.throwOnUpdate) throw new Error('D1 write failed');
              // Guarded decrement: UPDATE ... SET stock_count = stock_count - ?
              if (sql.includes('stock_count - ?')) {
                const [qty, productId, need] = args as [number, string, number];
                if (rows[productId] !== undefined && rows[productId] >= need) {
                  rows[productId] -= qty;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              // Floor to zero fallback
              if (sql.includes('SET stock_count = 0')) {
                const [productId] = args as [string];
                if (rows[productId] !== undefined && rows[productId] > 0) {
                  rows[productId] = 0;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              return { meta: { changes: 0 } };
            },
            async all() {
              return {
                results: Object.entries(rows).map(([product_id, stock_count]) => ({
                  product_id,
                  stock_count,
                })),
              };
            },
          };
        },
        async all() {
          return {
            results: Object.entries(rows).map(([product_id, stock_count]) => ({
              product_id,
              stock_count,
            })),
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, rows };
}

describe('inventory — stock decrement on a paid order', () => {
  it('decrements a tracked product by the ordered quantity', async () => {
    const { db, rows } = makeFakeDb({ 'pickle-chicken': 10 });
    await decrementStockForOrder(db, [{ productId: 'pickle-chicken', quantity: 3 }], 'AJ-1001');
    expect(rows['pickle-chicken']).toBe(7);
  });

  it('ignores untracked products (sweets, gift boxes)', async () => {
    const { db, rows } = makeFakeDb({ 'pickle-chicken': 10 });
    await decrementStockForOrder(
      db,
      [
        { productId: 'sweet-kova', quantity: 4 },
        { productId: 'gift-box-party', quantity: 1 },
      ],
      'AJ-1002'
    );
    expect(rows['pickle-chicken']).toBe(10);
  });

  it('floors at zero and warns instead of going negative (oversell)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, rows } = makeFakeDb({ 'pickle-mutton': 1 });
    // Customer paid for 3 but only 1 was left — order still stands.
    await decrementStockForOrder(db, [{ productId: 'pickle-mutton', quantity: 3 }], 'AJ-1003');
    expect(rows['pickle-mutton']).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('OVERSOLD'));
    warn.mockRestore();
  });

  it('NEVER throws when the database write fails — a paid order must survive', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = makeFakeDb({ 'pickle-chicken': 5 }, { throwOnUpdate: true });
    await expect(
      decrementStockForOrder(db, [{ productId: 'pickle-chicken', quantity: 1 }], 'AJ-1004')
    ).resolves.toBeUndefined();
    err.mockRestore();
  });

  it('handles multiple tracked lines in one order', async () => {
    const { db, rows } = makeFakeDb({ 'pickle-chicken': 5, 'pickle-prawns': 5 });
    await decrementStockForOrder(
      db,
      [
        { productId: 'pickle-chicken', quantity: 2 },
        { productId: 'pickle-prawns', quantity: 1 },
      ],
      'AJ-1005'
    );
    expect(rows['pickle-chicken']).toBe(3);
    expect(rows['pickle-prawns']).toBe(4);
  });

  it('treats a missing quantity as 1', async () => {
    const { db, rows } = makeFakeDb({ 'pickle-chicken': 4 });
    await decrementStockForOrder(db, [{ productId: 'pickle-chicken' }], 'AJ-1006');
    expect(rows['pickle-chicken']).toBe(3);
  });
});

describe('inventory — stock map', () => {
  it('returns current counts for tracked products', async () => {
    const { db } = makeFakeDb({ 'pickle-chicken': 7, 'pickle-mutton': 0 });
    expect(await getStockMap(db)).toEqual({ 'pickle-chicken': 7, 'pickle-mutton': 0 });
  });

  it('tracks exactly the three pickles', () => {
    expect(TRACKED_PRODUCT_IDS).toEqual(['pickle-chicken', 'pickle-mutton', 'pickle-prawns']);
  });
});
