/**
 * Minimal ambient types for the Square Web Payments SDK (loaded at runtime
 * from web.squarecdn.com). Only the surface we use is declared.
 */
interface SquareTokenizeResult {
  status: string; // 'OK' on success
  token?: string;
  errors?: Array<{ message: string }>;
}

interface SquareBillingContact {
  givenName?: string;
  familyName?: string;
  email?: string;
  phone?: string;
  addressLines?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
}

/**
 * Buyer-verification (3-D Secure / SCA) details. Passing these to tokenize()
 * lets the SDK run the card network's verification challenge (e.g. Amex
 * SafeKey, Visa Secure) when the issuer demands it — without them, payments
 * that require verification are declined by Square's risk engine.
 */
interface SquareVerificationDetails {
  amount: string;
  billingContact: SquareBillingContact;
  currencyCode: string;
  intent: 'CHARGE' | 'STORE';
  customerInitiated: boolean;
  sellerKeyedIn: boolean;
}

interface SquareCard {
  attach(selector: string): Promise<void>;
  tokenize(verificationDetails?: SquareVerificationDetails): Promise<SquareTokenizeResult>;
  destroy(): Promise<void>;
}

interface SquareApplePay {
  tokenize(): Promise<SquareTokenizeResult>;
}

// Opaque handle returned by payments.paymentRequest(...)
type SquarePaymentRequest = unknown;

interface SquarePayments {
  card(): Promise<SquareCard>;
  applePay(request: SquarePaymentRequest): Promise<SquareApplePay>;
  paymentRequest(options: {
    countryCode: string;
    currencyCode: string;
    total: { amount: string; label: string };
  }): SquarePaymentRequest;
}

interface SquareSDK {
  payments(appId: string, locationId: string): SquarePayments;
}

interface Window {
  Square?: SquareSDK;
}
