import { afterEach, describe, expect, it, vi } from 'vitest';

const { enqueueEmail } = vi.hoisted(() => ({
  enqueueEmail: vi.fn(async () => ({ success: true, id: 'outbox-id', queued: true })),
}));

vi.mock('@/lib/email-outbox', () => ({
  enqueueEmail,
  isEmailOutboxConfigured: () => true,
}));

import {
  buildTrackingEmail,
  buildOrderConfirmationEmail,
  buildOwnerOrderAlertEmail,
  sendOrderConfirmation,
  type OrderConfirmationParams,
} from '@/lib/email-service';
import { getPickupLocationById, pickupWindowLabel } from '@/data/products';

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
    'shows Express shipping in the method and fee row for %s',
    (name) => {
      for (const html of renderCustomerAndOwner({ items: [{ name, quantity: 1, price: 18 }] })) {
        expect(html.match(/Express shipping/g)).toHaveLength(2);
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
      expect(html.match(/Express shipping/g)).toHaveLength(2);
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
      expect(html).not.toContain('Express shipping');
    }
  });

  it('uses Express shipping when an older pickle order has no recorded method', () => {
    for (const html of renderCustomerAndOwner({ shippingMethod: undefined })) {
      expect(html.match(/Express shipping/g)).toHaveLength(2);
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
      expect(html.match(/Express shipping/g)).toHaveLength(2);
      expect(html).toContain('2 complimentary Bobbatlu (FREE)');
      expect(html).not.toContain('UPS 2nd Day Air');
    }
  });

  it('respects an explicit non-pickle-only classification instead of inferring from names', () => {
    for (const html of renderCustomerAndOwner({ picklesOnly: false })) {
      expect(html.match(/UPS 2nd Day Air/g)).toHaveLength(2);
      expect(html).not.toContain('Express shipping');
    }
  });

  it.each([
    { method: 'ground', label: 'Ground — estimated 2–5 business days in transit' },
    { method: 'expedited', label: 'Expedited — estimated 2 business days in transit' },
  ] as const)('preserves an explicitly recorded $method method', ({ method, label }) => {
    for (const html of renderCustomerAndOwner({ shippingMethod: method })) {
      expect(html.split(label)).toHaveLength(3);
      expect(html).not.toContain('Express shipping');
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
      expect(html).not.toContain('Express shipping');
      expect(html).not.toContain('UPS 2nd Day Air');
      expect(html).not.toContain('$6.99');
    }
  });
});

describe('pickup confirmation email hours', () => {
  const pickupParams: OrderConfirmationParams = {
    email: 'customer@example.com',
    orderNumber: 'AJ-EMAIL-PICKUP',
    squarePaymentId: 'square-test',
    customerName: 'Test Customer',
    phone: '2145550100',
    total: 40,
    subtotal: 40,
    items: [{ name: 'Guntur Malpuri', quantity: 1, price: 40 }],
    fulfillmentType: 'pickup',
    pickupDate: '2026-09-30',
    pickupLocation: 'Ravi Babu Biryani - Frisco — 6226 All Stars Ave, Frisco, TX 75033',
  };

  it.each([
    ['frisco-ravibabu', '6:30 PM and 10:25 PM'],
    ['irving-ravibabu', '6:30 PM and 1:30 AM'],
    ['plano-biryanify', '6:30 PM and 12:50 AM'],
  ])('shows the %s pickup window', (locationId, window) => {
    const html = buildOrderConfirmationEmail({ ...pickupParams, pickupHours: pickupWindowLabel(getPickupLocationById(locationId)!) }).html;
    expect(html).toContain(`between <strong>${window}</strong> at the selected location`);
  });

  it('keeps the previous window when no location hours are given', () => {
    expect(buildOrderConfirmationEmail(pickupParams).html).toContain('between <strong>6:30 PM and 12:45 AM</strong>');
  });
});

