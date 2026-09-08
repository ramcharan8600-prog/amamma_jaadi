import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSquarePaymentRequest, executeSquarePaymentRequest } from '@/lib/square';

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => { throw new Error('test'); } }));

beforeEach(() => {
  process.env.SQUARE_ACCESS_TOKEN = 'test-access-token';
  process.env.SQUARE_ENVIRONMENT = 'sandbox';
  process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID = 'test-location';
});
afterEach(() => vi.unstubAllGlobals());

function snapshot() {
  return buildSquarePaymentRequest({ sourceId: 'test-nonce', amount: 4000, orderId: 'test-session',
    idempotencyKey: 'test-key', customerEmail: 'test@example.com' });
}

describe('Square outcome classification', () => {
  it.each(['COMPLETED', 'APPROVED', 'PENDING'])('does not call contradictory HTTP 400 / %s a confirmed decline', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      errors: [{ code: 'GENERIC_DECLINE', category: 'PAYMENT_METHOD_ERROR' }],
      payment: { id: 'payment-one', status },
    }, { status: 400 })));
    await expect(executeSquarePaymentRequest(snapshot())).rejects.toMatchObject({
      code: 'PAYMENT_RESPONSE_MISMATCH', confirmedDecline: false,
    });
  });

  it.each([
    { reference_id: 'different-session' },
    { location_id: 'different-location' },
    { amount_money: { amount: 1, currency: 'USD' } },
    { amount_money: { amount: 4000, currency: 'CAD' } },
  ])('does not release a checkout based on a failed payment with mismatched identity %j', async mismatch => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      errors: [{ code: 'GENERIC_DECLINE', category: 'PAYMENT_METHOD_ERROR' }],
      payment: { id: 'failed-payment', status: 'FAILED', ...mismatch },
    }, { status: 400 })));
    await expect(executeSquarePaymentRequest(snapshot())).rejects.toMatchObject({
      code: 'PAYMENT_RESPONSE_MISMATCH', confirmedDecline: false,
    });
  });

  it.each(['FAILED', 'CANCELED'])('recognizes HTTP 200 / %s only when payment identity and amount match', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ payment: {
      id: 'failed-payment', status, reference_id: 'test-session', location_id: 'test-location',
      amount_money: { amount: 4000, currency: 'USD' },
    } })));
    await expect(executeSquarePaymentRequest(snapshot())).rejects.toMatchObject({
      confirmedDecline: true, paymentId: 'failed-payment',
    });
  });

  it('reports only an explicit payment-method decline as safe for a new attempt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      errors: [{ code: 'GENERIC_DECLINE', category: 'PAYMENT_METHOD_ERROR' }],
      payment: { id: 'failed-payment', status: 'FAILED' },
    }, { status: 400 })));
    await expect(executeSquarePaymentRequest(snapshot())).rejects.toMatchObject({
      code: 'GENERIC_DECLINE', confirmedDecline: true, paymentId: 'failed-payment',
    });
  });

  it.each([
    [503, 'TEMPORARY_ERROR', 'API_ERROR'],
    [429, 'RATE_LIMITED', 'RATE_LIMIT_ERROR'],
    [400, 'CARD_TOKEN_USED', 'PAYMENT_METHOD_ERROR'],
    [400, 'CARD_TOKEN_EXPIRED', 'PAYMENT_METHOD_ERROR'],
    [400, 'IDEMPOTENCY_KEY_REUSED', 'INVALID_REQUEST_ERROR'],
  ])('keeps HTTP %i %s unresolved', async (status, code, category) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ errors: [{ code, category }] }, { status })));
    await expect(executeSquarePaymentRequest(snapshot())).rejects.toMatchObject({ code, confirmedDecline: false });
  });

  it('keeps a network exception unresolved without exposing its error text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('secret-nonce-must-not-escape'); }));
    await expect(executeSquarePaymentRequest(snapshot())).rejects.toMatchObject({
      message: 'PAYMENT_RESPONSE_UNKNOWN', confirmedDecline: false,
    });
  });

  it('sends the saved request verbatim with a finite network deadline', async () => {
    const request = snapshot();
    const fetchMock = vi.fn(async () => Response.json({ payment: {
      id: 'accepted-payment', status: 'COMPLETED', reference_id: 'test-session',
      location_id: 'test-location', amount_money: { amount: 4000, currency: 'USD' },
    } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(executeSquarePaymentRequest(request)).resolves.toEqual({ paymentId: 'accepted-payment', status: 'COMPLETED' });
    const options = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(options[1].body).toBe(JSON.stringify(request.body));
    expect(options[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('will not report success for a different session or amount', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ payment: {
      id: 'accepted-payment', status: 'COMPLETED', reference_id: 'different-session',
      location_id: 'test-location', amount_money: { amount: 1, currency: 'USD' },
    } })));
    await expect(executeSquarePaymentRequest(snapshot())).rejects.toMatchObject({
      code: 'PAYMENT_RESPONSE_MISMATCH', confirmedDecline: false,
    });
  });
});
