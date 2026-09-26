// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProductById } from '@/data/products';
import { useCartStore } from '@/store/cart';
import { PENDING_PAYMENT_KEY, readPendingPayment, rememberPendingPayment } from '@/lib/payment-recovery';
import CheckoutPage from './page';
import { invalidateStock } from '@/hooks/useStock';

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
let couponResult: () => Promise<Response>;
let bobbatluStock = 0;
let kovaBobbatluStock = 0;
const tokenize = vi.fn();
const destroy = vi.fn(async () => undefined);
const completed = () => Response.json({ success: true, status: 'completed', orderNumber: 'AJ-1234' });
const pending = () => Response.json({
  status: 'unknown', code: 'PAYMENT_PENDING', canStartNewSession: false,
}, { status: 202 });
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
  const url = String(input);
  if (url === '/api/inventory') return Response.json({ stock: {
    'sweet-bobbatlu': bobbatluStock,
    'sweet-kova-bobbatlu': kovaBobbatluStock,
  } });
  if (url === '/api/payments/create-session') {
    createdSessions += 1;
    return Response.json({
      sessionId: createdSessions === 1 ? firstSession : nextSession,
      subtotal: 40, tax: 0, shipping: 0, totalAmount: 40,
      shippingMethod: 'standard',
      squareEnabled: true, squareAppId: 'test-app', squareLocationId: 'test-location',
      squareEnvironment: 'sandbox',
    }, { status: 201 });
  }
  if (url === '/api/coupons/validate') return couponResult();
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

/** The pickup calendar keeps its allowed range on its wrapper for tests. */
function dateBounds() {
  const root = host.querySelector('#pickup-date')!.parentElement!;
  return { min: root.getAttribute('data-min'), max: root.getAttribute('data-max') };
}

/** Open the pickup calendar and move forward to the month containing `date`. */
async function showDay(date: string) {
  if (!host.querySelector('[role="dialog"][aria-label="Choose a pickup date"]')) {
    await act(async () => host.querySelector<HTMLButtonElement>('#pickup-date')!.click());
  }
  for (let i = 0; i < 24 && !host.querySelector(`[data-date="${date}"]`); i++) {
    const next = host.querySelector<HTMLButtonElement>('button[aria-label="Next month"]')!;
    if (next.disabled) break;
    await act(async () => next.click());
  }
  return host.querySelector<HTMLButtonElement>(`[data-date="${date}"]`);
}

/** Tap a date in the pickup calendar; fails if the date is greyed out. */
async function pickDate(date: string) {
  const day = await showDay(date);
  if (!day || day.disabled) throw new Error(`Pickup date ${date} is not selectable`);
  await act(async () => day.click());
}

/** Assert a date is greyed out (or outside the calendar) and close the calendar. */
async function expectDateUnavailable(date: string) {
  const day = await showDay(date);
  expect(day === null || day.disabled).toBe(true);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
}

async function readyToPay() {
  await pickupDetails();
  await pickDate('2026-09-09');
  expect(button('Continue to payment').disabled).toBe(false);
  await click('Continue to payment');
  expect(button('Pay $40.00').disabled).toBe(false);
}

