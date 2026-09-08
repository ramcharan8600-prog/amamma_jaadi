import { NextRequest } from 'next/server';
import { getDb, isDbConfigured } from '@/lib/db';
import { getPaymentAttemptStatus, pendingPaymentReply } from '@/lib/payment-attempts';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { ok, fail } from '@/lib/api';

/** Looks up a saved result and repairs finalization; never starts a new charge. */
export async function POST(request: NextRequest) {
  if (!rateLimit(`verify-payment:${getClientIp(request)}`, 60, 60_000)) {
    return fail('Too many status requests. Please wait a moment.', 429);
  }
  if (!isDbConfigured()) return fail('Payments are temporarily unavailable.', 503);
  try {
    const { sessionId } = await request.json();
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 64) {
      return fail('Missing sessionId.', 400);
    }
    const { httpStatus, ...reply } = await getPaymentAttemptStatus(getDb(), sessionId);
    return ok(reply, httpStatus);
  } catch {
    const { httpStatus, ...reply } = pendingPaymentReply();
    return ok(reply, httpStatus);
  }
}
