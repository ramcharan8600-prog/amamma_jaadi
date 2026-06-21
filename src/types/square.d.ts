/**
 * Minimal ambient types for the Square Web Payments SDK (loaded at runtime
 * from web.squarecdn.com). Only the surface we use is declared.
 */
interface SquareTokenizeResult {
  status: string; // 'OK' on success
  token?: string;
  errors?: Array<{ message: string }>;
}

interface SquareCard {
  attach(selector: string): Promise<void>;
  tokenize(): Promise<SquareTokenizeResult>;
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
