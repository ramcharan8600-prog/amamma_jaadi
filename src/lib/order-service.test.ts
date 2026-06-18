import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the order-number generator (pulls env/Supabase otherwise) and the email
// service so we can assert exactly how many confirmation emails are sent.
const { generateOrderNumber, sendOrderConfirmation } = vi.hoisted(() => {
  let seq = 1000;
  return {
    generateOrderNumber: vi.fn(async () => `AJ-${++seq}`),
    sendOrderConfirmation: vi.fn(async (..._args: unknown[]) => ({ success: true })),
  };
});
vi.mock('@/lib/supabase', () => ({ generateOrderNumber }));
vi.mock('@/lib/email-service', () => ({
  isEmailConfigured: () => true,
  sendOrderConfirmation,
}));

import { createOrderFromSession, type PaymentSessionRow } from '@/lib/order-service';
import type { SupabaseClient } from '@supabase/supabase-js';

interface OrderRow {
  id: string;
  order_number: string;
  square_payment_id: string;
}

/**
 * Minimal in-memory Supabase double that enforces UNIQUE(square_payment_id) on
 * the orders table — exactly the production DB constraint. `hiddenWinner`
 * simulates a concurrent delivery that committed between our pre-check and
 * insert (the TOCTOU race), surfacing as a 23505 on insert.
 */
function makeFakeDb(hiddenWinner: OrderRow | null = null) {
  const orders: OrderRow[] = [];
  const orderItems: unknown[] = [];
  let raceRevealed = false;
  let seq = 0;

  function runTerminal(state: {
    table: string;
    op: string;
    payload: Record<string, unknown> | null;
    filters: Record<string, unknown>;
  }) {
    const { table, op, payload, filters } = state;

    if (op === 'select' && table === 'orders') {
      const pid = filters.square_payment_id;
      const found = orders.find((o) => o.square_payment_id === pid) ?? null;
      return { data: found ? { id: found.id, order_number: found.order_number } : null, error: null };
    }

    if (op === 'insert' && table === 'orders') {
      const pid = String(payload!.square_payment_id);
      // Concurrent racer committed just before us → reveal it + raise 23505.
      if (hiddenWinner && hiddenWinner.square_payment_id === pid && !raceRevealed) {
        raceRevealed = true;
        orders.push(hiddenWinner);
        return { data: null, error: { code: '23505', message: 'duplicate key value' } };
      }
      if (orders.some((o) => o.square_payment_id === pid)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value' } };
      }
      const order: OrderRow = {
        id: `ord_${++seq}`,
        order_number: String(payload!.order_number),
        square_payment_id: pid,
      };
      orders.push(order);
      return { data: { id: order.id, order_number: order.order_number }, error: null };
    }

    if (op === 'insert' && table === 'order_items') {
      orderItems.push(...(payload as unknown as unknown[]));
      return { error: null };
    }

    if (op === 'update' && table === 'payment_sessions') {
      return { error: null };
    }

    return { data: null, error: null };
  }

  function builder(table: string) {
    const state = { table, op: 'select', payload: null as Record<string, unknown> | null, filters: {} as Record<string, unknown> };
    const b = {
      select() { return b; },
      eq(col: string, val: unknown) { state.filters[col] = val; return b; },
      insert(payload: Record<string, unknown>) { state.op = 'insert'; state.payload = payload; return b; },
      update(payload: Record<string, unknown>) { state.op = 'update'; state.payload = payload; return b; },
      async maybeSingle() { return runTerminal(state); },
      async single() { return runTerminal(state); },
      // Thenable: `await db.from(x).update(y).eq(...)` / `.insert(arr)` resolve here.
      then(onF: (v: unknown) => void, onR?: (e: unknown) => void) {
        Promise.resolve(runTerminal(state)).then(onF, onR);
      },
    };
    return b;
  }

  return {
    db: { from: (table: string) => builder(table) } as unknown as SupabaseClient,
    orders,
    orderItems,
  };
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

describe('Square webhook idempotency — createOrderFromSession', () => {
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
    const second = await createOrderFromSession(db, session, 'PAY_AAA'); // same payment id

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.orderNumber).toBe(first.orderNumber);
    expect(orders).toHaveLength(1); // still one order
    expect(sendOrderConfirmation).toHaveBeenCalledTimes(1); // still one email
  });

  it('short-circuits when the session is already linked (layer 1)', async () => {
    const { db, orders } = makeFakeDb();
    // Seed an order for this payment, then deliver with a linked session.
    await createOrderFromSession(db, makeSession(), 'PAY_BBB');
    sendOrderConfirmation.mockClear();

    const res = await createOrderFromSession(
      db,
      makeSession({ order_id: 'ord_1' }),
      'PAY_BBB'
    );

    expect(res.duplicate).toBe(true);
    expect(orders).toHaveLength(1);
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it('handles a concurrent race: 23505 on insert resolves to the winner (layer 3)', async () => {
    const winner: OrderRow = { id: 'ord_winner', order_number: 'AJ-9001', square_payment_id: 'PAY_RACE' };
    const { db, orders } = makeFakeDb(winner);

    const res = await createOrderFromSession(db, makeSession(), 'PAY_RACE');

    expect(res.duplicate).toBe(true);
    expect(res.orderNumber).toBe('AJ-9001'); // the racer's order, not a new one
    expect(orders).toHaveLength(1); // our insert did NOT add a second row
    expect(sendOrderConfirmation).not.toHaveBeenCalled(); // no duplicate email
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
