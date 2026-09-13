import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext, MessageBatch, Queue, ScheduledController, SendEmail } from '@cloudflare/workers-types';
import type { EmailQueueMessage, processEmailOutboxMessage, recoverPendingEmailOutbox } from '@/lib/email-outbox';
import type { recoverPendingPaymentAttempts } from '@/lib/payment-attempts';
import type { executeSquarePaymentRequest, SquarePaymentRequest } from '@/lib/square';
import type { createOrderFromSession, PaymentSessionRow } from '@/lib/order-service';
import { createTestD1 } from '@/lib/test-utils/d1';

const mocks = vi.hoisted(() => ({
  emailRecovery: vi.fn<typeof recoverPendingEmailOutbox>(),
  paymentRecovery: vi.fn<typeof recoverPendingPaymentAttempts>(),
  execute: vi.fn<typeof executeSquarePaymentRequest>(),
  finalize: vi.fn<typeof createOrderFromSession>(),
  fetch: vi.fn(async () => new Response('mock generated Worker')),
  processEmail: vi.fn<typeof processEmailOutboxMessage>(),
  validMessage: vi.fn(),
}));

vi.mock('../../.open-next/worker.js', () => ({ default: { fetch: mocks.fetch } }));
vi.mock('@/lib/email-outbox', () => ({
  recoverPendingEmailOutbox: mocks.emailRecovery,
  isEmailQueueMessage: mocks.validMessage, markEmailOutboxEnqueued: vi.fn(), processEmailOutboxMessage: mocks.processEmail,
}));
vi.mock('@/lib/payment-attempts', () => ({ recoverPendingPaymentAttempts: mocks.paymentRecovery }));
vi.mock('@/lib/square', () => ({ executeSquarePaymentRequest: mocks.execute }));
vi.mock('@/lib/order-service', () => ({ createOrderFromSession: mocks.finalize }));

import worker from '../../custom-worker';

function fixture() {
  const database = createTestD1();
  const emailQueue: Queue<EmailQueueMessage> = {
    send: vi.fn<Queue<EmailQueueMessage>['send']>(),
    sendBatch: vi.fn<Queue<EmailQueueMessage>['sendBatch']>(),
    metrics: vi.fn<Queue<EmailQueueMessage>['metrics']>(),
  };
  const emailBinding: SendEmail = {
    send: vi.fn(async () => ({ messageId: 'cloudflare-test-message-id' })),
  };
  const env: Parameters<typeof worker.scheduled>[1] = {
    DB: database.db,
    EMAIL_QUEUE: emailQueue,
    EMAIL: emailBinding,
    EMAIL_PROVIDER: 'cloudflare',
    SQUARE_ENVIRONMENT: 'sandbox',
    SQUARE_ACCESS_TOKEN: 'fake-sandbox-token',
    NEXT_PUBLIC_SQUARE_APP_ID: 'sandbox-test-application',
    NEXT_PUBLIC_SQUARE_LOCATION_ID: 'sandbox-test-location',
  };
  const pending: Promise<unknown>[] = [];
  // The handler must use waitUntil, not request-only platform helpers.
  const ctx: ExecutionContext = {
    waitUntil: vi.fn<ExecutionContext['waitUntil']>((promise) => { pending.push(promise); }),
    passThroughOnException: vi.fn(), abort: vi.fn(), exports: {}, props: undefined,
    get tracing(): ExecutionContext['tracing'] { throw new Error('Tracing is not used in this test'); },
  };
  const controller: ScheduledController = { scheduledTime: Date.now(), cron: '*/15 * * * *', noRetry: vi.fn() };
  return { ...database, env, ctx, controller, pending };
}

