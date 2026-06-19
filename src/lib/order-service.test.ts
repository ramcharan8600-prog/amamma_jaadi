import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the D1 helpers (order number + id generator) and the email service so we
// can assert exactly how many confirmation emails are sent.
const { generateOrderNumber, newId, sendOrderConfirmation } = vi.hoisted(() => {
  let seq = 1000;
  let idc = 0;
  return {
    generateOrderNumber: vi.fn(async () => `AJ-${++seq}`),
    newId: vi.fn(() => `id_${++idc}`),
    sendOrderConfirmation: vi.fn(async (..._args: unknown[]) => ({ success: true })),
  };
});
vi.mock('@/lib/db', () => ({
  generateOrderNumber,
  newId,
  parseJson: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v),
  getDb: () => {
    throw new Error('getDb should not be called in unit tests');
  },
  isDbConfigured: () => true,
}));
vi.mock('@/lib/email-service', () => ({
  isEmailConfigured: () => true,
  sendOrderConfirmation,
}));

import { createOrderFromSession, type PaymentSessionRow } from '@/lib/order-service';
import type { D1Database } from '@cloudflare/workers-types';

interface OrderRow {
  id: string;
  order_number: string;
  square_payment_id: string;
}

/**
 * Minimal in-memory D1 double that enforces UNIQUE(square_payment_id) on the
 * orders table — exactly the production constraint. `hiddenWinner` simulates a
 * concurrent delivery that committed between our pre-check and insert (the
 * TOCTOU race), surfacing as a "UNIQUE constraint failed" error on insert.
 */
function makeFakeDb(hiddenWinner: OrderRow | null = null) {
  const orders: OrderRow[] = [];
  let raceRevealed = false;

  function runRun(sql: string, binds: unknown[]) {
    if (/INSERT INTO orders/i.test(sql)) {
      const id = String(binds[0]);
      const orderNumber = String(binds[1]);
      const pid = String(binds[12]); // 13th bound param = square_payment_id

      if (hiddenWinner && hiddenWinner.square_payment_id === pid && !raceRevealed) {
        raceRevealed = true;
        orders.push(hiddenWinner);
        throw new Error('D1_ERROR: UNIQUE constraint failed: orders.square_payment_id');
      }
      if (orders.some((o) => o.square_payment_id === pid)) {
        throw new Error('UNIQUE constraint failed: orders.square_payment_id');
      }
      orders.push({ id, order_number: orderNumber, square_payment_id: pid });
    }
    return { success: true };
  }

  function runFirst(sql: string, binds: unknown[]) {
    if (/SELECT id, order_number FROM orders WHERE square_payment_id/i.test(sql)) {
      const found = orders.find((o) => o.square_payment_id === String(binds[0]));
      return found ? { id: found.id, order_number: found.order_number } : null;
    }
    return null;
  }

  function prepare(sql: string) {
    let bound: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        bound = args;
        return stmt;
      },
      async first() {
        return runFirst(sql, bound);
      },
      async run() {
        return runRun(sql, bound);
      },
      __sql: sql,
      __bound: () => bound,
    };
    return stmt;
  }

  async function batch(statements: Array<{ __sql: string; __bound: () => unknown[] }>) {
    for (const s of statements) runRun(s.__sql, s.__bound());
    return [];
  }

  return { db: { prepare, batch } as unknown as D1Database, orders };
}

function makeSession(overrides: Partial<PaymentSessionRow> = {}): PaymentSessionRow {
  return {
    id: 'sess_1',
    order_id: null,
    customer_name: 'Test Buyer',
    phone_number: '5551234567',
    email: 'buyer@example.com',
    cart_data: [{ product: { name: 'Bobbatlu' }, quantity: 1, selectedTier: 16, lineTotal: 64 }],
    fulfillment_data: { type: 'pickup' },
    total_amount: 64,
    tax: 0,
    ...overrides,
  };
}

describe('Square webhook idempotency — createOrderFromSession (D1)', () => {
  beforeEach(() => {
    sendOrderConfirmation.mockClear();
  });

  it('creates exactly one order and sends one email on first delivery', async () => {
    const { db, orders } = makeFakeDb();
    const res = await createOrderFromSession(db, makeSession(), 'PAY_AAA');

    expect(res.duplicate).toBe(false);
    expect(orders).toHaveLength(1);
    expect(sendOrderConfirmation).toHaveBeenCalledTimes(1);
  });

  it('does NOT create a second order or email on a duplicate delivery (layer 2)', async () => {
    const { db, orders } = makeFakeDb();
    const session = makeSession();

    const first = await createOrderFromSession(db, session, 'PAY_AAA');
    const second = await createOrderFromSession(db, session, 'PAY_AAA');

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.orderNumber).toBe(first.orderNumber);
    expect(orders).toHaveLength(1);
    expect(sendOrderConfirmation).toHaveBeenCalledTimes(1);
  });

  it('short-circuits when the session is already linked (layer 1)', async () => {
    const { db, orders } = makeFakeDb();
    await createOrderFromSession(db, makeSession(), 'PAY_BBB');
    sendOrderConfirmation.mockClear();

    const res = await createOrderFromSession(db, makeSession({ order_id: 'id_1' }), 'PAY_BBB');

    expect(res.duplicate).toBe(true);
    expect(orders).toHaveLength(1);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it('handles a concurrent race: UNIQUE violation resolves to the winner (layer 3)', async () => {
    const winner: OrderRow = { id: 'ord_winner', order_number: 'AJ-9001', square_payment_id: 'PAY_RACE' };
    const { db, orders } = makeFakeDb(winner);

    const res = await createOrderFromSession(db, makeSession(), 'PAY_RACE');

    expect(res.duplicate).toBe(true);
    expect(res.orderNumber).toBe('AJ-9001');
    expect(orders).toHaveLength(1);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it('three deliveries of the same payment yield one order and one email', async () => {
    const { db, orders } = makeFakeDb();
    const session = makeSession();

    await createOrderFromSession(db, session, 'PAY_CCC');
    await createOrderFromSession(db, session, 'PAY_CCC');
    await createOrderFromSession(db, session, 'PAY_CCC');

    expect(orders).toHaveLength(1);
    expect(sendOrderConfirmation).toHaveBeenCalledTimes(1);
  });
});
