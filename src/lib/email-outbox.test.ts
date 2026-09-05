import { describe, expect, it } from 'vitest';
import { calculateEmailRetryDelay, isEmailQueueMessage } from '@/lib/email-outbox';

describe('email outbox retry policy', () => {
  it('backs off temporary provider errors up to one hour', () => {
    expect(calculateEmailRetryDelay(1, 500)).toBe(30);
    expect(calculateEmailRetryDelay(2, 500)).toBe(60);
    expect(calculateEmailRetryDelay(20, 503)).toBe(3_600);
  });

  it('retries a daily Resend quota rejection hourly', () => {
    expect(calculateEmailRetryDelay(1, 429, '{"name":"daily_quota_exceeded"}')).toBe(3_600);
  });

  it('honors a valid Retry-After value within the Queue delay limit', () => {
    expect(calculateEmailRetryDelay(1, 429, 'rate_limit_exceeded', '120')).toBe(120);
    expect(calculateEmailRetryDelay(1, 429, 'rate_limit_exceeded', '999999')).toBe(86_400);
  });
});

describe('email Queue message validation', () => {
  it('accepts only a UUID-backed outbox id', () => {
    expect(isEmailQueueMessage({ outboxId: '2a60c76d-e665-4efb-ab63-e237318866e7' })).toBe(true);
    expect(isEmailQueueMessage({ outboxId: 'not-an-id' })).toBe(false);
    expect(isEmailQueueMessage({ email: 'customer@example.com' })).toBe(false);
    expect(isEmailQueueMessage(null)).toBe(false);
  });
});
