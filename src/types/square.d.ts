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

interface SquarePayments {
  card(): Promise<SquareCard>;
}

interface SquareSDK {
  payments(appId: string, locationId: string): SquarePayments;
}

interface Window {
  Square?: SquareSDK;
}
