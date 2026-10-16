import type { D1Database } from '@cloudflare/workers-types';

/** Longest note the admin can save on an order. */
export const ADMIN_NOTE_MAX = 500;

/** Trimmed note, or null to clear it. Line breaks are kept; other control characters are dropped. */
export function cleanAdminNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const note = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim().slice(0, ADMIN_NOTE_MAX);
  return note || null;
}

/** Save (or clear) an order's admin note. False when the order does not exist. */
export async function saveAdminNote(db: D1Database, orderId: string, note: string | null): Promise<boolean> {
  const result = await db.prepare(`UPDATE orders SET admin_note = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(note, orderId).run();
  return Boolean(result.meta.changes);
}
