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

function getConfig(): SquareConfig {
  const env = getEnv();
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
export async function createPayment(params: {
  sourceId: string; // payment token from frontend SDK
  amount: number; // in cents
  currency?: string;
  orderId: string; // our payment-session id — echoed back as reference_id
  idempotencyKey: string; // caller-provided for safe retries
  customerEmail?: string;
  verificationToken?: string; // SCA / 3DS buyer verification (from frontend SDK)
  note?: string;
}): Promise<{ paymentId: string; status: string }> {
  const config = getConfig();
  if (!isSquareEnabled()) {
    throw new Error('Square payments not configured');
  }

  const baseUrl = config.environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';

  const response = await fetch(`${baseUrl}/v2/payments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-01-18',
    },
    body: JSON.stringify({
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
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.errors?.[0]?.detail || 'Payment failed');
  }

  return {
    paymentId: data.payment.id,
    status: data.payment.status,
  };
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

// NOTE: sales tax is NOT calculated here. All order money math lives in
// `src/lib/pricing.ts` (single source of truth, shared by the checkout UI and
// create-session) so the displayed total and the charged total cannot drift.
