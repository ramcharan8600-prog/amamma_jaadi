import { clsx, type ClassValue } from 'clsx';
import { businessDateOffset, toBusinessDateString } from '@/lib/date';
import { getPickupDateBounds } from '@/lib/pickup-date';

// Re-exported for backwards compatibility — canonical definitions live in @/lib/constants.
export { WHATSAPP_NUMBER, PHONE_NUMBER, INSTAGRAM_HANDLE, BRAND_NAME } from '@/lib/constants';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}


/** Business rule: minimum days notice for a date (in business timezone) */
export function getMinDate(daysNotice: number): string {
  return businessDateOffset(daysNotice);
}

export function getTodayString(): string {
  return toBusinessDateString(new Date());
}

export function isSameDayPickupAllowed(totalPieces: number, hasNextDayProduct = false): boolean {
  const { today, min } = getPickupDateBounds(totalPieces, new Date(), hasNextDayProduct);
  return min === today;
}

/** Returns the minimum pickup date under the shared scheduling rules. */
export function getMinPickupDate(totalPieces: number, hasNextDayProduct = false): string {
  return getPickupDateBounds(totalPieces, new Date(), hasNextDayProduct).min;
}

/** Minimum event date is 1-2 days from now */
export function getMinEventDate(): string {
  return getMinDate(2);
}