beforeEach(() => {
  invalidateStock();
  bobbatluStock = 0;
  kovaBobbatluStock = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-08T17:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  useCartStore.getState().clearCart();
  createdSessions = 0;
  couponResult = async () => Response.json({ code: 'SHIP', type: 'free_delivery', minSubtotal: 59 });
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
  it.each(['Pickup', 'Delivery'])('hides the cutoff banner on cart, method, and details steps (%s)', async (method) => {
    useCartStore.getState().addItem(getProductById('sweet-malpuri')!, 1, 16);
    await render();
    expect(host.textContent).toContain('Cart overview');
    expect(host.textContent).not.toContain('After 1:30 PM, pickup starts tomorrow');
    expect(host.textContent).not.toContain('Fast nationwide shipping:');
    expect(host.textContent).toContain('$40.00');
    await click('Continue');
    expect(host.textContent).not.toContain('After 1:30 PM, pickup starts tomorrow');
    const choice = Array.from(host.querySelectorAll('button')).find(item => item.querySelector('h3')?.textContent === method);
    await act(async () => choice!.click());
    expect(host.textContent).toContain('Step 3');
    expect(host.textContent).not.toContain('After 1:30 PM, pickup starts tomorrow');
    expect(host.textContent).not.toContain('Orders containing Bobbatlu or Kova are available for pickup from tomorrow.');
    if (method === 'Delivery') expect(host.textContent).toContain('Shipping times begin after your order is prepared.');
  });

  it.each(['2026-09-07', '2026-12-08'])('greys out %s so it cannot be picked or submitted', async (date) => {
    await pickupDetails();
    await expectDateUnavailable(date);
    expect(host.querySelector('#pickup-date')?.textContent).toContain('Choose a pickup date');
    expect(button('Continue to payment').disabled).toBe(true);
    await click('Continue to payment');
    expect(calls('/api/payments/create-session')).toHaveLength(0);
    expect(tokenize).not.toHaveBeenCalled();
  });

  it('marks today, greys out past days and highlights the chosen date', async () => {
    await pickupDetails();
    const today = await showDay('2026-09-08');
    expect(today?.disabled).toBe(false);
    expect(today?.getAttribute('aria-label')).toContain('today');
    const yesterday = host.querySelector<HTMLButtonElement>('[data-date="2026-09-07"]')!;
    expect(yesterday.disabled).toBe(true);
    expect(yesterday.className).toContain('line-through');
    expect(yesterday.getAttribute('aria-label')).toContain('not available');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-date="2026-09-10"]')!.click());
    expect(host.querySelector('#pickup-date')?.textContent).toContain('Thu, Sep 10, 2026');
    expect((await showDay('2026-09-10'))?.getAttribute('aria-pressed')).toBe('true');
  });

  it('allows the 90th day and sends that exact date; no date keeps checkout disabled', async () => {
    await pickupDetails();
    expect(dateBounds()).toEqual({ min: '2026-09-08', max: '2026-12-07' });
    expect(host.textContent).not.toContain('Schedule pickup up to');
    expect(host.querySelector('#pickup-date-help')).toBeNull();
    expect(button('Continue to payment').disabled).toBe(true);
    await pickDate('2026-12-07');
    expect(button('Continue to payment').disabled).toBe(false);
    await click('Continue to payment');
    expect(JSON.parse(calls('/api/payments/create-session')[0][1]!.body as string).fulfillment.date).toBe('2026-12-07');
  });

  it('blocks same-day large orders and permits tomorrow', async () => {
    await pickupDetails(10);
    expect(dateBounds().min).toBe('2026-09-09');
    await expectDateUnavailable('2026-09-08');
    expect(button('Continue to payment').disabled).toBe(true);
    await pickDate('2026-09-09');
    expect(button('Continue to payment').disabled).toBe(false);
  });

  it('refreshes boundaries when returning after Dallas midnight', async () => {
    await pickupDetails();
    await pickDate('2026-09-08');
    vi.setSystemTime(new Date('2026-09-09T05:00:00Z'));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(dateBounds().min).toBe('2026-09-09');
    expect(button('Continue to payment').disabled).toBe(true);
  });

  it('rechecks the current date on submission even before the refresh timer fires', async () => {
    await pickupDetails();
    await pickDate('2026-09-08');
    vi.setSystemTime(new Date('2026-09-09T05:00:00Z'));
    await click('Continue to payment');
    expect(calls('/api/payments/create-session')).toHaveLength(0);
    expect(host.querySelector('#pickup-date-error')?.textContent).toContain('past');
  });
});

