/** Shared checkout contact validation used by both the browser and API. */

export function isValidCustomerName(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length >= 2;
}

export function isValidEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  return email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPhone(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export function validateRequiredContact(input: {
  name: unknown;
  email: unknown;
  phone: unknown;
}): string | null {
  if (!isValidCustomerName(input.name)) return 'Customer name is required';
  if (!isValidPhone(input.phone)) return 'Valid phone number is required';
  if (!isValidEmail(input.email)) return 'Valid email address is required';
  return null;
}
