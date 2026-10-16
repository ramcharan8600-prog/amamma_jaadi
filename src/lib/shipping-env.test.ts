import { describe, expect, it } from 'vitest';
import { customerTrackingEmailsOn, shopShippingEmail, trackingEmailCc } from '@/lib/shipping-env';

describe('shipping email settings per environment', () => {
  const production = { SQUARE_ENVIRONMENT: 'production' };
  const sandbox = { SQUARE_ENVIRONMENT: 'sandbox', SANDBOX_EMAIL_RECIPIENT: 'test-inbox@example.com' };

  it('copies the shop on customer tracking emails in production only', () => {
    expect(trackingEmailCc(production)).toEqual(['amamma.jaadi@gmail.com']);
    expect(trackingEmailCc(sandbox)).toEqual([]);
    // A sandbox inbox set on a production-mode Worker still means "test": no Cc.
    expect(trackingEmailCc({ ...production, SANDBOX_EMAIL_RECIPIENT: 'test-inbox@example.com' })).toEqual([]);
    expect(trackingEmailCc({})).toEqual([]);
  });

  it('sends shop emails to the shop Gmail in production and the test inbox in sandbox', () => {
    expect(shopShippingEmail(production)).toBe('amamma.jaadi@gmail.com');
    expect(shopShippingEmail(sandbox)).toBe('test-inbox@example.com');
    expect(shopShippingEmail({})).toBeNull();
  });

  it('keeps customer tracking emails off unless switched on', () => {
    expect(customerTrackingEmailsOn({ CUSTOMER_TRACKING_EMAILS: 'on' })).toBe(true);
    expect(customerTrackingEmailsOn({ CUSTOMER_TRACKING_EMAILS: 'off' })).toBe(false);
    expect(customerTrackingEmailsOn({})).toBe(false);
  });
});