describe('checkout phone length', () => {
  it('blocks invalid pickup numbers with a visible US phone message', async () => {
    await pickupDetails();
    await pickDate('2026-09-09');
    for (const phone of ['1214555010', '1234567890', '24695550123', '1234567890123456']) {
      await input('#pickup-phone', phone);
      expect(host.querySelector<HTMLInputElement>('#pickup-phone')?.value).toBe(phone);
      expect(host.querySelector('#pickup-phone')?.getAttribute('aria-invalid')).toBe('true');
      expect(host.querySelector('#pickup-phone-error')?.textContent).toBe('Enter a 10-digit US phone number');
      expect(button('Continue to payment').disabled).toBe(true);
      await click('Continue to payment');
      expect(calls('/api/payments/create-session')).toHaveLength(0);
    }
  });

  it('waits until the customer leaves the field before flagging a short number', async () => {
    await pickupDetails();
    await input('#pickup-phone', '214555');
    expect(host.querySelector('#pickup-phone-error')).toBeNull();
    await act(async () => { host.querySelector('#pickup-phone')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(host.querySelector('#pickup-phone-error')?.textContent).toBe('Enter a 10-digit US phone number');
  });

  it.each([
    ['(214) 555-0100', '2145550100'],
    ['+1 (214) 555-0100', '12145550100'],
    ['12145550100', '12145550100'],
  ])('accepts autofilled pickup phone %s and sends 10 digits', async (typed, shown) => {
    await pickupDetails();
    await pickDate('2026-09-09');
    await input('#pickup-phone', typed);
    expect(host.querySelector<HTMLInputElement>('#pickup-phone')?.value).toBe(shown);
    expect(host.querySelector('#pickup-phone')?.getAttribute('aria-invalid')).toBe('false');
    expect(host.querySelector('#pickup-phone-error')).toBeNull();
    expect(button('Continue to payment').disabled).toBe(false);
    await click('Continue to payment');
    const body = JSON.parse(String(calls('/api/payments/create-session')[0][1]?.body));
    expect(body.phone).toBe('2145550100');
    expect(body.fulfillment.phone).toBe('2145550100');
  });

  it('gives Square the phone in +1 E.164 format for card verification', async () => {
    await pickupDetails();
    await pickDate('2026-09-09');
    await input('#pickup-phone', '+1 (214) 555-0100');
    await click('Continue to payment');
    await click('Pay $40.00');
    expect(tokenize).toHaveBeenCalledWith(expect.objectContaining({
      billingContact: expect.objectContaining({ phone: '+12145550100' }),
    }));
  });
});

describe('pickup cutoff and next-day products', () => {
  it.each(['2026-09-08T18:29:59.999Z', '2026-09-08T18:30:00.000Z'])(
    'allows today through exactly 1:30 PM at %s', async instant => {
      vi.setSystemTime(new Date(instant));
      await pickupDetails();
      expect(dateBounds().min).toBe('2026-09-08');
      await pickDate('2026-09-08');
      expect(button('Continue to payment').disabled).toBe(false);
      await click('Continue to payment');
      expect(JSON.parse(calls('/api/payments/create-session')[0][1]!.body as string).fulfillment.date).toBe('2026-09-08');
      expect(host.textContent).toContain('Place eligible same-day pickup orders on or before 1:30 PM Central. After 1:30 PM, pickup starts tomorrow.');
    }
  );

  it.each(['2026-09-08T18:30:00.001Z', '2026-09-09T04:59:59Z'])(
    'disables today when pickup is selected after the cutoff at %s', async instant => {
      vi.setSystemTime(new Date(instant));
      await pickupDetails();
      expect(dateBounds().min).toBe('2026-09-09');
      await expectDateUnavailable('2026-09-08');
      expect(button('Continue to payment').disabled).toBe(true);
      await pickDate('2026-09-09');
      expect(button('Continue to payment').disabled).toBe(false);
    }
  );

  it('allows exactly 1:30 PM then refreshes an open date picker one millisecond later without a network request', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-09-08T18:29:59Z'));
    await pickupDetails();
    await pickDate('2026-09-08');
    expect(button('Continue to payment').disabled).toBe(false);
    const requests = fetchMock.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(dateBounds().min).toBe('2026-09-08');
    expect(button('Continue to payment').disabled).toBe(false);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(dateBounds().min).toBe('2026-09-09');
    expect(button('Continue to payment').disabled).toBe(true);
    expect(fetchMock.mock.calls).toHaveLength(requests);
  });

  it('rechecks the cutoff at submission even if the browser timer has not fired', async () => {
    vi.setSystemTime(new Date('2026-09-08T18:29:59Z'));
    await pickupDetails();
    await pickDate('2026-09-08');
    vi.setSystemTime(new Date('2026-09-08T18:30:00.001Z'));
    await click('Continue to payment');
    expect(calls('/api/payments/create-session')).toHaveLength(0);
    expect(host.querySelector('#pickup-date-error')?.textContent).toContain('1:30 PM Central');
  });

  it.each(['sweet-bobbatlu', 'sweet-kova', 'sweet-kova-bobbatlu'])(
    'requires tomorrow for a mixed pickup cart containing %s before 1:30 PM', async productId => {
      bobbatluStock = 100;
      kovaBobbatluStock = 100;
      useCartStore.getState().addItem(getProductById(productId)!, 1, 16);
      await pickupDetails();
      expect(host.textContent).toContain(`Your order contains ${getProductById(productId)!.name} (needs 1 day prep time). Please select tomorrow or a later date for pickup.`);
      expect(host.textContent).not.toContain('After 1:30 PM, pickup starts tomorrow');
      expect(dateBounds().min).toBe('2026-09-09');
      await expectDateUnavailable('2026-09-08');
      expect(button('Continue to payment').disabled).toBe(true);
      await pickDate('2026-09-09');
      expect(button('Continue to payment').disabled).toBe(false);
      await click('Continue to payment');
      const submitted = JSON.parse(String(calls('/api/payments/create-session')[0][1]?.body));
      expect(submitted.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ productId, quantity: 1, selectedTier: 16 }),
      ]));
      expect(submitted.fulfillment.date).toBe('2026-09-09');
    }
  );
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


