// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyPaymentOutcome, forgetPendingPayment, PENDING_PAYMENT_KEY,
  readPendingPayment, rememberPendingPayment, sendPaymentRequest,
} from './payment-recovery';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';

describe('durable browser payment reference', () => {
  beforeEach(() => localStorage.clear());
  it('survives a reload without storing payment credentials', () => {
    rememberPendingPayment(localStorage, first);
    expect(readPendingPayment(localStorage)?.sessionId).toBe(first);
    expect(Object.keys(JSON.parse(localStorage.getItem(PENDING_PAYMENT_KEY)!)).sort()).toEqual(['sessionId', 'startedAt']);
  });
  it('never expires an unresolved attempt based on browser time', () => {
    localStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify({ sessionId: first, startedAt: 1 }));
    expect(readPendingPayment(localStorage)?.sessionId).toBe(first);
  });
  it('blocks a new session while an earlier payment is unresolved', () => {
    rememberPendingPayment(localStorage, first);
    expect(() => rememberPendingPayment(localStorage, second)).toThrow('earlier payment');
    expect(readPendingPayment(localStorage)?.sessionId).toBe(first);
  });
  it('allows same-session retries without replacing their reference', () => {
    const saved = rememberPendingPayment(localStorage, first);
    expect(rememberPendingPayment(localStorage, first)).toEqual(saved);
  });
  it('a late response cannot clear a different payment', () => {
    rememberPendingPayment(localStorage, second);
    forgetPendingPayment(localStorage, first);
    expect(readPendingPayment(localStorage)?.sessionId).toBe(second);
  });
  it('clears only the confirmed matching reference', () => {
    rememberPendingPayment(localStorage, first);
    forgetPendingPayment(localStorage, first);
    expect(readPendingPayment(localStorage)).toBeNull();
  });
  it.each(['{bad json', '{}', '{"sessionId":"not-a-uuid","startedAt":1}'])('fails closed for corrupt saved state: %s', raw => {
    localStorage.setItem(PENDING_PAYMENT_KEY, raw);
    expect(() => readPendingPayment(localStorage)).toThrow();
  });
});

describe('payment outcome contract', () => {
  it('accepts a fully confirmed order', () => {
    expect(classifyPaymentOutcome(200, { success: true, status: 'completed', orderNumber: 'AJ-1234' }))
      .toEqual({ kind: 'completed', orderNumber: 'AJ-1234' });
  });
  it('permits a new attempt only after an explicit confirmed decline', () => {
    expect(classifyPaymentOutcome(402, { status: 'declined', code: 'PAYMENT_DECLINED', canStartNewSession: true }).kind).toBe('released');
  });
  it('permits a new attempt after explicitly safe session expiry', () => {
    expect(classifyPaymentOutcome(409, { status: 'expired', code: 'SESSION_EXPIRED', canStartNewSession: true }).kind).toBe('released');
  });
  it.each([
    [500, { error: 'Connection lost' }],
    [409, { error: 'Session invalid' }],
    [402, { error: 'Payment failed' }],
    [402, { status: 'declined', code: 'PAYMENT_DECLINED' }],
    [200, { success: true, status: 'completed' }],
    [200, { success: true, orderNumber: 'AJ-1234' }],
    [202, { status: 'unknown', canStartNewSession: true }],
    [429, { error: 'Too many requests' }],
    [503, null],
    [200, 'invalid'],
  ])('retains original attempt for ambiguous response %s %j', (status, body) => {
    expect(classifyPaymentOutcome(status as number, body).kind).toBe('pending');
  });
});

describe('resending a Pay request the browser dropped', () => {
  const body = { sessionId: first, sourceId: 'cnon:token-1' };
  const dropped = () => new TypeError('Load failed');
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(...results: Array<Response | Error | DOMException>) {
    const fetchMock = vi.fn(async () => {
      const next = results.shift()!;
      if (!(next instanceof Response)) throw next;
      return next;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  const sentBodies = (fetchMock: ReturnType<typeof stubFetch>) =>
    fetchMock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));

  it('resends the identical request after a dropped connection and returns the answer', async () => {
    const fetchMock = stubFetch(dropped(), Response.json({ success: true, status: 'completed', orderNumber: 'AJ-1' }));
    const resends: number[] = [];
    const result = await sendPaymentRequest(body, (n) => resends.push(n), [0, 0]);
    expect(result).toMatchObject({ status: 200, body: { orderNumber: 'AJ-1' } });
    expect(sentBodies(fetchMock)).toEqual([body, body]);
    expect(resends).toEqual([1]);
  });

  it('gives up after two resends so the buyer sees the status screen', async () => {
    const fetchMock = stubFetch(dropped(), dropped(), dropped());
    await expect(sendPaymentRequest(body, () => {}, [0, 0])).rejects.toThrow('Load failed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never resends a timed-out request, which may still be running', async () => {
    const fetchMock = stubFetch(new DOMException('The operation was aborted.', 'AbortError'));
    await expect(sendPaymentRequest(body, () => {}, [0, 0])).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([202, 402, 409, 429, 500, 503])('never resends after the server answered %i', async (status) => {
    const fetchMock = stubFetch(Response.json({ error: 'answer' }, { status }));
    expect((await sendPaymentRequest(body, () => {}, [0, 0])).status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('waits between resends', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = stubFetch(dropped(), dropped(), Response.json({ ok: true }));
      const pending = sendPaymentRequest(body);
      await vi.advanceTimersByTimeAsync(799);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((await pending).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
