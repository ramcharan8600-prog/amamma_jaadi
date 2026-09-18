import { afterEach, describe, expect, it, vi } from 'vitest';

const { enqueueEmail } = vi.hoisted(() => ({
  enqueueEmail: vi.fn(async () => ({ success: true, id: 'outbox-id', queued: true })),
}));

vi.mock('@/lib/email-outbox', () => ({
  enqueueEmail,
  isEmailOutboxConfigured: () => true,
}));

import {
  buildOrderConfirmationEmail,
  buildOwnerOrderAlertEmail,
  sendOrderConfirmation,
  type OrderConfirmationParams,
} from '@/lib/email-service';

describe('order confirmation recipients', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    enqueueEmail.mockClear();
  });

  it.each(['pickup', 'delivery'] as const)('includes exactly both approved BCC inboxes for %s orders', async (fulfillmentType) => {
    vi.stubEnv(
      'ORDER_CONFIRMATION_BCC_EMAIL',
      'ramcharan8600@gmail.com, amamma.jaadi@gmail.com, smallogi5@gmail.com'
    );

    await sendOrderConfirmation({
      email: 'customer@example.com',
      orderNumber: 'AJ-TEST',
      squarePaymentId: 'square-test',
      customerName: 'Test Customer',
      phone: '5555555555',
      total: 30,
      items: [{ name: 'Gift Box', quantity: 1, price: 30 }],
      fulfillmentType,
    });

    expect(enqueueEmail).toHaveBeenCalledOnce();
    expect(enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        bcc: ['amamma.jaadi@gmail.com', 'ramcharan8600@gmail.com'],
        dedupeKey: 'order-confirmation:AJ-TEST',
      })
    );
  });

  it('retains both copies when the old optional BCC setting is empty', async () => {
    vi.stubEnv('ORDER_CONFIRMATION_BCC_EMAIL', '');
    await sendOrderConfirmation({
      email: 'sairamcharan20@gmail.com', orderNumber: 'AJ-TEST-BCC',
      squarePaymentId: 'square-test', customerName: 'Test Customer', phone: '5555555555',
      total: 30, items: [{ name: 'Gift Box', quantity: 1, price: 30 }], fulfillmentType: 'pickup',
    });
    expect(enqueueEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'sairamcharan20@gmail.com',
      bcc: ['amamma.jaadi@gmail.com', 'ramcharan8600@gmail.com'],
    }));
  });
});

