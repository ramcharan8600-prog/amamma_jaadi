import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { D1Database } from '@cloudflare/workers-types';
import { processRefundEvent } from '@/lib/square-webhook';
import type { createOrderFromSession } from '@/lib/order-service';
import type { recordPaymentWebhookOutcome } from '@/lib/payment-attempts';
import { POST } from './route';

const routeMocks = vi.hoisted(() => ({
  getDb: vi.fn<() => D1Database>(),
  isDbConfigured: vi.fn<() => boolean>(),
  finalize: vi.fn<typeof createOrderFromSession>(),
  recordOutcome: vi.fn<typeof recordPaymentWebhookOutcome>(),
}));

vi.mock('@/lib/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/db')>(),
  getDb: routeMocks.getDb,
  isDbConfigured: routeMocks.isDbConfigured,
}));
vi.mock('@/lib/order-service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/order-service')>(),
  createOrderFromSession: routeMocks.finalize,
}));
vi.mock('@/lib/payment-attempts', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/payment-attempts')>(),
  recordPaymentWebhookOutcome: routeMocks.recordOutcome,
}));

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

// Real NextRequest/POST handler/HMAC verification; persistence dependencies
// are deliberately mocked. Live Square delivery and D1 dedup need separate tests.
describe('Square webhook POST signature and payment guards', () => {
  const webhookUrl = 'https://sandbox-shop.example.invalid/api/payments/webhook';
  const signatureKey = 'fictional-unit-test-signature-key-not-a-credential';
  const rawSession = {
    id: 'test-session', total_amount: 40, customer_name: 'Webhook Test',
    email: 'buyer@example.invalid', cart_data: '[]',
    fulfillment_data: JSON.stringify({ type: 'pickup', date: '2026-09-10' }),
  };
  let first: ReturnType<typeof vi.fn<() => Promise<Record<string, unknown> | null>>>;
  let bind: ReturnType<typeof vi.fn>;
  let db: D1Database;

  function event(amountMoney: unknown = { amount: 4000, currency: 'USD' }, status = 'COMPLETED') {
    return {
      event_id: 'fictional-event-1', type: 'payment.updated',
      data: { object: { payment: {
        id: 'fictional-payment-1', reference_id: 'test-session', status, amount_money: amountMoney,
      } } },
    };
  }

  function sign(rawBody: string, url = webhookUrl, key = signatureKey): string {
    return createHmac('sha256', key).update(url + rawBody).digest('base64');
  }

  function request(rawBody: string, signature: string | null = sign(rawBody)) {
    return new NextRequest(webhookUrl, {
      method: 'POST', body: rawBody,
      headers: {
        'content-type': 'application/json',
        ...(signature === null ? {} : { 'x-square-hmacsha256-signature': signature }),
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SQUARE_WEBHOOK_SIGNATURE_KEY', signatureKey);
    vi.stubEnv('SQUARE_WEBHOOK_URL', webhookUrl);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    first = vi.fn(async () => rawSession as Record<string, unknown> | null);
    bind = vi.fn(() => ({ first }));
    db = { prepare: vi.fn(() => ({ bind })) } as unknown as D1Database;
    routeMocks.getDb.mockReturnValue(db);
    routeMocks.isDbConfigured.mockReturnValue(true);
    routeMocks.recordOutcome.mockReset().mockResolvedValue(undefined);
    routeMocks.finalize.mockReset().mockResolvedValue({
      orderNumber: 'AJ-UNIT-TEST', orderId: 'fictional-order-1', duplicate: false,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('accepts a signature over the exact configured URL and unmodified raw body', async () => {
    const rawBody = JSON.stringify(event(), null, 2);
    const response = await POST(request(rawBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, orderNumber: 'AJ-UNIT-TEST', duplicate: false });
    expect(bind).toHaveBeenCalledWith('fictional-payment-1', 'test-session');
    expect(routeMocks.recordOutcome).toHaveBeenCalledExactlyOnceWith(db, 'test-session', 'fictional-payment-1', 'completed');
    expect(routeMocks.finalize).toHaveBeenCalledExactlyOnceWith(db,
      expect.objectContaining({ id: 'test-session', total_amount: 40 }), 'fictional-payment-1');
  });

  it.each(['missing header', 'wrong signature', 'wrong key', 'missing key', 'tampered body',
    'different URL', 'URL trailing slash', 'missing configured URL'])
    ('rejects %s with 403 before database access or mutation', async failure => {
      const original = JSON.stringify(event());
      let rawBody = original;
      let signature: string | null = sign(original);
      if (failure === 'missing header') signature = null;
      if (failure === 'wrong signature') signature = 'not-a-signature';
      if (failure === 'wrong key') vi.stubEnv('SQUARE_WEBHOOK_SIGNATURE_KEY', 'different-fictional-test-key');
      if (failure === 'missing key') vi.stubEnv('SQUARE_WEBHOOK_SIGNATURE_KEY', '');
      if (failure === 'tampered body') rawBody = original + '\n';
      if (failure === 'different URL') signature = sign(original, 'https://other.example.invalid/api/payments/webhook');
      if (failure === 'URL trailing slash') signature = sign(original, webhookUrl + '/');
      if (failure === 'missing configured URL') vi.stubEnv('SQUARE_WEBHOOK_URL', '');
      const response = await POST(request(rawBody, signature));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Invalid signature' });
      expect(routeMocks.getDb).not.toHaveBeenCalled();
      expect(routeMocks.recordOutcome).not.toHaveBeenCalled();
      expect(routeMocks.finalize).not.toHaveBeenCalled();
    });

  it.each([
    { amount: 3999, currency: 'USD' }, { amount: 4001, currency: 'USD' },
    { amount: 4000, currency: 'CAD' }, { amount: '4000', currency: 'USD' }, null,
  ])('rejects a correctly signed completed payment with mismatched amount/currency %j', async amountMoney => {
    const response = await POST(request(JSON.stringify(event(amountMoney))));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Payment amount mismatch' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(routeMocks.recordOutcome).not.toHaveBeenCalled();
    expect(routeMocks.finalize).not.toHaveBeenCalled();
  });

  it('acknowledges an unrelated Square payment without creating a website order', async () => {
    first.mockResolvedValue(null);
    const response = await POST(request(JSON.stringify(event())));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: 'no matching website session' });
    expect(routeMocks.recordOutcome).not.toHaveBeenCalled();
    expect(routeMocks.finalize).not.toHaveBeenCalled();
  });

  it('acknowledges repeated signed delivery using the existing finalization result', async () => {
    routeMocks.finalize.mockResolvedValueOnce({ orderNumber: 'AJ-UNIT-TEST', orderId: 'fictional-order-1', duplicate: false })
      .mockResolvedValueOnce({ orderNumber: 'AJ-UNIT-TEST', orderId: 'fictional-order-1', duplicate: true });
    const rawBody = JSON.stringify(event());
    const firstResponse = await POST(request(rawBody));
    const secondResponse = await POST(request(rawBody));
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toEqual({ received: true, orderNumber: 'AJ-UNIT-TEST', duplicate: true });
    expect(routeMocks.finalize).toHaveBeenCalledTimes(2);
    expect(routeMocks.finalize.mock.calls[1]).toEqual(routeMocks.finalize.mock.calls[0]);
  });

  it('returns 500 for retry if order finalization fails after recording the accepted payment', async () => {
    routeMocks.finalize.mockRejectedValueOnce(new Error('fictional D1 interruption'));
    const response = await POST(request(JSON.stringify(event())));
    expect(response.status).toBe(500);
    expect(routeMocks.recordOutcome).toHaveBeenCalledExactlyOnceWith(db, 'test-session', 'fictional-payment-1', 'completed');
  });

  it.each(['FAILED', 'DECLINED', 'CANCELED'])('records signed %s without creating an order', async status => {
    const response = await POST(request(JSON.stringify(event(undefined, status))));
    expect(response.status).toBe(200);
    expect(routeMocks.recordOutcome).toHaveBeenCalledExactlyOnceWith(db, 'test-session', 'fictional-payment-1', 'declined');
    expect(routeMocks.finalize).not.toHaveBeenCalled();
  });
});
