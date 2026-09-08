// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProductById } from '@/data/products';
import { useCartStore } from '@/store/cart';
import { PENDING_PAYMENT_KEY, readPendingPayment, rememberPendingPayment } from '@/lib/payment-recovery';
import CheckoutPage from './page';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) =>
    createElement('a', props, children),
}));

const firstSession = '11111111-1111-4111-8111-111111111111';
const nextSession = '22222222-2222-4222-8222-222222222222';
let root: Root | null;
let host: HTMLDivElement;
let paymentResult: () => Promise<Response>;
let verifyResult: () => Promise<Response>;
let createdSessions: number;
const tokenize = vi.fn();
const destroy = vi.fn(async () => undefined);
const completed = () => Response.json({ success: true, status: 'completed', orderNumber: 'AJ-1234' });
const pending = () => Response.json({
  status: 'unknown', code: 'PAYMENT_PENDING', canStartNewSession: false,
}, { status: 202 });
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
  const url = String(input);
  if (url === '/api/payments/create-session') {
    createdSessions += 1;
    return Response.json({
      sessionId: createdSessions === 1 ? firstSession : nextSession,
      subtotal: 40, tax: 0, shipping: 0, totalAmount: 40,
      squareEnabled: true, squareAppId: 'test-app', squareLocationId: 'test-location',
      squareEnvironment: 'sandbox',
    }, { status: 201 });
  }
  if (url === '/api/payments/create-payment') return paymentResult();
  if (url === '/api/payments/verify') return verifyResult();
  if (url === '/api/checkout-log') return Response.json({ success: true });
  throw new Error(`Unexpected test request: ${url}`);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function calls(path: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input) === path);
}

function button(text: string) {
  const found = Array.from(host.querySelectorAll('button')).find((item) => item.textContent?.trim() === text);
  if (!found) throw new Error(`Button not found: ${text}. Visible text: ${host.textContent}`);
  return found;
}

async function click(text: string) {
  await act(async () => button(text).click());
}

async function input(selector: string, value: string) {
  const field = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  if (!field) throw new Error(`Input not found: ${selector}`);
  const prototype = field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}

async function render() {
  root = createRoot(host);
  await act(async () => root!.render(createElement(CheckoutPage)));
}

async function unmount() {
  if (root) {
    await act(async () => root!.unmount());
    root = null;
  }
}

async function pickupDetails(quantity = 1) {
  useCartStore.getState().addItem(getProductById('sweet-malpuri')!, quantity, 16);
  await render();
  await click('Continue');
  const pickup = Array.from(host.querySelectorAll('button')).find((item) => item.querySelector('h3')?.textContent === 'Pickup');
  await act(async () => pickup!.click());
  await input('select', 'plano-biryanify');
  await input('input[autocomplete="name"]', 'Checkout Test');
  await input('input[type="tel"]', '2145550100');
  await input('input[type="email"]', 'checkout@example.com');
}

async function readyToPay() {
  await pickupDetails();
  await input('input[type="date"]', '2026-09-09');
  expect(button('Continue to payment').disabled).toBe(false);
  await click('Continue to payment');
  expect(button('Pay $40.00').disabled).toBe(false);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-08T18:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  useCartStore.getState().clearCart();
  createdSessions = 0;
  fetchMock.mockClear();
  tokenize.mockReset().mockResolvedValue({ status: 'OK', token: 'TEST_CARD_TOKEN' });
  destroy.mockClear();
  paymentResult = async () => pending();
  verifyResult = async () => pending();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Square', {
    payments: () => ({
      card: async () => ({ attach: async () => undefined, destroy, tokenize }),
      paymentRequest: () => ({}),
      applePay: async () => { throw new Error('Apple Pay unavailable in this test'); },
    }),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = null;
});

