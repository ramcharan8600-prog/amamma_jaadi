import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestD1 } from '@/lib/test-utils/d1';
import {
  getPaymentAttemptStatus, runPaymentAttempt, recordPaymentWebhookOutcome,
  recoverPendingPaymentAttempts,
} from '@/lib/payment-attempts';
import { SquarePaymentError, type SquarePaymentRequest } from '@/lib/square';
import type { createOrderFromSession } from '@/lib/order-service';
import { toBusinessDateString } from '@/lib/date';

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => { throw new Error('test'); } }));

let fixture: ReturnType<typeof createTestD1>;
let finalize: ReturnType<typeof vi.fn<typeof createOrderFromSession>>;

// Keep date fixtures aligned with SQLite's real clock; fake JS time alone
// would not move the database's expiry and lease timestamps.
function pickupDate(daysAhead = 0): string {
  const date = new Date(`${toBusinessDateString(new Date())}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

function pickupFulfillment(date: unknown = pickupDate(1)) {
  return { type: 'pickup', date, locationId: 'plano-biryanify' };
}

/** Freeze pickup calendar time while recovery leases use SQLite's real clock. */
function setPickupClock(instant: string) {
  const replayClock = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
  vi.spyOn(Date, 'now').mockReturnValue(replayClock);
}

function setSessionPickupDate(date: string) {
  fixture.sqlite.prepare('UPDATE payment_sessions SET fulfillment_data = ?')
    .run(JSON.stringify(pickupFulfillment(date)));
}

function addSession(id = 'test-session') {
  fixture.sqlite.prepare(
    `INSERT INTO payment_sessions
     (id, customer_name, email, phone_number, cart_data, fulfillment_data, total_amount, idempotency_key)
     VALUES (?, 'Test Buyer', 'test@example.com', '5551234567', ?, ?, 40, ?)`
  ).run(id, JSON.stringify([{ productId: 'sweet-malpuri', product: { name: 'Guntur Malpuri' },
    quantity: 1, selectedTier: 16, lineTotal: 40 }]), JSON.stringify(pickupFulfillment()), `key-${id}`);
}

function attempt() {
  return fixture.sqlite.prepare('SELECT * FROM payment_attempts WHERE session_id = ?').get('test-session');
}

beforeEach(() => {
  process.env.SQUARE_ACCESS_TOKEN = 'sandbox-test-token';
  process.env.SQUARE_ENVIRONMENT = 'sandbox';
  process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID = 'test-location';
  fixture = createTestD1();
  fixture.sqlite.exec(readFileSync(new URL('./d1-schema.sql', import.meta.url), 'utf8'));
  fixture.sqlite.exec(readFileSync(new URL('./migrations/009-payment-attempts.sql', import.meta.url), 'utf8'));
  addSession();
  finalize = vi.fn(async (_db, session, paymentId) => {
    fixture.sqlite.prepare(
      "UPDATE payment_sessions SET order_id = 'test-order', square_payment_id = ?, payment_status = 'completed' WHERE id = ?"
    ).run(paymentId, session.id);
    return { orderNumber: 'AJ-TEST', orderId: 'test-order', duplicate: false };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  fixture.sqlite.close();
});

describe('10-digit contact phones before a first charge', () => {
  it.each(['214555010', '12145550100'])('expires an unattempted session with phone %s without charging', async (phone) => {
    fixture.sqlite.prepare('UPDATE payment_sessions SET phone_number = ?').run(phone);
    const execute = vi.fn();
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'never-send-token' }, { execute, finalize }))
      .toMatchObject({ code: 'SESSION_EXPIRED', canStartNewSession: true });
    expect(execute).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(attempt()).toBeUndefined();
    expect(fixture.sqlite.prepare('SELECT payment_status FROM payment_sessions').get()?.payment_status).toBe('expired');
  });

  it('allows a first charge with exactly 10 phone digits', async () => {
    fixture.sqlite.prepare('UPDATE payment_sessions SET phone_number = ?').run('2145550100');
    const execute = vi.fn(async () => ({ paymentId: 'payment-valid-phone', status: 'COMPLETED' }));
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'valid-token' }, { execute, finalize }))
      .toMatchObject({ success: true, code: 'PAYMENT_COMPLETED' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('replays an existing uncertain payment despite a now-invalid stored phone', async () => {
    const execute = vi.fn().mockRejectedValueOnce(new SquarePaymentError('PAYMENT_RESPONSE_UNKNOWN'))
      .mockResolvedValue({ paymentId: 'payment-recovered-phone', status: 'COMPLETED' });
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'original-token' }, { execute, finalize }))
      .toMatchObject({ status: 'unknown', canStartNewSession: false });
    fixture.sqlite.prepare('UPDATE payment_sessions SET phone_number = ?').run('214555010');
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', retry: true }, { execute, finalize }))
      .toMatchObject({ success: true, code: 'PAYMENT_COMPLETED', canStartNewSession: false });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toEqual(execute.mock.calls[0][0]);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM payment_attempts').get()?.count).toBe(1);
  });

  it('lets an in-flight payment finish despite a now-invalid stored phone', async () => {
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const execute = vi.fn(async () => {
      started(); await barrier;
      return { paymentId: 'payment-in-flight-phone', status: 'COMPLETED' };
    });
    const first = runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'original-token' }, { execute, finalize });
    await entered;
    fixture.sqlite.prepare('UPDATE payment_sessions SET phone_number = ?').run('214555010');
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'original-token' }, { execute, finalize }))
      .toMatchObject({ status: 'processing', canStartNewSession: false });
    expect(execute).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toMatchObject({ success: true, code: 'PAYMENT_COMPLETED' });
  });

  it('finalizes an accepted payment despite an invalid phone without charging again', async () => {
    const execute = vi.fn(async () => ({ paymentId: 'payment-accepted-phone', status: 'COMPLETED' }));
    finalize.mockRejectedValueOnce(new Error('D1 order transaction failed'));
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'original-token' }, { execute, finalize }))
      .toMatchObject({ code: 'ORDER_FINALIZING', canStartNewSession: false });
    fixture.sqlite.prepare('UPDATE payment_sessions SET phone_number = ?').run('12145550100');
    expect(await getPaymentAttemptStatus(fixture.db, 'test-session', { execute, finalize }))
      .toMatchObject({ success: true, code: 'PAYMENT_COMPLETED', canStartNewSession: false });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(2);
  });
});

describe('durable payment recovery using real SQLite transactions', () => {
  it.each(['abc', 0, -1, 0.5, null, true])('rejects legacy quantity %j before creating a charge attempt', async quantity => {
    fixture.sqlite.prepare('UPDATE payment_sessions SET cart_data = ? WHERE id = ?')
      .run(JSON.stringify([{ productId: 'sweet-malpuri', quantity, selectedTier: 16, lineTotal: 40 }]), 'test-session');
    const execute = vi.fn();
    const result = await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'never-send-token' }, { execute, finalize });
    expect(result).toMatchObject({ code: 'SESSION_EXPIRED', canStartNewSession: true });
    expect(execute).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(attempt()).toBeUndefined();
  });

  it.each([null, {}, [], { type: 'postal' }])('does not charge a legacy session with invalid fulfillment %j', async fulfillment => {
    fixture.sqlite.prepare('UPDATE payment_sessions SET fulfillment_data = ?').run(JSON.stringify(fulfillment));
    const execute = vi.fn();
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'never-send-token' }, { execute, finalize }))
      .toMatchObject({ code: 'SESSION_EXPIRED', canStartNewSession: true });
    expect(execute).not.toHaveBeenCalled();
    expect(attempt()).toBeUndefined();
  });

  it.each([
    ['missing date', () => ({ type: 'pickup', locationId: 'plano-biryanify' })],
    ['empty date', () => pickupFulfillment('')],
    ['malformed date', () => pickupFulfillment('not-a-date')],
    ['expanded year regression', () => pickupFulfillment('122026-01-09')],
    ['impossible date', () => pickupFulfillment('2026-02-30')],
    ['past date', () => pickupFulfillment(pickupDate(-1))],
    ['day 91', () => pickupFulfillment(pickupDate(91))],
  ] as const)('rejects an unattempted pickup with %s before contacting Square', async (_label, fulfillment) => {
    fixture.sqlite.prepare('UPDATE payment_sessions SET fulfillment_data = ?')
      .run(JSON.stringify(fulfillment()));
    const execute = vi.fn();
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'never-send-token' }, { execute, finalize }))
      .toMatchObject({ code: 'SESSION_EXPIRED', canStartNewSession: true });
    expect(execute).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(attempt()).toBeUndefined();
    expect(fixture.sqlite.prepare('SELECT payment_status FROM payment_sessions').get()?.payment_status).toBe('expired');
  });

  it.each([1, 90])('allows an initial pickup payment scheduled %i days ahead', async daysAhead => {
    const date = pickupDate(daysAhead);
    fixture.sqlite.prepare('UPDATE payment_sessions SET fulfillment_data = ?')
      .run(JSON.stringify(pickupFulfillment(date)));
    const execute = vi.fn(async () => ({ paymentId: 'payment-one', status: 'COMPLETED' }));
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'one-token' }, { execute, finalize }))
      .toMatchObject({ success: true, code: 'PAYMENT_COMPLETED', canStartNewSession: false });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize.mock.calls[0][1].fulfillment_data?.date).toBe(date);
  });

  it.each([
    ['stale item price', 39, 0, pickupFulfillment()],
    ['far-state minimum bypass', 51.99, 11.99, { type: 'delivery', state: 'NY' }],
    ['invalid delivery state', 46.99, 6.99, { type: 'delivery', state: 'TE' }],
    ['stale shipping rate', 44.99, 4.99, { type: 'delivery', state: 'TX' }],
  ])('closes an unattempted checkout with %s instead of charging it', async (_label, total, shipping, fulfillment) => {
    fixture.sqlite.prepare('UPDATE payment_sessions SET total_amount = ?, shipping = ?, fulfillment_data = ?')
      .run(total, shipping, JSON.stringify(fulfillment));
    const execute = vi.fn();
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'never-send-token' }, { execute, finalize }))
      .toMatchObject({ code: 'SESSION_EXPIRED', canStartNewSession: true });
    expect(execute).not.toHaveBeenCalled();
    expect(attempt()).toBeUndefined();
  });

  it('does not contact Square unless the request snapshot and processing state commit together', async () => {
    fixture.faults.failOnSql = /UPDATE payment_sessions SET payment_status = 'processing', cart_data/;
    fixture.faults.failuresRemaining = 1;
    const execute = vi.fn();
    await expect(runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'never-send-token' }, { execute, finalize })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    expect(attempt()).toBeUndefined();
    expect(fixture.sqlite.prepare('SELECT payment_status FROM payment_sessions').get()?.payment_status).toBe('pending');
  });

  it.each(['before', 'after'])('reuses exactly one request/key when the connection is lost %s acceptance', async when => {
    const accepted = new Map<string, string>();
    let calls = 0;
    const execute = vi.fn(async (request: SquarePaymentRequest) => {
      calls++;
      if (calls === 1 && when === 'before') throw new SquarePaymentError('PAYMENT_RESPONSE_UNKNOWN');
      accepted.set(request.body.idempotency_key, 'payment-one');
      if (calls === 1) throw new SquarePaymentError('PAYMENT_RESPONSE_UNKNOWN');
      return { paymentId: 'payment-one', status: 'COMPLETED' };
    });
    const first = await runPaymentAttempt(fixture.db, {
      sessionId: 'test-session', sourceId: 'one-time-token', verificationToken: 'legacy-verification',
    }, { execute, finalize });
    expect(first).toMatchObject({ httpStatus: 202, canStartNewSession: false, status: 'unknown' });
    expect(attempt()?.request_json).toContain('one-time-token');
    const recovered = await runPaymentAttempt(fixture.db, { sessionId: 'test-session', retry: true }, { execute, finalize });
    expect(recovered).toMatchObject({ success: true, orderNumber: 'AJ-TEST' });
    expect(execute.mock.calls[0][0]).toEqual(execute.mock.calls[1][0]);
    expect(accepted.size).toBe(1);
    expect(attempt()).toMatchObject({ state: 'completed', request_json: null });
  });

  it('allows a fresh session only after an explicit confirmed decline', async () => {
    const execute = vi.fn(async () => { throw new SquarePaymentError('GENERIC_DECLINE', true); });
    const declined = await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'declined-token' }, { execute, finalize });
    expect(declined).toMatchObject({ httpStatus: 402, code: 'PAYMENT_DECLINED', canStartNewSession: true });
    expect(attempt()).toMatchObject({ state: 'declined', request_json: null });
    await runPaymentAttempt(fixture.db, { sessionId: 'test-session', sourceId: 'different-token' }, { execute, finalize });
    expect(execute).toHaveBeenCalledTimes(1);
    addSession('fresh-session');
    const success = await runPaymentAttempt(fixture.db, { sessionId: 'fresh-session', sourceId: 'new-token' },
      { execute: async () => ({ paymentId: 'payment-new', status: 'COMPLETED' }), finalize });
    expect(success.success).toBe(true);
    expect(fixture.sqlite.prepare('SELECT COUNT(DISTINCT idempotency_key) AS count FROM payment_attempts').get()?.count).toBe(2);
  });

  it('does not create a second attempt while the first request holds its lease', async () => {
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const execute = vi.fn(async () => { started(); await barrier; return { paymentId: 'payment-one', status: 'COMPLETED' }; });
    const first = runPaymentAttempt(fixture.db, { sessionId: 'test-session', sourceId: 'one-token' }, { execute, finalize });
    await entered;
    const concurrent = await runPaymentAttempt(fixture.db, { sessionId: 'test-session', sourceId: 'one-token' }, { execute, finalize });
    expect(concurrent).toMatchObject({ httpStatus: 202, canStartNewSession: false });
    expect(execute).toHaveBeenCalledTimes(1);
    release();
    expect((await first).success).toBe(true);
  });

  it('recovers an uncertain attempt after checkout expiry using the same token/key', async () => {
    const execute = vi.fn().mockRejectedValueOnce(new SquarePaymentError('PAYMENT_RESPONSE_UNKNOWN'))
      .mockResolvedValue({ paymentId: 'payment-one', status: 'COMPLETED' });
    await runPaymentAttempt(fixture.db, { sessionId: 'test-session', sourceId: 'one-token' }, { execute, finalize });
    fixture.sqlite.exec("UPDATE payment_sessions SET expires_at = datetime('now', '-1 day')");
    expect((await getPaymentAttemptStatus(fixture.db, 'test-session', { execute, finalize })).canStartNewSession).toBe(false);
    expect((await runPaymentAttempt(fixture.db, { sessionId: 'test-session', retry: true }, { execute, finalize })).success).toBe(true);
    expect(execute.mock.calls[0][0]).toEqual(execute.mock.calls[1][0]);
  });

  it.each([
    ['past', (): string => pickupDate(-1)],
    ['invalid', (): string => '122026-01-09'],
  ] as const)('recovers an existing uncertain payment even when its stored pickup date is now %s', async (_label, date) => {
    const execute = vi.fn().mockRejectedValueOnce(new SquarePaymentError('PAYMENT_RESPONSE_UNKNOWN'))
      .mockResolvedValue({ paymentId: 'payment-one', status: 'COMPLETED' });
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'original-token' }, { execute, finalize }))
      .toMatchObject({ status: 'unknown', canStartNewSession: false });
    const storedDate = date();
    fixture.sqlite.prepare('UPDATE payment_sessions SET fulfillment_data = ?')
      .run(JSON.stringify(pickupFulfillment(storedDate)));
    expect(await getPaymentAttemptStatus(fixture.db, 'test-session', { execute, finalize }))
      .toMatchObject({ status: 'unknown', canStartNewSession: false });
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', retry: true }, { execute, finalize }))
      .toMatchObject({ success: true, code: 'PAYMENT_COMPLETED', canStartNewSession: false });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toEqual(execute.mock.calls[0][0]);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM payment_attempts').get()?.count).toBe(1);
    expect(attempt()).toMatchObject({ state: 'completed', request_json: null });
    expect(finalize.mock.calls[0][1].fulfillment_data?.date).toBe(storedDate);
  });

  it('rejects replacement tokens without overwriting an uncertain attempt', async () => {
    const execute = vi.fn(async () => { throw new SquarePaymentError('PAYMENT_RESPONSE_UNKNOWN'); });
    await runPaymentAttempt(fixture.db, { sessionId: 'test-session', sourceId: 'one-token' }, { execute, finalize });
    const mismatch = await runPaymentAttempt(fixture.db, { sessionId: 'test-session', sourceId: 'different-token' }, { execute, finalize });
    expect(mismatch).toMatchObject({ httpStatus: 409, code: 'PAYMENT_ATTEMPT_MISMATCH', canStartNewSession: false });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(attempt()?.request_json).toContain('one-token');
  });

  it('retains the original request if saving an accepted payment fails', async () => {
    const execute = vi.fn<(request: SquarePaymentRequest) => Promise<{ paymentId: string; status: string }>>(async () => {
      if (execute.mock.calls.length === 1) {
        fixture.faults.failOnSql = /UPDATE payment_attempts SET state = 'completed'/;
        fixture.faults.failuresRemaining = 1;
      }
      return { paymentId: 'payment-one', status: 'COMPLETED' };
    });
    const first = await runPaymentAttempt(fixture.db, { sessionId: 'test-session', sourceId: 'one-token' }, { execute, finalize });
    expect(first).toMatchObject({ httpStatus: 202, canStartNewSession: false });
    expect(attempt()?.request_json).toContain('one-token');
    fixture.sqlite.exec("UPDATE payment_attempts SET lease_until = datetime('now', '-1 second')");
    expect((await runPaymentAttempt(fixture.db, { sessionId: 'test-session', retry: true }, { execute, finalize })).success).toBe(true);
    expect(execute.mock.calls[0][0]).toEqual(execute.mock.calls[1][0]);
  });

  it('repairs a failed order write from the saved payment without another charge', async () => {
    const execute = vi.fn(async () => ({ paymentId: 'payment-one', status: 'COMPLETED' }));
    finalize.mockRejectedValueOnce(new Error('D1 order transaction failed'));
    const first = await runPaymentAttempt(fixture.db, { sessionId: 'test-session', sourceId: 'one-token' }, { execute, finalize });
    expect(first).toMatchObject({ httpStatus: 202, code: 'ORDER_FINALIZING', canStartNewSession: false });
    expect(attempt()).toMatchObject({ state: 'completed', request_json: null });
    expect((await getPaymentAttemptStatus(fixture.db, 'test-session', { execute, finalize })).success).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['past', (): string => pickupDate(-1)],
    ['invalid', (): string => '122026-01-09'],
  ] as const)('finalizes an already accepted payment with a now-%s pickup date without another charge', async (_label, date) => {
    const execute = vi.fn(async () => ({ paymentId: 'payment-one', status: 'COMPLETED' }));
    finalize.mockRejectedValueOnce(new Error('D1 order transaction failed'));
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'original-token' }, { execute, finalize }))
      .toMatchObject({ code: 'ORDER_FINALIZING', canStartNewSession: false });
    expect(attempt()).toMatchObject({ state: 'completed', request_json: null });
    const storedDate = date();
    fixture.sqlite.prepare('UPDATE payment_sessions SET fulfillment_data = ?')
      .run(JSON.stringify(pickupFulfillment(storedDate)));
    expect(await getPaymentAttemptStatus(fixture.db, 'test-session', { execute, finalize }))
      .toMatchObject({ success: true, code: 'PAYMENT_COMPLETED', canStartNewSession: false });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(2);
    expect(finalize.mock.calls[1][1].fulfillment_data?.date).toBe(storedDate);
  });

  it('a webhook completing during a lost response wins over the later network error', async () => {
    const execute = vi.fn(async () => {
      await recordPaymentWebhookOutcome(fixture.db, 'test-session', 'payment-one', 'completed');
      throw new SquarePaymentError('PAYMENT_RESPONSE_UNKNOWN');
    });
    const result = await runPaymentAttempt(fixture.db, { sessionId: 'test-session', sourceId: 'one-token' }, { execute, finalize });
    expect(result.success).toBe(true);
    expect(attempt()).toMatchObject({ state: 'completed', request_json: null });
    await recordPaymentWebhookOutcome(fixture.db, 'test-session', 'payment-one', 'declined');
    expect(attempt()?.state).toBe('completed');
    expect((await getPaymentAttemptStatus(fixture.db, 'test-session', { execute, finalize })).success).toBe(true);
  });

  it('safe no-attempt recovery closes the session so a late initial POST cannot charge', async () => {
    const execute = vi.fn(async () => ({ paymentId: 'payment-one', status: 'COMPLETED' }));
    expect((await getPaymentAttemptStatus(fixture.db, 'test-session', { execute, finalize })).canStartNewSession).toBe(false);
    expect(await runPaymentAttempt(fixture.db, { sessionId: 'test-session', retry: true }, { execute, finalize }))
      .toMatchObject({ code: 'SESSION_EXPIRED', canStartNewSession: true });
    expect(await runPaymentAttempt(fixture.db, { sessionId: 'test-session', sourceId: 'late-token' }, { execute, finalize }))
      .toMatchObject({ code: 'SESSION_EXPIRED', canStartNewSession: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it('a scheduler recovers only saved new attempts and never starts untouched sessions', async () => {
    const execute = vi.fn().mockRejectedValueOnce(new SquarePaymentError('PAYMENT_RESPONSE_UNKNOWN'))
      .mockResolvedValue({ paymentId: 'payment-one', status: 'COMPLETED' });
    await runPaymentAttempt(fixture.db, { sessionId: 'test-session', sourceId: 'one-token' }, { execute, finalize });
    addSession('untouched-session');
    expect(await recoverPendingPaymentAttempts(fixture.db, { execute, finalize })).toBe(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM payment_attempts').get()?.count).toBe(1);
  });

  it.each([
    ["created_at = datetime('now', '-31 minutes')", 'elapsed retry window'],
    ['attempt_count = 12', 'exhausted retry count'],
  ])('requires review for %s (%s) without another charge or a new-session invitation', async (update) => {
    const execute = vi.fn(async () => { throw new SquarePaymentError('PAYMENT_RESPONSE_UNKNOWN'); });
    await runPaymentAttempt(fixture.db, { sessionId: 'test-session', sourceId: 'one-token' }, { execute, finalize });
    fixture.sqlite.exec(`UPDATE payment_attempts SET ${update}`);
    expect(await runPaymentAttempt(fixture.db, { sessionId: 'test-session', retry: true }, { execute, finalize }))
      .toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED', canStartNewSession: false });
    expect(await getPaymentAttemptStatus(fixture.db, 'test-session', { execute, finalize }))
      .toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED', canStartNewSession: false });
    expect(await recoverPendingPaymentAttempts(fixture.db, { execute, finalize })).toBe(0);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).not.toHaveBeenCalled();
  });

  it.each([
    "created_at = datetime('now', '-31 minutes')",
    'attempt_count = 12',
  ])('checks %s atomically when a stale reader tries to claim a lease', async update => {
    const execute = vi.fn(async () => { throw new SquarePaymentError('PAYMENT_RESPONSE_UNKNOWN'); });
    await runPaymentAttempt(fixture.db, { sessionId: 'test-session', sourceId: 'one-token' }, { execute, finalize });
    const prepare = fixture.db.prepare.bind(fixture.db);
    vi.spyOn(fixture.db, 'prepare').mockImplementation(sql => {
      // Simulate another Worker using the last retry, or crossing the deadline,
      // after this Worker read the attempt but before it atomically takes a lease.
      if (sql.includes("UPDATE payment_attempts SET state = 'processing', lease_token")) {
        fixture.sqlite.exec(`UPDATE payment_attempts SET ${update}`);
      }
      return prepare(sql);
    });
    expect(await runPaymentAttempt(fixture.db, { sessionId: 'test-session', retry: true }, { execute, finalize }))
      .toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED', canStartNewSession: false });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('can finish a known successful payment after the replay window without charging again', async () => {
    const execute = vi.fn(async () => ({ paymentId: 'payment-one', status: 'COMPLETED' }));
    finalize.mockRejectedValueOnce(new Error('D1 temporarily unavailable'));
    await runPaymentAttempt(fixture.db, { sessionId: 'test-session', sourceId: 'one-token' }, { execute, finalize });
    fixture.sqlite.exec("UPDATE payment_attempts SET created_at = datetime('now', '-2 days'), attempt_count = 12");
    expect(await recoverPendingPaymentAttempts(fixture.db, { execute, finalize })).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(2);
  });

  it('does not mistake an old failed session with no durable attempt for a confirmed decline', async () => {
    fixture.sqlite.exec("UPDATE payment_sessions SET payment_status = 'failed'");
    const execute = vi.fn();
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'replacement-token' }, { execute, finalize }))
      .toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED', canStartNewSession: false });
    expect(execute).not.toHaveBeenCalled();
    expect(attempt()).toBeUndefined();
  });
});


describe.each([
  ['CDT', '2026-07-15T18:29:59.999Z', '2026-07-15T18:30:00.000Z', '2026-07-15T18:30:00.001Z', '2026-07-15'],
  ['CST', '2026-01-15T19:29:59.999Z', '2026-01-15T19:30:00.000Z', '2026-01-15T19:30:00.001Z', '2026-01-15'],
] as const)('inclusive 1:30 PM pickup cutoff in %s', (_season, beforeCutoff, cutoff, afterCutoff, today) => {
  it.each([
    ['13:29:59.999', beforeCutoff],
    ['13:30:00.000', cutoff],
  ])('allows a first same-day charge at %s', async (_label, now) => {
    setPickupClock(now);
    setSessionPickupDate(today);
    const execute = vi.fn(async () => ({ paymentId: 'payment-before-cutoff', status: 'COMPLETED' }));
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'valid-token' }, { execute, finalize }))
      .toMatchObject({ success: true, code: 'PAYMENT_COMPLETED' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('expires an untouched same-day session one millisecond after 13:30 without charging', async () => {
    setPickupClock(beforeCutoff);
    setSessionPickupDate(today);
    const execute = vi.fn();
    vi.setSystemTime(new Date(afterCutoff));
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'never-send-token' }, { execute, finalize }))
      .toMatchObject({ code: 'SESSION_EXPIRED', canStartNewSession: true });
    expect(execute).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(attempt()).toBeUndefined();
    expect(fixture.sqlite.prepare('SELECT payment_status FROM payment_sessions').get()?.payment_status).toBe('expired');
  });

  it('replays an uncertain payment past 13:30 with its original token and key', async () => {
    setPickupClock(beforeCutoff);
    setSessionPickupDate(today);
    const execute = vi.fn().mockRejectedValueOnce(new SquarePaymentError('PAYMENT_RESPONSE_UNKNOWN'))
      .mockResolvedValue({ paymentId: 'payment-across-cutoff', status: 'COMPLETED' });
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'original-token' }, { execute, finalize }))
      .toMatchObject({ status: 'unknown', canStartNewSession: false });
    vi.setSystemTime(new Date(afterCutoff));
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', retry: true }, { execute, finalize }))
      .toMatchObject({ success: true, code: 'PAYMENT_COMPLETED', canStartNewSession: false });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toEqual(execute.mock.calls[0][0]);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM payment_attempts').get()?.count).toBe(1);
    expect(finalize.mock.calls[0][1].fulfillment_data?.date).toBe(today);
  });

  it('lets a submitted payment finish after 13:30 without a second charge', async () => {
    setPickupClock(beforeCutoff);
    setSessionPickupDate(today);
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const execute = vi.fn(async () => {
      started();
      await barrier;
      return { paymentId: 'payment-submitted-before-cutoff', status: 'COMPLETED' };
    });
    const first = runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'original-token' }, { execute, finalize });
    await entered;
    vi.setSystemTime(new Date(afterCutoff));
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'original-token' }, { execute, finalize }))
      .toMatchObject({ status: 'processing', canStartNewSession: false });
    expect(execute).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toMatchObject({ success: true, code: 'PAYMENT_COMPLETED' });
  });

  it('finalizes an accepted payment after 13:30 without charging again', async () => {
    setPickupClock(beforeCutoff);
    setSessionPickupDate(today);
    const execute = vi.fn(async () => ({ paymentId: 'payment-accepted-before-cutoff', status: 'COMPLETED' }));
    finalize.mockRejectedValueOnce(new Error('D1 order transaction failed'));
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'original-token' }, { execute, finalize }))
      .toMatchObject({ code: 'ORDER_FINALIZING', canStartNewSession: false });
    expect(attempt()).toMatchObject({ state: 'completed', request_json: null });
    vi.setSystemTime(new Date(afterCutoff));
    expect(await getPaymentAttemptStatus(fixture.db, 'test-session', { execute, finalize }))
      .toMatchObject({ success: true, code: 'PAYMENT_COMPLETED', canStartNewSession: false });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(2);
  });
});

describe('next-day product rules before a first charge', () => {
  it.each([
    ['sweet-bobbatlu', 0, false, 48],
    ['sweet-bobbatlu', 100, false, 48],
    ['sweet-kova', 100, false, 32],
    ['sweet-bobbatlu', 100, true, 88],
    ['sweet-kova-bobbatlu', 0, false, 48],
    ['sweet-kova-bobbatlu', 100, false, 48],
    ['sweet-kova-bobbatlu', 100, true, 88],
    ['sweet-kova', 100, true, 72],
  ] as const)('rejects same-day %s with stock %i and mixed cart %s', async (productId, stock, mixed, total) => {
    setPickupClock('2026-07-15T18:29:59.999Z');
    setSessionPickupDate('2026-07-15');
    fixture.sqlite.prepare('UPDATE payment_sessions SET cart_data = ?, total_amount = ?')
      .run(JSON.stringify([
        { productId, quantity: 1, selectedTier: 16, product: { id: 'sweet-malpuri', category: 'pickles' } },
        ...(mixed ? [{ productId: 'sweet-malpuri', quantity: 1, selectedTier: 16 }] : []),
      ]), total);
    fixture.sqlite.prepare('INSERT OR REPLACE INTO inventory (product_id, stock_count) VALUES (?, ?)')
      .run(productId, stock);
    const execute = vi.fn();
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'never-send-token' }, { execute, finalize }))
      .toMatchObject({ code: 'SESSION_EXPIRED', canStartNewSession: true });
    expect(execute).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(attempt()).toBeUndefined();
  });

  it.each([
    ['sweet-bobbatlu', 48],
    ['sweet-kova-bobbatlu', 48],
    ['sweet-kova', 32],
  ] as const)('accepts next-day %s without a pickup inventory lookup', async (productId, total) => {
    setPickupClock('2026-07-15T18:29:59.999Z');
    setSessionPickupDate('2026-07-16');
    fixture.sqlite.prepare('UPDATE payment_sessions SET cart_data = ?, total_amount = ?')
      .run(JSON.stringify([{ productId, quantity: 1, selectedTier: 16 }]), total);
    const prepare = vi.spyOn(fixture.db, 'prepare');
    const execute = vi.fn(async () => ({ paymentId: 'payment-next-day', status: 'COMPLETED' }));
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'valid-token' }, { execute, finalize }))
      .toMatchObject({ success: true, code: 'PAYMENT_COMPLETED' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls.some(([sql]) => /\bFROM inventory\b/i.test(sql))).toBe(false);
  });

  it.each([
    ['sweet-bobbatlu', 54.99],
    ['sweet-kova-bobbatlu', 54.99],
    ['sweet-kova', 38.99],
  ] as const)('keeps delivery %s chargeable after the pickup cutoff', async (productId, total) => {
    setPickupClock('2026-07-15T19:00:00Z');
    fixture.sqlite.prepare('UPDATE payment_sessions SET cart_data = ?, fulfillment_data = ?, shipping = 6.99, total_amount = ?')
      .run(JSON.stringify([{ productId, quantity: 1, selectedTier: 16 }]),
        JSON.stringify({ type: 'delivery', state: 'TX', date: '2026-07-15' }), total);
    const execute = vi.fn(async () => ({ paymentId: 'payment-delivery', status: 'COMPLETED' }));
    expect(await runPaymentAttempt(fixture.db,
      { sessionId: 'test-session', sourceId: 'valid-token' }, { execute, finalize }))
      .toMatchObject({ success: true, code: 'PAYMENT_COMPLETED' });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

it.each([[1,6.99,2.14,28.13],[2,5.99,3.63,47.62],[3,4.99,5.11,67.10]])(
  'accepts the new %s-jar shipping quote before charging', async (quantity,shipping,tax,total) => {
    fixture.sqlite.prepare('UPDATE payment_sessions SET cart_data=?,fulfillment_data=?,shipping=?,tax=?,total_amount=?')
      .run(JSON.stringify([{productId:'pickle-gongura-chicken',quantity,lineTotal:19*quantity}]),
        JSON.stringify({type:'delivery',state:'TX'}),shipping,tax,total);
    const execute=vi.fn<(request: SquarePaymentRequest)=>Promise<{paymentId:string;status:string}>>(
      async ()=>({paymentId:'payment-new-shipping',status:'COMPLETED'}));
    expect(await runPaymentAttempt(fixture.db,{sessionId:'test-session',sourceId:'test-token'},{execute,finalize}))
      .toMatchObject({status:'completed'});
    expect(execute.mock.calls[0][0].body.amount_money.amount).toBe(Math.round(total*100));
  });

it('expires an unattempted old pickle shipping quote without sending a charge',async()=>{
  fixture.sqlite.prepare('UPDATE payment_sessions SET cart_data=?,fulfillment_data=?,shipping=6,tax=2.06,total_amount=27.06')
    .run(JSON.stringify([{productId:'pickle-gongura-chicken',quantity:1,lineTotal:19}]),JSON.stringify({type:'delivery',state:'TX'}));
  const execute=vi.fn();
  expect(await runPaymentAttempt(fixture.db,{sessionId:'test-session',sourceId:'unused-token'},{execute,finalize}))
    .toMatchObject({code:'SESSION_EXPIRED'});
  expect(execute).not.toHaveBeenCalled();
});

it.each([
  ['NY', 1, 6.99, 1.57, 27.56],
  ['NY', 2, 5.99, 3.14, 47.13],
  ['NY', 3, 4.99, 4.70, 66.69],
  ['OK', 3, 4.99, 4.70, 66.69],
] as const)('permits a %s first charge for %s pickle jars below $80', async (state, quantity, shipping, tax, total) => {
  fixture.sqlite.prepare('UPDATE payment_sessions SET cart_data=?,fulfillment_data=?,shipping=?,tax=?,total_amount=?')
    .run(JSON.stringify([{ productId: 'pickle-gongura-chicken', quantity, lineTotal: 19 * quantity }]),
      JSON.stringify({ type: 'delivery', state }), shipping, tax, total);
  const execute = vi.fn<(request: SquarePaymentRequest) => Promise<{ paymentId: string; status: string }>>(
    async () => ({ paymentId: 'payment-national-pickle-shipping', status: 'COMPLETED' }));
  expect(await runPaymentAttempt(fixture.db,
    { sessionId: 'test-session', sourceId: 'test-token' }, { execute, finalize }))
    .toMatchObject({ status: 'completed' });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0][0].body.amount_money.amount).toBe(Math.round(total * 100));
});

it('retains the far-state minimum before charging a mixed pickle and sweets order', async () => {
  fixture.sqlite.prepare('UPDATE payment_sessions SET cart_data=?,fulfillment_data=?,shipping=11.99,tax=1.57,total_amount=72.56')
    .run(JSON.stringify([
      { productId: 'pickle-gongura-chicken', quantity: 1, lineTotal: 19 },
      { productId: 'sweet-malpuri', quantity: 1, selectedTier: 16, lineTotal: 40 },
    ]), JSON.stringify({ type: 'delivery', state: 'NY' }));
  const execute = vi.fn();
  expect(await runPaymentAttempt(fixture.db,
    { sessionId: 'test-session', sourceId: 'unused-token' }, { execute, finalize }))
    .toMatchObject({ code: 'SESSION_EXPIRED', canStartNewSession: true });
  expect(execute).not.toHaveBeenCalled();
  expect(finalize).not.toHaveBeenCalled();
  expect(attempt()).toBeUndefined();
});
