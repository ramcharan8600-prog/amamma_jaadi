/**
 * Square Payment Integration Layer
 *
 * Architecture for production Square integration.
 * Currently stubbed — activate by setting SQUARE_ACCESS_TOKEN.
 *
 * Supported payment methods (future):
 * - Credit/Debit Card (Square Web Payments SDK)
 * - Apple Pay
 * - Google Pay
 *
 * Flow:
 * 1. Frontend tokenizes card via Square Web Payments SDK
 * 2. Token sent to /api/payments/create-payment
 * 3. Backend creates payment via Square Payments API
 * 4. Backend verifies payment, creates order
 * 5. Webhooks handle async payment updates
 */

import { getCloudflareContext } from '@opennextjs/cloudflare';

interface SquareConfig {
  accessToken: string;
  environment: 'sandbox' | 'production';
  locationId: string;
  appId: string;
}

/**
 * Square config from the Worker env, read at REQUEST time — NOT build time.
 *
 * `NEXT_PUBLIC_*` values are normally inlined into the bundle by Next.js at
 * build time, which freezes whatever the build machine's env held (e.g. sandbox
 * values from `.env.local`). Reading them here via the Cloudflare context
 * instead means the deployed values flow live from the Cloudflare dashboard
 * variables — change the location/app id there and it takes effect on the next
 * request, no rebuild or redeploy.
 */
function getEnv(): Record<string, string | undefined> {
  // Merge Node's process.env (OpenNext populates it with the Worker's vars +
  // secrets at runtime) with the Cloudflare binding env, so a value is found
  // whichever source carries it. Neither holds the build-inlined `NEXT_PUBLIC_*`
  // literal — that only exists at static `process.env.NEXT_PUBLIC_X` sites, which
  // this file no longer has — so these reads return the true runtime values.
  let cf: Record<string, string | undefined> = {};
  try {
    cf = getCloudflareContext().env as unknown as Record<string, string | undefined>;
  } catch {
    // Not in a request scope (e.g. during build) — fall back to process.env only.
  }
  return { ...(process.env as Record<string, string | undefined>), ...cf };
}