describe('customer tracking email (owner template, 2026-09-02)', () => {
  const build = (over: Partial<Parameters<typeof buildTrackingEmail>[0]> = {}) => buildTrackingEmail({
    to: 'buyer@example.com', orderId: 'o1', orderNumber: 'AJ-1020', customerName: 'Aishwarya Gantasala',
    trackingNumber: '1Z2752H30320025610', ...over,
  });

  it('matches the approved UPS layout: subject, greeting, card, button and footer', () => {
    const email = build();
    expect(email.subject).toBe('Amamma Jaadi: AJ-1020 Your Order is on its way');
    expect(email.dedupeKey).toBe('tracking:o1:1Z2752H30320025610');
    expect(email).not.toHaveProperty('cc');
    for (const text of [
      'Shipping confirmation', 'Your order is on its way!', 'Hi Aishwarya Gantasala,',
      'Your order has been packed and dispatched via UPS to your destination.',
      'Your package is currently in transit. Please use the tracking link below for the latest delivery estimate.',
      'UPS shipment', 'AJ-1020', '1Z2752H30320025610', 'In transit',
      'https://amammajaadi.com/images/email/ups-logo.png',
      'href="https://www.ups.com/track?loc=en_US&amp;tracknum=1Z2752H30320025610"', 'Track Package with UPS',
      'UPS tracking will show the latest movement and estimated delivery date.',
      'Thank you for choosing Amamma Jaadi. We hope you enjoy every bite!', 'Team Amamma Jaadi',
      'www.AmammaJaadi.com',
    ]) expect(email.html).toContain(text);
    // No sweets claim: the same email goes to pickle-only orders.
    expect(email.html).not.toContain('ghee');
  });

  it('copies the shop when given a Cc and reports a delivered package', () => {
    const email = build({ cc: ['amamma.jaadi@gmail.com'], delivered: true });
    expect(email.cc).toEqual(['amamma.jaadi@gmail.com']);
    expect(email.html).toContain('UPS shows your package as delivered.');
    expect(email.html).toContain('>Delivered<');
    expect(email.html).not.toContain('In transit');
  });

  it('never puts UPS branding on a USPS or unknown tracking number', () => {
    const usps = build({ trackingNumber: '9400111899223344556677' });
    expect(usps.html).toContain('href="https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223344556677"');
    expect(usps.html).toContain('Track Package with USPS');
    expect(usps.html).toContain('dispatched via USPS');
    expect(usps.html).not.toContain('ups-logo.png');
    expect(usps.html).not.toContain('ups.com');

    const unknown = build({ trackingNumber: 'ABC123' });
    expect(unknown.html).toContain('ABC123');
    expect(unknown.html).toContain('Your order has been packed and dispatched to your destination.');
    expect(unknown.html).not.toContain('Track Package with');
    expect(unknown.html).not.toContain('ups-logo.png');
  });

  it('escapes customer details and greets "there" without a name', () => {
    const email = build({ customerName: '<b>Eve</b>', orderNumber: 'AJ-<1>' });
    expect(email.html).toContain('Hi &lt;b&gt;Eve&lt;/b&gt;,');
    expect(email.html).toContain('AJ-&lt;1&gt;');
    expect(email.html).not.toContain('<b>Eve</b>');
    expect(build({ customerName: '  ' }).html).toContain('Hi there,');
  });
});

describe('Monday/Tuesday dispatch note (every delivery order)', () => {
  const base = {
    email: 'c@example.com', orderNumber: 'AJ-2000', squarePaymentId: 'p1', customerName: 'Test', phone: '1',
    total: 10, items: [{ name: 'Kova Bobbatlu', quantity: 1, price: 10 }],
  };
  const note = 'UPS doesn&apos;t ship over the weekend';

  it('shows the note before the sign-off on every delivery order, whatever the weekday, and never on pickup', () => {
    for (const placedAt of ['2026-10-13T17:00:00Z', '2026-10-15T17:00:00Z', '2026-10-19T17:00:00Z']) {
      const html = buildOrderConfirmationEmail({ ...base, fulfillmentType: 'delivery', placedAt: new Date(placedAt) }).html;
      expect(html).toContain(note);
      expect(html).toContain('dispatch your order on <strong>Monday/Tuesday</strong>');
      expect(html.indexOf(note)).toBeLessThan(html.indexOf('Team Amamma Jaadi'));
    }
    expect(buildOrderConfirmationEmail({ ...base, fulfillmentType: 'pickup', placedAt: new Date('2026-10-16T17:00:00Z') }).html).not.toContain(note);
  });
  it('names the exact dispatch days when the shopper chose a shipment week', () => {
    const html = buildOrderConfirmationEmail({ ...base, fulfillmentType: 'delivery', shipWeek: '2026-10-26' }).html;
    expect(html).toContain('dispatch your order on <strong>Mon Oct 26 / Tue Oct 27</strong>');
  });
});

describe('fresh preparation note (delivery orders)', () => {
  const base = {
    email: 'c@example.com', orderNumber: 'AJ-2001', squarePaymentId: 'p1', customerName: 'Test', phone: '1', total: 10,
  };
  const note = 'Our sweets are <strong>freshly made</strong> after your order is confirmed.';

  it('appears on sweet delivery orders only', () => {
    const sweets = [{ name: 'Kova Bobbatlu', quantity: 1, price: 10 }];
    expect(buildOrderConfirmationEmail({ ...base, items: sweets, fulfillmentType: 'delivery' }).html).toContain(note);
    expect(buildOrderConfirmationEmail({ ...base, items: sweets, fulfillmentType: 'pickup' }).html).not.toContain(note);
    expect(buildOrderConfirmationEmail({ ...base, items: [{ name: 'Chicken Pickle', quantity: 1, price: 10 }], fulfillmentType: 'delivery', picklesOnly: true }).html).not.toContain(note);
  });
});
