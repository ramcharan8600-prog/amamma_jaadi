/** Shared checkout contact validation used by both the browser and API. */

export function isValidCustomerName(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length >= 2;
}

export function isValidEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  return email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Shown to customers when a phone number is not a usable US number. */
export const PHONE_ERROR = 'Enter a 10-digit US phone number';

/**
 * US numbers only (the shop sells within the USA). Accepts any formatting and
 * an optional leading 1/+1 — browser autofill adds it — and returns the plain
 * 10 digits, or null. Area codes and exchanges never start with 0 or 1, which
 * also catches a leading 1 typed in front of a short number.
 */
export function normalizeUsPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? digits : null;
}

export function isValidPhone(value: unknown): boolean {
  return normalizeUsPhone(value) !== null;
}

/** E.164 (+1XXXXXXXXXX), the format Square expects for buyer verification. */
export function toUsE164(value: unknown): string | undefined {
  const digits = normalizeUsPhone(value);
  return digits ? `+1${digits}` : undefined;
}

export function validateRequiredContact(input: {
  name: unknown;
  email: unknown;
  phone: unknown;
}): string | null {
  if (!isValidCustomerName(input.name)) return 'Customer name is required';
  if (!isValidPhone(input.phone)) return PHONE_ERROR;
  if (!isValidEmail(input.email)) return 'Valid email address is required';
  return null;
}