describe('nearby delivery pickup switch', () => {
  async function delivery(zip = '75093', state = 'TX') {
    useCartStore.getState().addItem(getProductById('sweet-bobbatlu')!, state === 'TX' ? 1 : 2, 16);
    await render();
    await click('Continue');
    const choice = Array.from(host.querySelectorAll('button')).find(item => item.querySelector('h3')?.textContent === 'Delivery');
    await act(async () => choice!.click());
    await input('input[autocomplete="name"]', 'Nearby Test');
    await input('input[type="tel"]', '2145550100');
    await input('input[type="email"]', 'nearby@example.com');
    await input('input[placeholder="Street address"]', '123 Test Street');
    const city = Array.from(host.querySelectorAll('input')).find(field => field.parentElement?.querySelector('label')?.textContent === 'City')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(city, 'Test City');
      city.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await input('#delivery-state', state);
    await input('input[autocomplete="postal-code"]', zip);
    expect(button('Continue to payment').disabled).toBe(false);
    expect(host.textContent).toContain('Step 3');
  }

  it('accepts a +1 autofilled delivery phone and still blocks invalid numbers', async () => {
    await delivery();
    for (const phone of ['214555', '1214555010', '1234567890123456']) {
      await input('#delivery-phone', phone);
      expect(host.querySelector<HTMLInputElement>('#delivery-phone')?.value).toBe(phone);
      expect(button('Continue to payment').disabled).toBe(true);
    }
    expect(host.querySelector('#delivery-phone-error')?.textContent).toBe('Enter a 10-digit US phone number');
    expect(calls('/api/payments/create-session')).toHaveLength(0);
    await input('#delivery-phone', '+1 (214) 555-0100');
    expect(host.querySelector<HTMLInputElement>('#delivery-phone')?.value).toBe('12145550100');
    expect(host.querySelector('#delivery-phone-error')).toBeNull();
    expect(button('Continue to payment').disabled).toBe(false);
    await click('Continue to payment');
    expect(JSON.parse(String(calls('/api/payments/create-session')[0][1]?.body)).phone).toBe('2145550100');
  });

  it('preserves contacts/address, permits any pickup point, and creates a new pickup session', async () => {
    await delivery();
    expect(host.textContent).toContain('estimated 1 business day after dispatch');
    expect(host.textContent).not.toContain('After 1:30 PM, pickup starts tomorrow');
    expect(host.textContent).toContain('Plano pickup point is closest');
    expect(host.textContent).toContain('Save $6.99 with free pickup');
    expect(calls('/api/payments/create-session')).toHaveLength(0);
    await click('Continue to payment');
    expect(host.textContent).toContain('Step 4');
    expect(host.textContent).not.toContain('After 1:30 PM, pickup starts tomorrow');
    expect(host.textContent).not.toContain('Pick up for free →');
    await click('Back');
    await click('Pick up for free →');
    expect(host.textContent).toContain('Step 3');
    expect(host.textContent).toContain('Free pickup · Order total: $48.00');
    expect(host.querySelector<HTMLInputElement>('input[autocomplete="name"]')?.value).toBe('Nearby Test');
    expect(host.querySelector<HTMLInputElement>('input[type="tel"]')?.value).toBe('2145550100');
    expect(host.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe('nearby@example.com');
    const options = Array.from(host.querySelectorAll('select option'));
    expect(options).toHaveLength(5);
    expect(options[1].textContent).toContain('Plano');
    expect(options[1].textContent).toContain('Closest to your ZIP');
    await input('select', 'irving-ravibabu');
    await pickDate('2026-09-09');
    await click('Continue to payment');
    const requests = calls('/api/payments/create-session');
    expect(requests).toHaveLength(2);
    expect(JSON.parse(String(requests[1][1]?.body)).fulfillment).toMatchObject({ type: 'pickup', locationId: 'irving-ravibabu', customerName: 'Nearby Test' });
    expect(host.textContent).toContain('After 1:30 PM, pickup starts tomorrow');
    expect(host.textContent).not.toContain('Pick up for free →');
    await click('Back');
    await click('Back');
    const choice = Array.from(host.querySelectorAll('button')).find(item => item.querySelector('h3')?.textContent === 'Delivery');
    await act(async () => choice!.click());
    expect(host.querySelector<HTMLInputElement>('input[placeholder="Street address"]')?.value).toBe('123 Test Street');
    expect(host.querySelector<HTMLInputElement>('input[autocomplete="postal-code"]')?.value).toBe('75093');
  });

  it('shows Texas mixed-order tax separately and removes shipping tax on pickup', async () => {
    useCartStore.getState().addItem(getProductById('pickle-gongura-chicken')!, 1);
    await delivery();
    expect(host.textContent).toContain('Sales Tax (8.25%)');
    expect(host.textContent).toContain('$2.14');
    expect(host.textContent).toContain('$76.13');
    await click('Pick up for free →');
    expect(host.textContent).toContain('Free pickup · Order total: $68.57');
  });

  it.each([['77002', 'TX'], ['90001', 'CA'], ['99999', 'TX']])('does not offer a pickup switch for %s %s', async (zip, state) => {
    await delivery(zip, state);
    expect(host.textContent).not.toContain('Pick up for free →');
    expect(host.textContent).not.toContain('After 1:30 PM, pickup starts tomorrow');
    if (state === 'CA') expect(host.textContent).not.toContain('1 business day');
    await click('Continue to payment');
    expect(host.textContent).toContain('Step 4');
    expect(host.textContent).not.toContain('Pick up for free →');
  });
});


describe.each(['sweet-bobbatlu', 'sweet-kova-bobbatlu'])('%s pickup preparation', productId => {
  it.each([0, 15, 16, 100])('requires next-day pickup even with %s available pieces', async stock => {
    bobbatluStock = stock;
    kovaBobbatluStock = stock;
    useCartStore.getState().addItem(getProductById(productId)!, 1, 16);
    await render();
    await click('Continue');
    const pickup = Array.from(host.querySelectorAll('button')).find(item => item.querySelector('h3')?.textContent === 'Pickup');
    await act(async () => pickup!.click());
    expect(dateBounds().min).toBe('2026-09-09');
    expect(host.textContent).toContain(`Your order contains ${getProductById(productId)!.name} (needs 1 day prep time). Please select tomorrow or a later date for pickup.`);
  });
});

describe('Bobbatlu variant delivery preparation', () => {
  async function openDelivery() {
    await render();
    await click('Continue');
    const delivery = Array.from(host.querySelectorAll('button')).find(item => item.querySelector('h3')?.textContent === 'Delivery');
    await act(async () => delivery!.click());
  }

  it.each([
    [16, 0, false, true],
    [0, 16, true, false],
    [16, 16, false, false],
    [0, 0, true, true],
  ] as const)('keeps variant stock separate with %s Bobbatlu pieces and %s Kova Bobbatlu pieces', async (regularStock, kovaStock, regularPrep, kovaPrep) => {
    bobbatluStock = regularStock;
    kovaBobbatluStock = kovaStock;
    useCartStore.getState().addItem(getProductById('sweet-bobbatlu')!, 1, 16);
    useCartStore.getState().addItem(getProductById('sweet-kova-bobbatlu')!, 1, 16);
    await openDelivery();
    const paragraphs = Array.from(host.querySelectorAll('p')).map(paragraph => paragraph.textContent);
    expect(paragraphs.includes('Bobbatlu for this order needs 1 day for preparation before dispatch.')).toBe(regularPrep);
    expect(paragraphs.includes('Kova Bobbatlu for this order needs 1 day for preparation before dispatch.')).toBe(kovaPrep);
    expect(calls('/api/inventory')).toHaveLength(1);
  });

  it('counts every box and tier against only that variant’s inventory', async () => {
    bobbatluStock = 50;
    kovaBobbatluStock = 49;
    useCartStore.getState().addItem(getProductById('sweet-bobbatlu')!, 2, 25);
    useCartStore.getState().addItem(getProductById('sweet-kova-bobbatlu')!, 1, 50);
    await openDelivery();
    const paragraphs = Array.from(host.querySelectorAll('p')).map(paragraph => paragraph.textContent);
    expect(paragraphs).not.toContain('Bobbatlu for this order needs 1 day for preparation before dispatch.');
    expect(paragraphs).toContain('Kova Bobbatlu for this order needs 1 day for preparation before dispatch.');
  });

  it('does not show preparation for an absent variant', async () => {
    kovaBobbatluStock = 16;
    useCartStore.getState().addItem(getProductById('sweet-kova-bobbatlu')!, 1, 16);
    await openDelivery();
    expect(host.textContent).not.toContain('needs 1 day for preparation before dispatch.');
  });
});

it.each([[1,'6.99','2.14','28.13'],[2,'6.99','3.71','48.70'],[3,'6.99','5.28','69.27']])(
  'displays the correct shipping and tax for %s pickle jars',async(quantity,shipping,tax,total)=>{
    useCartStore.getState().addItem(getProductById('pickle-gongura-chicken')!,Number(quantity));
    await render();await click('Continue');
    const choice=Array.from(host.querySelectorAll('button')).find(item=>item.querySelector('h3')?.textContent==='Delivery');
    await act(async()=>choice!.click());
    await input('#delivery-state','TX');
    await input('input[autocomplete="postal-code"]','75093');
    expect(host.textContent).toContain(`Save $${shipping} with free pickup`);
    expect(host.textContent).toContain(`$${tax}`);
    expect(host.textContent).toContain(`$${total}`);
  });

describe('nationwide pickle-only delivery', () => {
  async function enterDeliveryDetails(state: string) {
    await render();
    await click('Continue');
    const choice = Array.from(host.querySelectorAll('button'))
      .find(item => item.querySelector('h3')?.textContent === 'Delivery');
    await act(async () => choice!.click());
    await input('input[autocomplete="name"]', 'Pickle Shipping Test');
    await input('input[type="tel"]', '2145550100');
    await input('input[type="email"]', 'pickle-shipping@example.com');
    await input('input[placeholder="Street address"]', '123 Test Street');
    const city = Array.from(host.querySelectorAll('input'))
      .find(field => field.parentElement?.querySelector('label')?.textContent === 'City')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(city, 'Test City');
      city.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await input('#delivery-state', state);
    await input('input[autocomplete="postal-code"]', state === 'NY' ? '10001' : '73102');
  }

  it.each([
    ['NY', 1, '6.99', '1.57', '27.56'],
    ['NY', 2, '6.99', '3.14', '48.13'],
    ['NY', 3, '6.99', '4.70', '68.69'],
    ['OK', 3, '6.99', '4.70', '68.69'],
  ] as const)('allows %s delivery of %s jars below $80', async (state, quantity, shipping, tax, total) => {
    useCartStore.getState().addItem(getProductById('pickle-gongura-chicken')!, quantity);
    await enterDeliveryDetails(state);
    expect(host.textContent).not.toContain('A minimum product subtotal');
    expect(host.textContent).toContain('Standard shipping');
    expect(host.textContent).not.toContain('UPS 2nd Day Air');
    expect(host.textContent).not.toContain('within 2 business days');
    expect(host.textContent).toContain(`$${shipping}`);
    expect(host.textContent).toContain(`$${tax}`);
    expect(host.textContent).toContain(`$${total}`);
    expect(button('Continue to payment').disabled).toBe(false);
    await click('Continue to payment');
    expect(host.textContent).toContain('Step 4');
    expect(host.textContent).toContain('Standard shipping');
    expect(host.textContent).not.toContain('UPS 2nd Day Air');
    expect(calls('/api/payments/create-session')).toHaveLength(1);
    expect(JSON.parse(String(calls('/api/payments/create-session')[0][1]?.body))).toMatchObject({
      fulfillment: { type: 'delivery', state },
      items: [{ productId: 'pickle-gongura-chicken', quantity }],
    });
  });

  it('retains the far-state minimum when sweets are included', async () => {
    useCartStore.getState().addItem(getProductById('pickle-gongura-chicken')!, 1);
    useCartStore.getState().addItem(getProductById('sweet-malpuri')!, 1, 16);
    await enterDeliveryDetails('NY');
    expect(host.textContent).toContain('A minimum product subtotal of $80.00');
    expect(host.textContent).toContain('$21.00');
    expect(button('Continue to payment').disabled).toBe(true);
    await click('Continue to payment');
    expect(calls('/api/payments/create-session')).toHaveLength(0);
    expect(tokenize).not.toHaveBeenCalled();
  });

  it('keeps the Texas shipping estimate for pickle-only orders', async () => {
    useCartStore.getState().addItem(getProductById('pickle-chicken')!, 1);
    await enterDeliveryDetails('TX');
    expect(host.textContent).toContain('Shipping (estimated 1 business day after dispatch)');
    await click('Continue to payment');
    expect(host.textContent).toContain('Shipping (estimated 1 business day after dispatch)');
  });

  it.each([false, true])('retains UPS shipping when sweets are included (mixed: %s)', async mixed => {
    useCartStore.getState().addItem(getProductById('sweet-malpuri')!, 2, 16);
    if (mixed) useCartStore.getState().addItem(getProductById('pickle-chicken')!, 1);
    await enterDeliveryDetails('NY');
    expect(host.textContent).toContain('UPS 2nd Day Air');
    expect(host.textContent).not.toContain('Standard shipping');
    expect(host.textContent).toContain('$11.99');
    await click('Continue to payment');
    expect(host.textContent).toContain('Step 4');
    expect(host.textContent).toContain('UPS 2nd Day Air');
    expect(host.textContent).not.toContain('Standard shipping');
  });
});


describe('coupon benefits in checkout', () => {
  async function apply() {
    await render();
    await input('input[placeholder="Enter code"]', 'ship');
    await click('Apply');
  }
  async function delivery() {
    await click('Continue');
    const choice = Array.from(host.querySelectorAll('button')).find(item => item.querySelector('h3')?.textContent === 'Delivery');
    await act(async () => choice!.click());
    await input('#delivery-state', 'TX');
  }
  async function returnToCart() {
    await click('Back');
    await click('Back');
    expect(host.textContent).toContain('Step 1');
  }
  function maintenanceRow() {
    return Array.from(host.querySelectorAll('span')).find(item => item.textContent === 'Maintenance fee')?.parentElement?.textContent;
  }
  it.each([
    { cart: 'sweets', sweets: 2, jars: 0, fee: '$0.99', total: '$80.99' },
    { cart: 'mixed', sweets: 1, jars: 4, fee: '$0.99', total: '$119.01' },
    { cart: 'pickles', sweets: 0, jars: 4, fee: '$1.99', total: '$80.09' },
  ])('itemizes the retained Texas coupon fee when returning to the $cart cart', async ({ sweets, jars, fee, total }) => {
    couponResult = async () => Response.json({ code: 'SHIP70', type: 'free_delivery', minSubtotal: 70, shippingPolicy: 'texas_v3' });
    if (sweets) useCartStore.getState().addItem(getProductById('sweet-malpuri')!, sweets, 16);
    if (jars) useCartStore.getState().addItem(getProductById('pickle-chicken')!, jars);
    await apply();
    expect(maintenanceRow()).toBeUndefined();
    await delivery();
    await returnToCart();
    expect(maintenanceRow()).toBe(`Maintenance fee${fee}`);
    expect(host.textContent).toContain(total);
    expect(host.textContent).toContain('Shipping (estimated 1 business day after dispatch)');
    expect(host.textContent).not.toContain('UPS 2nd Day Air');
    expect(host.querySelector('s')?.textContent).toBe('$6.99');
    expect(host.textContent).toContain('Coupon savings: $6.99');
  });
  it('updates the returned cart fee and shipping as its coupon eligibility changes', async () => {
    couponResult = async () => Response.json({ code: 'SHIP70', type: 'free_delivery', minSubtotal: 70, shippingPolicy: 'texas_v3' });
    useCartStore.getState().addItem(getProductById('sweet-malpuri')!, 1, 16);
    useCartStore.getState().addItem(getProductById('pickle-chicken')!, 4);
    await apply();
    await delivery();
    await returnToCart();
    expect(maintenanceRow()).toBe('Maintenance fee$0.99');
    await act(async () => useCartStore.getState().removeItem('sweet-malpuri', 16));
    expect(maintenanceRow()).toBe('Maintenance fee$1.99');
    await act(async () => useCartStore.getState().updateQuantity('pickle-chicken', 3));
    expect(maintenanceRow()).toBeUndefined();
    expect(host.textContent).toContain('This coupon requires a minimum cart value of $70.00');
    expect(host.textContent).toContain('$6.99');
    expect(host.querySelector('s')).toBeNull();
    await act(async () => useCartStore.getState().updateQuantity('pickle-chicken', 4));
    expect(maintenanceRow()).toBe('Maintenance fee$1.99');
    await click('Remove promo code');
    expect(maintenanceRow()).toBeUndefined();
    expect(host.textContent).toContain('$6.99');
    expect(host.textContent).toContain('$85.51');
    expect(host.querySelector('s')).toBeNull();
  });
  it.each([{ state: 'OK', shipping: '$8.99' }, { state: 'NY', shipping: '$11.99' }])('hides maintenance and itemizes regular shipping after returning from $state delivery', async ({ state, shipping }) => {
    couponResult = async () => Response.json({ code: 'SHIP70', type: 'free_delivery', minSubtotal: 70, shippingPolicy: 'texas_v3' });
    useCartStore.getState().addItem(getProductById('sweet-malpuri')!, 2, 16);
    await apply();
    await delivery();
    await input('#delivery-state', state);
    await returnToCart();
    expect(maintenanceRow()).toBeUndefined();
    expect(host.textContent).toContain(shipping);
    expect(host.querySelector('s')).toBeNull();
  });
  it('hides retained Texas delivery charges after switching to pickup and returning to cart', async () => {
    couponResult = async () => Response.json({ code: 'SHIP70', type: 'free_delivery', minSubtotal: 70, shippingPolicy: 'texas_v3' });
    useCartStore.getState().addItem(getProductById('sweet-malpuri')!, 2, 16);
    await apply();
    await delivery();
    await click('Back');
    const pickup = Array.from(host.querySelectorAll('button')).find(item => item.querySelector('h3')?.textContent === 'Pickup');
    await act(async () => pickup!.click());
    await returnToCart();
    expect(maintenanceRow()).toBeUndefined();
    expect(host.textContent).not.toContain('Standard shipping');
    expect(host.textContent).not.toContain('$6.99');
    expect(host.textContent).not.toContain('$0.99');
    expect(host.textContent).toContain('$80.00');
  });
  it('labels retained shipping as an estimate when returning before choosing a state', async () => {
    useCartStore.getState().addItem(getProductById('sweet-malpuri')!, 2, 16);
    await render();
    expect(host.textContent).not.toContain('Shipping estimate');
    await click('Continue');
    const choice = Array.from(host.querySelectorAll('button')).find(item => item.querySelector('h3')?.textContent === 'Delivery');
    await act(async () => choice!.click());
    await returnToCart();
    expect(host.textContent).toContain('Shipping estimate (select a state to confirm)');
    expect(maintenanceRow()).toBeUndefined();
    expect(host.textContent).toContain('$11.99');
  });
  it('shows the correct maintenance fee only for qualifying Texas delivery', async () => {
    couponResult = async () => Response.json({ code: 'SHIP70', type: 'free_delivery', minSubtotal: 70, shippingPolicy: 'texas_v3' });
    useCartStore.getState().addItem(getProductById('pickle-chicken')!, 4);
    await apply();
    expect(host.textContent).not.toContain('Maintenance fee');
    await delivery();
    expect(host.textContent).toContain('Maintenance fee');
    expect(host.textContent).toContain('$1.99');
    expect(host.textContent).toContain('$80.09');
    expect(host.querySelector('s')?.textContent).toBe('$6.99');
    for (const state of ['OK', 'NY']) {
      await input('#delivery-state', state);
      expect(host.textContent).not.toContain('Maintenance fee');
      expect(host.querySelector('s')).toBeNull();
      expect(host.textContent).toContain('$84.93');
      expect(host.textContent).not.toContain('Coupon savings:');
    }
    await input('#delivery-state', 'TX');
    await act(async () => useCartStore.getState().addItem(getProductById('sweet-malpuri')!, 1, 16));
    expect(host.textContent).toContain('Maintenance fee');
    expect(host.textContent).toContain('$0.99');
    expect(host.textContent).not.toContain('$1.99');
    expect(host.textContent).toContain('Free delivery on this order.');
    await act(async () => useCartStore.getState().removeItem('sweet-malpuri', 16));
    expect(host.textContent).toContain('Maintenance fee');
    await act(async () => useCartStore.getState().updateQuantity('pickle-chicken', 3));
    expect(host.textContent).toContain('This coupon requires a minimum cart value of $70.00');
    expect(host.textContent).not.toContain('Maintenance fee');
    expect(button('Continue to payment').disabled).toBe(true);
    await act(async () => useCartStore.getState().updateQuantity('pickle-chicken', 4));
    await click('Remove promo code');
    expect(host.textContent).not.toContain('Maintenance fee');
    expect(host.querySelector('s')).toBeNull();
  });
  it('waives delivery at the minimum and restores fee and tax when items are removed', async () => {
    useCartStore.getState().addItem(getProductById('sweet-malpuri')!, 1, 16);
    useCartStore.getState().addItem(getProductById('pickle-gongura-chicken')!, 1);
    await apply();
    expect(JSON.parse(String(calls('/api/coupons/validate')[0][1]?.body)).items).toHaveLength(2);
    expect(host.textContent).toContain('Minimum cart value: $59.00');
    await delivery();
    expect(host.textContent).toContain('$60.57');
    expect(host.querySelector('s')?.textContent).toBe('$6.99');
    await act(async () => useCartStore.getState().removeItem('sweet-malpuri', 16));
    expect(host.textContent).toContain('This coupon requires a minimum cart value of $59.00');
    expect(host.textContent).toContain('$6.99');
    expect(host.textContent).toContain('$28.13');
    expect(button('Continue to payment').disabled).toBe(true);
    await click('Remove promo code');
    expect(host.textContent).not.toContain('This coupon requires');
  });
  it('shows the pickle base fee and actual savings, and recalculates when the state changes', async () => {
    couponResult = async () => Response.json({ code: 'SHIP70', type: 'free_delivery', minSubtotal: 70, shippingPolicy: 'regional_v1' });
    useCartStore.getState().addItem(getProductById('pickle-chicken')!, 4);
    await apply();
    await delivery();
    expect(host.querySelector('s')?.textContent).toBe('$6.99');
    expect(host.textContent).toContain('Jar-count savings: $2.00');
    expect(host.textContent).toContain('Coupon savings: $4.99');
    for (const state of ['OK', 'NY']) {
      await input('#delivery-state', state);
      expect(host.querySelector('s')?.textContent).toBe('$6.99');
      expect(host.textContent).toContain('Pickle-only shipping is $3.99');
      expect(host.textContent).toContain('Coupon savings: $1.00');
      expect(host.textContent).toContain('$81.93');
    }
    await click('Remove promo code');
    expect(host.querySelector('s')).toBeNull();
    expect(host.textContent).toContain('$84.93');
  });
  it('shows different regional discounts for a qualifying mixed cart', async () => {
    couponResult = async () => Response.json({ code: 'SHIP70', type: 'free_delivery', minSubtotal: 70, shippingPolicy: 'regional_v1' });
    useCartStore.getState().addItem(getProductById('sweet-malpuri')!, 1, 16);
    useCartStore.getState().addItem(getProductById('pickle-mutton')!, 2);
    await apply();
    await delivery();
    await input('#delivery-state', 'OK');
    expect(host.textContent).toContain('Coupon savings: $4.00');
    expect(host.textContent).toContain('$90.46');
    await input('#delivery-state', 'NY');
    expect(host.textContent).toContain('Coupon savings: $3.00');
    expect(host.textContent).toContain('$94.46');
  });
  it('keeps paid shipping for complimentary pieces and shows the selected quantity', async () => {
    couponResult = async () => Response.json({ code: 'BONUS', type: 'complimentary', bonusItem: 'Malpuri', bonusQty: 3 });
    useCartStore.getState().addItem(getProductById('sweet-malpuri')!, 1, 16);
    await apply();
    expect(host.textContent).toContain('3 complimentary Malpuri pcs');
    await delivery();
    expect(host.textContent).toContain('$46.99');
  });
  it('explains that delivery coupons do not apply to pickup and omits them from the payment request', async () => {
    useCartStore.getState().addItem(getProductById('sweet-malpuri')!, 2, 16);
    await apply();
    await click('Continue');
    const choice = Array.from(host.querySelectorAll('button')).find(item => item.querySelector('h3')?.textContent === 'Pickup');
    await act(async () => choice!.click());
    expect(host.textContent).toContain('Pickup is already free.');
    await input('select', 'plano-biryanify');
    await pickDate('2026-09-09');
    await input('input[autocomplete="name"]', 'Checkout Test');
    await input('input[type="tel"]', '2145550100');
    await input('input[type="email"]', 'checkout@example.com');
    await click('Continue to payment');
    expect(JSON.parse(String(calls('/api/payments/create-session')[0][1]?.body)).couponCode).toBeNull();
  });
  it('shows minimum errors without applying the code', async () => {
    couponResult = async () => Response.json({ error: 'This code requires a minimum cart value of $59.00 before tax and delivery.' }, { status: 400 });
    useCartStore.getState().addItem(getProductById('sweet-malpuri')!, 1, 16);
    await apply();
    expect(host.textContent).toContain('minimum cart value of $59.00');
    expect(host.textContent).not.toContain('Remove promo code');
  });
});
