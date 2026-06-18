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

interface SquareConfig {
  accessToken: string;
  environment: 'sandbox' | 'production';
  locationId: string;
  appId: string;
}

function getConfig(): SquareConfig {
  return {
    accessToken: process.env.SQUARE_ACCESS_TOKEN || '',
    environment: (process.env.SQUARE_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
    locationId: process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID || '',
    appId: process.env.NEXT_PUBLIC_SQUARE_APP_ID || '',
  };
}

export function isSquareEnabled(): boolean {
  const config = getConfig();
  return !!(config.accessToken && config.locationId);
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

/**
 * Calculate tax using Square Orders API.
 * Delegates tax calculation to Square for accuracy.
 */
export async function calculateTax(params: {
  lineItems: Array<{ name: string; amount: number; quantity: number }>;
}): Promise<{ tax: number; total: number }> {
  // Future: Use Square Orders API for tax calculation
  // For now, return estimated 8.25% Texas sales tax
  const subtotal = params.lineItems.reduce(
    (sum, item) => sum + item.amount * item.quantity,
    0
  );
  const tax = Math.round(subtotal * 0.0825);
  return { tax, total: subtotal + tax };
}