afterEach(async () => {
  await unmount();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('checkout pickup date controls', () => {
  it.each(['Pickup', 'Delivery'])('hides Step 1 banners and Step 3 pickup notice for %s', async (method) => {
    useCartStore.getState().addItem(getProductById('sweet-malpuri')!, 1, 16);
    await render();
    expect(host.textContent).toContain('Cart overview');
    expect(host.textContent).not.toContain('pick up orders before 4:30 PM');
    expect(host.textContent).not.toContain('Fast nationwide shipping:');
    expect(host.textContent).toContain('$40.00');
    await click('Continue');
    expect(host.textContent).toContain('pick up orders before 4:30 PM');
    const choice = Array.from(host.querySelectorAll('button')).find(item => item.querySelector('h3')?.textContent === method);
    await act(async () => choice!.click());
    expect(host.textContent).toContain('Step 3');
    expect(host.textContent).not.toContain('pick up orders before 4:30 PM');
    if (method === 'Delivery') expect(host.textContent).toContain('Shipping times begin after your order is prepared.');
  });

  it.each(['2026-09-07', '122026-01-09', '2026-12-08'])('blocks %s with a visible error before any payment session', async (date) => {
    await pickupDetails();
    await input('#pickup-date', date);
    expect(host.querySelector('#pickup-date')?.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('#pickup-date-error')?.textContent).toBeTruthy();
    expect(button('Continue to payment').disabled).toBe(true);
    await click('Continue to payment');
    expect(calls('/api/payments/create-session')).toHaveLength(0);
    expect(tokenize).not.toHaveBeenCalled();
  });

  it('allows the 90th day and sends that exact date; clearing it disables checkout', async () => {
    await pickupDetails();
    const field = host.querySelector<HTMLInputElement>('#pickup-date')!;
    expect(field.min).toBe('2026-09-08');
    expect(field.max).toBe('2026-12-07');
    expect(host.textContent).not.toContain('Schedule pickup up to');
    expect(host.querySelector('#pickup-date-help')).toBeNull();
    expect(button('Continue to payment').disabled).toBe(true);
    await input('#pickup-date', '2026-12-07');
    expect(button('Continue to payment').disabled).toBe(false);
    await input('#pickup-date', '');
    expect(button('Continue to payment').disabled).toBe(true);
    await input('#pickup-date', '2026-12-07');
    await click('Continue to payment');
    expect(JSON.parse(calls('/api/payments/create-session')[0][1]!.body as string).fulfillment.date).toBe('2026-12-07');
  });

  it('blocks same-day large orders and permits tomorrow', async () => {
    await pickupDetails(10);
    await input('#pickup-date', '2026-09-08');
    expect(button('Continue to payment').disabled).toBe(true);
    expect(host.querySelector('#pickup-date-error')?.textContent).toContain('1 day notice');
    await input('#pickup-date', '2026-09-09');
    expect(button('Continue to payment').disabled).toBe(false);
  });

  it('refreshes boundaries when returning after Dallas midnight', async () => {
    await pickupDetails();
    await input('#pickup-date', '2026-09-08');
    vi.setSystemTime(new Date('2026-09-09T05:00:00Z'));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(host.querySelector<HTMLInputElement>('#pickup-date')!.min).toBe('2026-09-09');
    expect(button('Continue to payment').disabled).toBe(true);
  });

  it('rechecks the current date on submission even before the refresh timer fires', async () => {
    await pickupDetails();
    await input('#pickup-date', '2026-09-08');
    vi.setSystemTime(new Date('2026-09-09T05:00:00Z'));
    await click('Continue to payment');
    expect(calls('/api/payments/create-session')).toHaveLength(0);
    expect(host.querySelector('#pickup-date-error')?.textContent).toContain('past');
  });
});

describe('checkout payment recovery wiring', () => {
  it('serializes two immediate Pay clicks and saves a reference before sending the charge', async () => {
    const response = deferred<Response>();
    paymentResult = () => {
      expect(readPendingPayment(localStorage)?.sessionId).toBe(firstSession);
      return response.promise;
    };
    await readyToPay();
    const pay = button('Pay $40.00');
    await act(async () => { pay.click(); pay.click(); });
    expect(tokenize).toHaveBeenCalledTimes(1);
    expect(calls('/api/payments/create-payment')).toHaveLength(1);
    expect(calls('/api/payments/verify')).toHaveLength(0);
    expect(host.textContent).toContain('Confirming your payment');
    await act(async () => response.resolve(pending()));
    expect(calls('/api/payments/verify')).toHaveLength(1);
    expect(calls('/api/payments/create-session')).toHaveLength(1);
  });

  it.each(['connection lost', 'generic 409', 'bad JSON'])('retains the original attempt after %s', async (failure) => {
    paymentResult = async () => {
      if (failure === 'connection lost') throw new Error('Network connection lost');
      if (failure === 'generic 409') return Response.json({ error: 'Invalid session' }, { status: 409 });
      return new Response('not JSON', { status: 200 });
    };
    await readyToPay();
    await click('Pay $40.00');
    expect(readPendingPayment(localStorage)?.sessionId).toBe(firstSession);
    expect(host.textContent).toContain('Confirming your payment');
    expect(calls('/api/payments/create-session')).toHaveLength(1);
    paymentResult = async () => pending();
    await click('Check / finish this payment');
    expect(calls('/api/payments/create-payment')).toHaveLength(2);
    expect(JSON.parse(calls('/api/payments/create-payment')[1][1]!.body as string))
      .toEqual({ sessionId: firstSession, retry: true });
    expect(calls('/api/payments/create-session')).toHaveLength(1);
  });

  it('restores recovery on reload even when the cart is empty', async () => {
    rememberPendingPayment(localStorage, firstSession);
    await render();
    expect(host.textContent).toContain('Confirming your payment');
    expect(host.textContent).not.toContain('No items to checkout');
    expect(calls('/api/payments/verify')).toHaveLength(1);
    expect(calls('/api/payments/create-session')).toHaveLength(0);
    expect(calls('/api/payments/create-payment')).toHaveLength(0);
  });

  it('clears the cart and reference only after the explicit completed order contract', async () => {
    paymentResult = async () => completed();
    await readyToPay();
    await click('Pay $40.00');
    expect(host.textContent).toContain('AJ-1234');
    expect(readPendingPayment(localStorage)).toBeNull();
    expect(useCartStore.getState().items).toHaveLength(0);
    expect(calls('/api/payments/create-payment')).toHaveLength(1);
  });

  it('requires another customer action to create a fresh session after a confirmed decline', async () => {
    paymentResult = async () => Response.json({
      status: 'declined', code: 'PAYMENT_DECLINED', canStartNewSession: true, error: 'Card declined',
    }, { status: 402 });
    await readyToPay();
    await click('Pay $40.00');
    expect(readPendingPayment(localStorage)).toBeNull();
    expect(host.textContent).toContain('Card declined');
    expect(calls('/api/payments/create-session')).toHaveLength(1);
    expect(calls('/api/payments/create-payment')).toHaveLength(1);
    await click('Continue to payment');
    expect(calls('/api/payments/create-session')).toHaveLength(2);
    expect(calls('/api/payments/create-payment')).toHaveLength(1);
  });

  it('keeps the recovery reference when a payment completes after navigating away', async () => {
    const response = deferred<Response>();
    paymentResult = () => response.promise;
    await readyToPay();
    await click('Pay $40.00');
    await unmount();
    await act(async () => response.resolve(completed()));
    expect(readPendingPayment(localStorage)?.sessionId).toBe(firstSession);
    expect(useCartStore.getState().items).toHaveLength(1);
    verifyResult = async () => completed();
    await render();
    expect(host.textContent).toContain('AJ-1234');
    expect(readPendingPayment(localStorage)).toBeNull();
    expect(calls('/api/payments/create-payment')).toHaveLength(1);
  });

  it('does not start a charge when tokenization resolves after checkout unmounts', async () => {
    const token = deferred<{ status: string; token: string }>();
    tokenize.mockReturnValue(token.promise);
    await readyToPay();
    await click('Pay $40.00');
    await unmount();
    await act(async () => token.resolve({ status: 'OK', token: 'LATE_TOKEN' }));
    expect(calls('/api/payments/create-payment')).toHaveLength(0);
    expect(readPendingPayment(localStorage)).toBeNull();
    expect(useCartStore.getState().items).toHaveLength(1);
  });

  it('stops before charging when the recovery reference cannot be saved', async () => {
    await readyToPay();
    const save = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === PENDING_PAYMENT_KEY) throw new Error('Storage unavailable');
      save.call(this, key, value);
    });
    await click('Pay $40.00');
    expect(calls('/api/payments/create-payment')).toHaveLength(0);
    expect(host.textContent).toContain('No new charge was submitted');
  });

  it('fails closed for unreadable saved recovery state without initializing checkout', async () => {
    localStorage.setItem(PENDING_PAYMENT_KEY, '{bad JSON');
    await render();
    expect(host.textContent).toContain('Payment safety check');
    expect(calls('/api/payments/create-session')).toHaveLength(0);
    expect(calls('/api/payments/create-payment')).toHaveLength(0);
  });
});
