// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyPaymentOutcome, forgetPendingPayment, PENDING_PAYMENT_KEY,
  readPendingPayment, rememberPendingPayment,
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
