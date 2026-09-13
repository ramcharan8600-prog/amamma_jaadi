import { afterEach, describe, expect, it, vi } from 'vitest';

const { enqueueEmail } = vi.hoisted(() => ({
  enqueueEmail: vi.fn(async () => ({ success: true, id: 'outbox-id', queued: true })),
}));

vi.mock('@/lib/email-outbox', () => ({
  enqueueEmail,
  isEmailOutboxConfigured: () => true,
}));

import { sendOrderConfirmation } from '@/lib/email-service';

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
