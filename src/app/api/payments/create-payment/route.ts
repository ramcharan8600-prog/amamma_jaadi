import { NextRequest } from 'next/server';
import { getDb, isDbConfigured } from '@/lib/db';
import { isSquareEnabled } from '@/lib/square';
import { pendingPaymentReply, runPaymentAttempt } from '@/lib/payment-attempts';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { ok, fail } from '@/lib/api';

/** Initial: {sessionId, sourceId, verificationToken?}. Recovery: {sessionId, retry:true}. */
export async function POST(request: NextRequest) {
  if (!rateLimit(`create-payment:${getClientIp(request)}`, 10, 60_000)) {
    return fail('Too many requests. Please slow down.', 429);
  }
  if (!isDbConfigured() || !isSquareEnabled()) {
    return fail('Payments are not available right now. Please try again later.', 503);
  }
  try {
    const body = await request.json();
    const { sessionId, sourceId, verificationToken, retry } = body;
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 64 ||
        (sourceId !== undefined && (typeof sourceId !== 'string' || !sourceId || sourceId.length > 2048)) ||
        (verificationToken !== undefined && (typeof verificationToken !== 'string' || verificationToken.length > 2048)) ||
        (retry !== undefined && typeof retry !== 'boolean') || (!sourceId && retry !== true)) {
      return fail('Invalid payment details.', 400);
    }
    const { httpStatus, ...reply } = await runPaymentAttempt(getDb(), {
      sessionId, sourceId, verificationToken, retry,
    });
    return ok(reply, httpStatus);
  } catch {
    // The request could already have reached Square. Do not tell the buyer to pay again.
    console.error(JSON.stringify({ event: 'payment_attempt_deferred' }));
    const { httpStatus, ...reply } = pendingPaymentReply();
    return ok(reply, httpStatus);
  }
}
