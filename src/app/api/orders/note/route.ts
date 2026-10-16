import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { ok, fail } from '@/lib/api';
import { cleanAdminNote, saveAdminNote } from '@/lib/admin-note';

async function isAuthenticated(): Promise<boolean> {
  const session = (await cookies()).get(SESSION_COOKIE);
  return Boolean(session?.value && verifySessionToken(session.value));
}

/** PUT /api/orders/note — Admin only: { orderId, note } saves the order's private note ('' clears it). */
export async function PUT(request: NextRequest) {
  if (!(await isAuthenticated())) return fail('Unauthorized', 401);
  try {
    if (!isDbConfigured()) return fail('Database not configured', 503);
    const body = await request.json().catch(() => null) as { orderId?: unknown; note?: unknown } | null;
    const orderId = typeof body?.orderId === 'string' ? body.orderId.trim().slice(0, 100) : '';
    if (!orderId || (typeof body?.note !== 'string' && body?.note !== null)) return fail('Invalid note', 400);
    const note = cleanAdminNote(body.note);
    if (!(await saveAdminNote(getDb(), orderId, note))) return fail('Order not found', 404);
    return ok({ success: true, orderId, note });
  } catch (e) {
    console.error('Admin note save error:', e);
    return fail('Failed to save the note', 500);
  }
}
