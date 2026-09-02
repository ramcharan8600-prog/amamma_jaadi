import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { processRefundEvent } from '@/lib/square-webhook';

function makeDb(options: { order?: { id: string } | null; session?: { id: string } | null } = {}) {
  const statements: Array<{ sql: string; binds: unknown[] }> = [];
  const firstCalls: Array<{ sql: string; binds: unknown[] }> = [];

  function prepare(sql: string) {
    let binds: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) {
        binds = values;
        return statement;
      },
      get sql() { return sql; },
      get binds() { return binds; },
      async first() {
        firstCalls.push({ sql, binds });
        if (sql.includes('FROM orders')) return options.order ?? null;
        if (sql.includes('FROM payment_sessions')) return options.session ?? null;
        return null;
      },
    };
    return statement;
  }

  const batch = vi.fn(async (input: Array<{ sql: string; binds: unknown[] }>) => {
    statements.push(...input.map((statement) => ({ sql: statement.sql, binds: statement.binds })));
    return [];
  });

  return {
    db: { prepare, batch } as unknown as D1Database,
    batch,
    statements,
    firstCalls,
  };
}

describe('Square refund webhook processing', () => {
  it('ignores non-refund events', async () => {
    const { db, batch } = makeDb();
    const result = await processRefundEvent(db, 'payment.updated', undefined);
    expect(result.handled).toBe(false);
    expect(batch).not.toHaveBeenCalled();
  });

  it('waits for a completed refund instead of marking a pending refund', async () => {
    const { db, batch } = makeDb();
    const lookup = vi.fn();
    const result = await processRefundEvent(db, 'refund.created', {
      id: 'REFUND_1',
      payment_id: 'PAYMENT_1',
      status: 'PENDING',
    }, lookup);
    expect(result).toMatchObject({ handled: true, updated: false });
    expect(lookup).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  it('marks both the order and payment session refunded after a full refund', async () => {
    const { db, batch, statements } = makeDb({ order: { id: 'ORDER_1' } });
    const result = await processRefundEvent(db, 'refund.updated', {
      id: 'REFUND_2',
      payment_id: 'PAYMENT_2',
      status: 'COMPLETED',
    }, async () => ({
      totalAmount: 10000,
      refundedAmount: 10000,
      referenceId: 'SESSION_2',
    }));

    expect(result).toEqual({ handled: true, updated: true, paymentStatus: 'refunded' });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(statements).toHaveLength(2);
    expect(statements[0].sql).toContain('orders SET payment_status = ?, refunded_amount = ?');
    expect(statements[1].sql).toContain('payment_sessions SET payment_status = ?');
    expect(statements[0].binds).toEqual(['refunded', 100, 'PAYMENT_2']);
    expect(statements[1].binds).toEqual(['refunded', 'PAYMENT_2', 'SESSION_2']);
  });

  it('labels a cumulative partial refund without hiding the order', async () => {
    const { db, statements } = makeDb({ order: { id: 'ORDER_3' } });
    const result = await processRefundEvent(db, 'refund.updated', {
      id: 'REFUND_3',
      payment_id: 'PAYMENT_3',
      status: 'COMPLETED',
    }, async () => ({ totalAmount: 10000, refundedAmount: 2500 }));

    expect(result.paymentStatus).toBe('partially_refunded');
    expect(statements[0].binds).toEqual(['partially_refunded', 25, 'PAYMENT_3']);
  });

  it('requests a retry when a website refund races ahead of order creation', async () => {
    const { db, batch } = makeDb({ session: { id: 'SESSION_4' } });
    await expect(processRefundEvent(db, 'refund.updated', {
      id: 'REFUND_4',
      payment_id: 'PAYMENT_4',
      status: 'COMPLETED',
    }, async () => ({
      totalAmount: 10000,
      refundedAmount: 10000,
      referenceId: 'SESSION_4',
    }))).rejects.toThrow('before the website order');
    expect(batch).not.toHaveBeenCalled();
  });

  it('acknowledges completed refunds from non-website Square channels', async () => {
    const { db, batch } = makeDb();
    const result = await processRefundEvent(db, 'refund.updated', {
      id: 'REFUND_5',
      payment_id: 'POS_PAYMENT',
      status: 'COMPLETED',
    }, async () => ({ totalAmount: 10000, refundedAmount: 10000 }));

    expect(result).toMatchObject({ handled: true, updated: false, reason: 'not website payment' });
    expect(batch).not.toHaveBeenCalled();
  });
});