describe('scheduled Worker recovery wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.emailRecovery.mockReset().mockResolvedValue(1);
    mocks.paymentRecovery.mockReset().mockResolvedValue(1);
    mocks.execute.mockReset().mockResolvedValue({ paymentId: 'test-payment', status: 'COMPLETED' });
    mocks.finalize.mockReset().mockResolvedValue({ orderId: 'test-order', orderNumber: 'AJ-TEST', duplicate: false });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A scheduled invocation must use its explicit runtime env, not a stale
    // request/global environment that could select a different Square account.
    vi.stubEnv('SQUARE_ENVIRONMENT', 'production');
    vi.stubEnv('SQUARE_ACCESS_TOKEN', 'unrelated-global-token');
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('registers independent recoveries and passes sandbox config and the queue to injected operations', async () => {
    const f = fixture();
    await worker.scheduled(f.controller, f.env, f.ctx);
    expect(f.ctx.waitUntil).toHaveBeenCalledTimes(2);
    expect(mocks.emailRecovery).toHaveBeenCalledExactlyOnceWith(f.db, f.env.EMAIL_QUEUE);
    expect(mocks.paymentRecovery).toHaveBeenCalledOnce();
    const [db, dependencies] = mocks.paymentRecovery.mock.calls[0];
    expect(db).toBe(f.db);
    if (!dependencies) throw new Error('Scheduled payment dependencies were not provided');
    const request: SquarePaymentRequest = {
      environment: 'sandbox', apiVersion: '2024-01-18', body: {
        source_id: 'fake-test-token', idempotency_key: 'test-original-key',
        amount_money: { amount: 4000, currency: 'USD' },
        location_id: 'sandbox-test-location', reference_id: 'test-session', note: 'Test', autocomplete: true,
      },
    };
    await dependencies.execute!(request);
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(request, {
      SQUARE_ACCESS_TOKEN: f.env.SQUARE_ACCESS_TOKEN,
      SQUARE_ENVIRONMENT: 'sandbox',
      NEXT_PUBLIC_SQUARE_LOCATION_ID: f.env.NEXT_PUBLIC_SQUARE_LOCATION_ID,
      NEXT_PUBLIC_SQUARE_APP_ID: f.env.NEXT_PUBLIC_SQUARE_APP_ID,
    });
    const session: PaymentSessionRow = {
      id: 'test-session', order_id: null, customer_name: 'Test', phone_number: '5551234567',
      email: 'test@example.invalid', cart_data: [], fulfillment_data: { type: 'pickup' },
      total_amount: 40, tax: 0, shipping: 0, coupon_code: null,
    };
    await dependencies.finalize!(f.db, session, 'test-payment');
    expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith(f.db, session, 'test-payment', { emailQueue: f.env.EMAIL_QUEUE });
    await expect(Promise.all(f.pending)).resolves.toEqual([undefined, undefined]);
    expect(worker.fetch).toBe(mocks.fetch);
    f.sqlite.close();
  });

  it.each(['email', 'payment', 'both'])('contains %s recovery failures without stopping the other recovery', async (failure) => {
    const f = fixture();
    if (failure !== 'payment') mocks.emailRecovery.mockRejectedValueOnce(new Error('email unavailable'));
    if (failure !== 'email') mocks.paymentRecovery.mockRejectedValueOnce(new Error('payment unavailable'));
    await expect(worker.scheduled(f.controller, f.env, f.ctx)).resolves.toBeUndefined();
    expect(mocks.emailRecovery).toHaveBeenCalledOnce();
    expect(mocks.paymentRecovery).toHaveBeenCalledOnce();
    expect(f.pending).toHaveLength(2);
    await expect(Promise.all(f.pending)).resolves.toEqual([undefined, undefined]);
    if (failure !== 'payment') expect(console.error).toHaveBeenCalledWith(expect.stringContaining('email_outbox_recovery_failed'));
    if (failure !== 'email') expect(console.error).toHaveBeenCalledWith(expect.stringContaining('payment_recovery_failed'));
    f.sqlite.close();
  });

  it('passes only invocation email settings to the Queue processor, not global production values', async () => {
    const f = fixture();
    vi.stubEnv('RESEND_API_KEY', 'unrelated-global-key');
    vi.stubEnv('FROM_EMAIL', 'orders@amammajaadi.com');
    vi.stubEnv('SANDBOX_EMAIL_RECIPIENT', 'different@example.com');
    const env = { ...f.env, RESEND_API_KEY: 'fake-sandbox-key', FROM_EMAIL: 'sandbox@amammajaadi.com',
      SANDBOX_EMAIL_RECIPIENT: 'ramcharan8600@gmail.com', SANDBOX_EMAIL_TEST_RECIPIENT: 'sairamcharan20@gmail.com' };
    const message = { id: 'test-queue-id', timestamp: new Date(), attempts: 1,
      body: { outboxId: '0e070594-546c-4a3a-9b02-b6596d3e8c53' }, ack: vi.fn(), retry: vi.fn() };
    const batch: MessageBatch<EmailQueueMessage> = {
      messages: [message], queue: 'amammajaadi-sandbox-email', ackAll: vi.fn(), retryAll: vi.fn(),
      metadata: { metrics: { backlogCount: 1, backlogBytes: 100 } },
    };
    mocks.validMessage.mockReturnValue(true);
    mocks.processEmail.mockResolvedValue({ action: 'ack', status: 'sent' });
    await worker.queue(batch, env);
    expect(mocks.processEmail).toHaveBeenCalledExactlyOnceWith(f.db, message.body, {
      provider: 'cloudflare', apiKey: 'fake-sandbox-key', emailBinding: f.env.EMAIL,
      fromEmail: 'sandbox@amammajaadi.com', environment: 'sandbox',
      sandboxRecipient: 'ramcharan8600@gmail.com',
      sandboxTestRecipient: 'sairamcharan20@gmail.com',
    });
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    f.sqlite.close();
  });
});