describe('pickle-only delivery email shipping wording', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    enqueueEmail.mockClear();
  });

  function renderCustomerAndOwner(overrides: Partial<OrderConfirmationParams> = {}) {
    vi.stubEnv('OWNER_NOTIFICATION_EMAIL', 'owner@example.com');
    const params: OrderConfirmationParams = {
      email: 'customer@example.com',
      orderNumber: 'AJ-EMAIL-SHIPPING',
      squarePaymentId: 'square-test',
      customerName: 'Test Customer',
      phone: '5555555555',
      total: 24.99,
      subtotal: 18,
      tax: 0,
      shipping: 6.99,
      items: [{ name: 'Chicken Pickle', quantity: 1, price: 18 }],
      fulfillmentType: 'delivery',
      shippingMethod: 'standard',
      deliveryAddress: '123 Main St\nDetroit, MI 48201',
      ...overrides,
    };
    const confirmation = buildOrderConfirmationEmail(params);
    const ownerAlert = buildOwnerOrderAlertEmail({ ...params, customerEmail: null });
    expect(ownerAlert).not.toBeNull();
    expect(confirmation.to).toBe('customer@example.com');
    expect(confirmation.bcc).toEqual(['amamma.jaadi@gmail.com', 'ramcharan8600@gmail.com']);
    expect(ownerAlert!.to).toEqual(['owner@example.com']);
    expect(enqueueEmail).not.toHaveBeenCalled();
    return [confirmation.html, ownerAlert!.html];
  }

  it.each(['Chicken Pickle', 'Gongura Chicken Pickle', 'Mutton Pickle', 'Prawns Pickle'])(
    'shows Standard shipping in the method and fee row for %s',
    (name) => {
      for (const html of renderCustomerAndOwner({ items: [{ name, quantity: 1, price: 18 }] })) {
        expect(html.match(/Standard shipping/g)).toHaveLength(2);
        expect(html).not.toContain('UPS 2nd Day Air');
        expect(html).toContain('$6.99');
        expect(html).toContain('$24.99');
      }
    }
  );

  it('recognizes a combined pickle order with historical name casing and whitespace', () => {
    for (const html of renderCustomerAndOwner({
      subtotal: 58,
      shipping: 4.99,
      total: 62.99,
      items: [
        { name: ' chicken pickle ', quantity: 1, price: 18 },
        { name: 'GONGURA CHICKEN PICKLE', quantity: 1, price: 19 },
        { name: 'Prawns Pickle', quantity: 1, price: 21 },
      ],
    })) {
      expect(html.match(/Standard shipping/g)).toHaveLength(2);
      expect(html).not.toContain('UPS 2nd Day Air');
      expect(html).toContain('$4.99');
      expect(html).toContain('$62.99');
    }
  });

  it.each([
    { cart: 'mixed', names: ['Chicken Pickle', 'Bobbatlu'] },
    { cart: 'sweets-only', names: ['Kova Bobbatlu'] },
    { cart: 'empty', names: [] },
    { cart: 'unknown pickle name', names: ['Chicken Pickle Special'] },
    { cart: 'pickle with an unknown item', names: ['Chicken Pickle', 'Legacy Item'] },
  ])('preserves the current service wording for a $cart order', ({ names }) => {
    for (const html of renderCustomerAndOwner({
      items: names.map((name) => ({ name, quantity: 1, price: 18 })),
    })) {
      expect(html.match(/UPS 2nd Day Air/g)).toHaveLength(2);
      expect(html).not.toContain('Standard shipping');
    }
  });

  it('uses Standard shipping when an older pickle order has no recorded method', () => {
    for (const html of renderCustomerAndOwner({ shippingMethod: undefined })) {
      expect(html.match(/Standard shipping/g)).toHaveLength(2);
      expect(html).not.toContain('UPS 2nd Day Air');
    }
  });

  it('uses the trusted paid-cart classification when a complimentary item decorates the email', () => {
    for (const html of renderCustomerAndOwner({
      picklesOnly: true,
      items: [
        { name: 'Chicken Pickle', quantity: 1, price: 18 },
        { name: '2 complimentary Bobbatlu (FREE)', quantity: 1, price: 0 },
      ],
    })) {
      expect(html.match(/Standard shipping/g)).toHaveLength(2);
      expect(html).toContain('2 complimentary Bobbatlu (FREE)');
      expect(html).not.toContain('UPS 2nd Day Air');
    }
  });

  it('respects an explicit non-pickle-only classification instead of inferring from names', () => {
    for (const html of renderCustomerAndOwner({ picklesOnly: false })) {
      expect(html.match(/UPS 2nd Day Air/g)).toHaveLength(2);
      expect(html).not.toContain('Standard shipping');
    }
  });

  it.each([
    { method: 'ground', label: 'Ground — estimated 2–5 business days in transit' },
    { method: 'expedited', label: 'Expedited — estimated 2 business days in transit' },
  ] as const)('preserves an explicitly recorded $method method', ({ method, label }) => {
    for (const html of renderCustomerAndOwner({ shippingMethod: method })) {
      expect(html.split(label)).toHaveLength(3);
      expect(html).not.toContain('Standard shipping');
    }
  });

  it('keeps pickup emails free of shipping methods and delivery fees', () => {
    for (const html of renderCustomerAndOwner({
      fulfillmentType: 'pickup',
      shipping: 0,
      total: 18,
      pickupDate: '2026-09-20',
      pickupLocation: 'Plano pickup point',
    })) {
      expect(html).toContain('Plano pickup point');
      expect(html).not.toContain('Standard shipping');
      expect(html).not.toContain('UPS 2nd Day Air');
      expect(html).not.toContain('$6.99');
    }
  });
});
