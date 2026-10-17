import type { D1Database } from '@cloudflare/workers-types';
import { normalizeUsPhone } from '@/lib/contact-validation';

/**
 * Customers the owner no longer accepts orders from (owner, 2026-10-17).
 * Checkout refuses a blocked phone number — or the email saved with it —
 * when the shopper continues to payment, and again before any charge.
 * Lookups fail open: a database hiccup must not stop real customers.
 */
export const BLOCKED_CUSTOMER_MESSAGE =
  'You have been added to the blocked list due to your unprofessional behaviour with our team.';

export interface BlockedCustomer {
  phone: string;
  email: string | null;
  name: string | null;
  order_number: string | null;
  reason: string | null;
  created_at: string;
}

function cleanEmail(value: unknown): string | null {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.includes('@') ? email.slice(0, 200) : null;
}

/** True when this phone (any US format) or email is on the blocked list. */
export async function isBlockedCustomer(db: D1Database, phone: unknown, email?: unknown): Promise<boolean> {
  const digits = normalizeUsPhone(phone);
  const mail = cleanEmail(email);
  if (!digits && !mail) return false;
  try {
    const hit = await db.prepare('SELECT 1 AS hit FROM blocked_customers WHERE phone = ? OR (email IS NOT NULL AND email = ?) LIMIT 1')
      .bind(digits ?? '', mail ?? '').first();
    return Boolean(hit);
  } catch (error) {
    console.error(JSON.stringify({ event: 'blocked_customer_lookup_failed', error: error instanceof Error ? error.message : String(error) }));
    return false;
  }
}

export async function listBlockedCustomers(db: D1Database): Promise<BlockedCustomer[]> {
  const rows = await db.prepare('SELECT * FROM blocked_customers ORDER BY created_at DESC').all<BlockedCustomer>();
  return rows.results ?? [];
}

/** Add or update a block. Null when the phone number isn't a valid US number. */
export async function blockCustomer(db: D1Database, input: {
  phone: unknown; email?: unknown; name?: unknown; orderNumber?: unknown; reason?: unknown;
}): Promise<string | null> {
  const phone = normalizeUsPhone(input.phone);
  if (!phone) return null;
  const text = (value: unknown, max: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
  await db.prepare(
    `INSERT INTO blocked_customers (phone, email, name, order_number, reason) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET email = excluded.email, name = excluded.name,
       order_number = excluded.order_number, reason = excluded.reason`,
  ).bind(phone, cleanEmail(input.email), text(input.name, 100), text(input.orderNumber, 20), text(input.reason, 300)).run();
  return phone;
}

export async function unblockCustomer(db: D1Database, phone: unknown): Promise<boolean> {
  const digits = normalizeUsPhone(phone);
  if (!digits) return false;
  const result = await db.prepare('DELETE FROM blocked_customers WHERE phone = ?').bind(digits).run();
  return Boolean(result.meta.changes);
}