function getConfig(runtimeEnv?: Record<string, unknown>): SquareConfig {
  const env = { ...getEnv(), ...runtimeEnv } as Record<string, string | undefined>;
  return {
    accessToken: env.SQUARE_ACCESS_TOKEN || '',
    environment: (env.SQUARE_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
    locationId: env.NEXT_PUBLIC_SQUARE_LOCATION_ID || '',
    appId: env.NEXT_PUBLIC_SQUARE_APP_ID || '',
  };
}

export function isSquareEnabled(): boolean {
  const config = getConfig();
  return !!(config.accessToken && config.locationId);
}

/**
 * Public (client-safe) Square values for the Web Payments SDK — application id,
 * location id, and which SDK to load (sandbox vs production). Returned by
 * create-session and consumed by the checkout page, so the browser never relies
 * on a build-time `NEXT_PUBLIC_*` value being baked in.
 */
export function getSquarePublicConfig(): {
  appId: string;
  locationId: string;
  environment: 'sandbox' | 'production';
} {
  const env = getEnv();
  return {
    appId: env.NEXT_PUBLIC_SQUARE_APP_ID || '',
    locationId: env.NEXT_PUBLIC_SQUARE_LOCATION_ID || '',
    environment:
      (env.NEXT_PUBLIC_SQUARE_ENVIRONMENT as 'sandbox' | 'production') ||
      (env.SQUARE_ENVIRONMENT as 'sandbox' | 'production') ||
      'sandbox',
  };
}

/**
 * Create a payment using a tokenized card nonce.
 * Called from /api/payments/create-payment
 */
export interface SquarePaymentParams {
  sourceId: string; // payment token from frontend SDK
  amount: number; // in cents
  currency?: string;
  orderId: string; // our payment-session id — echoed back as reference_id
  idempotencyKey: string; // caller-provided for safe retries
  customerEmail?: string;
  verificationToken?: string; // SCA / 3DS buyer verification (from frontend SDK)
  note?: string;
}

/** Persist this exact request before sending it. Never rebuild an uncertain retry. */
export interface SquarePaymentRequest {
  environment: 'sandbox' | 'production';
  apiVersion: string;
  body: {
    source_id: string;
    idempotency_key: string;
    amount_money: { amount: number; currency: string };
    location_id: string;
    reference_id: string;
    note: string;
    buyer_email_address?: string;
    verification_token?: string;
    autocomplete: true;
  };
}

export interface SquarePaymentResult {
  paymentId: string;
  status: string;
}

/** Only an explicit issuer/payment-method rejection authorizes a new attempt. */
export class SquarePaymentError extends Error {
  constructor(
    public readonly code: string,
    public readonly confirmedDecline = false,
    public readonly paymentId?: string
  ) {
    // Keep provider response bodies, card tokens, and customer data out of logs.
    super(code);
    this.name = 'SquarePaymentError';
  }
}

const CONFIRMED_DECLINE_CODES = new Set([
  'ADDRESS_VERIFICATION_FAILURE', 'ALLOWABLE_PIN_TRIES_EXCEEDED', 'BAD_EXPIRATION',
  'CARDHOLDER_INSUFFICIENT_PERMISSIONS', 'CARD_DECLINED', 'CARD_DECLINED_VERIFICATION_REQUIRED',
  'CARD_EXPIRED', 'CARD_NOT_SUPPORTED', 'CHIP_INSERTION_REQUIRED', 'CVV_FAILURE',
  'EXPIRATION_FAILURE', 'GENERIC_DECLINE', 'INSUFFICIENT_FUNDS', 'INVALID_ACCOUNT',
  'INVALID_CARD', 'INVALID_CARD_DATA', 'INVALID_EXPIRATION', 'INVALID_PIN',
  'INVALID_POSTAL_CODE', 'MANUALLY_ENTERED_PAYMENT_NOT_SUPPORTED', 'PAN_FAILURE',
  'PAYMENT_LIMIT_EXCEEDED', 'TRANSACTION_LIMIT', 'VOICE_FAILURE',
]);

export function buildSquarePaymentRequest(params: SquarePaymentParams): SquarePaymentRequest {
  const config = getConfig();
  if (!isSquareEnabled()) {
    throw new SquarePaymentError('PAYMENTS_NOT_CONFIGURED');
  }
  return {
    environment: config.environment,
    apiVersion: '2024-01-18',
    body: {
      source_id: params.sourceId,
      idempotency_key: params.idempotencyKey,
      amount_money: {
        amount: params.amount,
        currency: params.currency || 'USD',
      },
      location_id: config.locationId,
      reference_id: params.orderId,
      note: params.note || 'amammajaadi.com — online order',
      buyer_email_address: params.customerEmail,
      verification_token: params.verificationToken,
      autocomplete: true,
    },
  };
}

export async function executeSquarePaymentRequest(
  request: SquarePaymentRequest,
  runtimeEnv?: Record<string, unknown>
): Promise<SquarePaymentResult> {
  const config = getConfig(runtimeEnv);
  if (!config.accessToken || config.environment !== request.environment ||
      config.locationId !== request.body.location_id) {
    throw new SquarePaymentError('PAYMENT_CONFIGURATION_CHANGED');
  }
  const baseUrl = request.environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
  let response: Response;
  let data: {
    errors?: Array<{ code?: string; category?: string }>;
    payment?: { id?: string; status?: string; reference_id?: string;
      amount_money?: { amount?: number; currency?: string }; location_id?: string };
  };
  try {
    response = await fetch(`${baseUrl}/v2/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
        'Square-Version': request.apiVersion,
      },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(20_000),
    });
    data = await response.json();
  } catch {
    // A timeout can happen after Square charged the card. Never call it declined.
    throw new SquarePaymentError('PAYMENT_RESPONSE_UNKNOWN');
  }
  const payment = data.payment;
  const code = data.errors?.[0]?.code || 'PAYMENT_RESPONSE_UNKNOWN';
  if (!response.ok) {
    // Do not let an error code override evidence of an accepted/in-flight
    // payment, or a response belonging to a different checkout. When Square
    // returns no payment object, its explicit payment-method error still applies.
    if (payment && (
      ['COMPLETED', 'APPROVED', 'PENDING'].includes(payment.status ?? '') ||
      (payment.reference_id !== undefined && payment.reference_id !== request.body.reference_id) ||
      (payment.location_id !== undefined && payment.location_id !== request.body.location_id) ||
      (payment.amount_money?.amount !== undefined && payment.amount_money.amount !== request.body.amount_money.amount) ||
      (payment.amount_money?.currency !== undefined && payment.amount_money.currency !== request.body.amount_money.currency)
    )) {
      throw new SquarePaymentError('PAYMENT_RESPONSE_MISMATCH');
    }
    const explicitFailure = response.status >= 400 && response.status < 500 && (
      payment?.status === 'FAILED' || payment?.status === 'CANCELED' ||
      (data.errors?.[0]?.category === 'PAYMENT_METHOD_ERROR' && CONFIRMED_DECLINE_CODES.has(code))
    );
    throw new SquarePaymentError(code, explicitFailure, payment?.id);
  }
  if (!payment?.id || !payment.status || payment.reference_id !== request.body.reference_id ||
      payment.location_id !== request.body.location_id ||
      payment.amount_money?.amount !== request.body.amount_money.amount ||
      payment.amount_money.currency !== request.body.amount_money.currency) {
    throw new SquarePaymentError('PAYMENT_RESPONSE_MISMATCH');
  }
  if (payment.status === 'FAILED' || payment.status === 'CANCELED') {
    throw new SquarePaymentError(code, true, payment.id);
  }
  return { paymentId: payment.id, status: payment.status };
}

export async function createPayment(params: SquarePaymentParams): Promise<SquarePaymentResult> {
  return executeSquarePaymentRequest(buildSquarePaymentRequest(params));
}

/**
 * Verify a payment status by ID.
 * Called from /api/payments/verify
 */
export async function verifyPayment(paymentId: string): Promise<{
  status: string;
  amount: number;
  orderId: string;
}> {
  const config = getConfig();
  if (!isSquareEnabled()) {
    throw new Error('Square payments not configured');
  }

  const baseUrl = config.environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';

  const response = await fetch(`${baseUrl}/v2/payments/${paymentId}`, {
    headers: {
      'Authorization': `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-01-18',
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error('Payment verification failed');
  }

  return {
    status: data.payment.status,
    amount: data.payment.amount_money.amount,
    orderId: data.payment.reference_id,
  };
}

/**
 * Read Square's cumulative refund totals for a payment.
 * `refunded_money` is authoritative across one or many partial refunds.
 */
export async function getPaymentRefundSummary(paymentId: string): Promise<{
  totalAmount: number;
  refundedAmount: number;
  referenceId?: string;
}> {
  const config = getConfig();
  if (!isSquareEnabled()) {
    throw new Error('Square payments not configured');
  }

  const baseUrl = config.environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
  const response = await fetch(`${baseUrl}/v2/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      'Authorization': `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-01-18',
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.errors?.[0]?.detail || 'Payment refund verification failed');
  }

  const totalAmount = Number(
    data.payment?.total_money?.amount ?? data.payment?.amount_money?.amount
  );
  const refundedAmount = Number(data.payment?.refunded_money?.amount ?? 0);
  if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
    throw new Error('Square returned an invalid payment total');
  }
  if (!Number.isSafeInteger(refundedAmount) || refundedAmount < 0) {
    throw new Error('Square returned an invalid refunded total');
  }

  return {
    totalAmount,
    refundedAmount,
    referenceId: data.payment?.reference_id || undefined,
  };
}

// NOTE: sales tax is NOT calculated here. All order money math lives in
// `src/lib/pricing.ts` (single source of truth, shared by the checkout UI and
// create-session) so the displayed total and the charged total cannot drift.
