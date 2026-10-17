import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, isDbConfigured } from '@/lib/db';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session';
import { ok, fail } from '@/lib/api';
import { blockCustomer, listBlockedCustomers, unblockCustomer } from '@/lib/blocked-customers';

async function isAuthenticated(): Promise<boolean> {
  const session = (await cookies()).get(SESSION_COOKIE);
  return Boolean(session?.value && verifySessionToken(session.value));
}

const noStore = { 'Cache-Control': 'private, no-store' };

/** GET /api/admin/blocked-customers — Admin: the blocked list, newest first. */
export async function GET() {
  if (!(await isAuthenticated())) return fail('Unauthorized', 401);
  if (!isDbConfigured()) return fail('Database not configured', 503);
  return Response.json({ blocked: await listBlockedCustomers(getDb()) }, { headers: noStore });
}

/** POST — Admin: { phone, email?, name?, orderNumber?, reason? } blocks (or updates) a customer. */
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) return fail('Unauthorized', 401);
  if (!isDbConfigured()) return fail('Database not configured', 503);
  const body = await request.json().catch(() => null) as { phone?: unknown; email?: unknown; name?: unknown; orderNumber?: unknown; reason?: unknown } | null;
  const db = getDb();
  const phone = body ? await blockCustomer(db, { ...body, phone: body.phone }) : null;
  if (!phone) return fail('Enter a valid US phone number.', 400);
  return ok({ blocked: await listBlockedCustomers(db) });
}

/** DELETE — Admin: { phone } removes a customer from the blocked list. */
export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated())) return fail('Unauthorized', 401);
  if (!isDbConfigured()) return fail('Database not configured', 503);
  const body = await request.json().catch(() => null) as { phone?: unknown } | null;
  const db = getDb();
  if (!(await unblockCustomer(db, body?.phone))) return fail('That number is not on the blocked list.', 404);
  return ok({ blocked: await listBlockedCustomers(db) });
}
