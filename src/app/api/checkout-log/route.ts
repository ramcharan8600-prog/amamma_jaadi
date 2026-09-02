import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * POST /api/checkout-log
 *
 * Collector for what happened inside the *customer's browser* during checkout.
 *
 * Everything after "Continue to payment" runs client-side — the SDK loading,
 * the card form mounting, tokenize(), the issuer's 3-D Secure challenge. None
 * of it touches the Worker, so when it fails the server sees nothing at all:
 * a payment_sessions row stuck at 'pending' and no reason anywhere. This
 * endpoint is the missing channel.
 *
 * The client buffers a breadcrumb trail and sends it ONCE per checkout, so a
 * report is one request rather than one per step. The trail is what makes it
 * useful — knowing a payment failed matters far less than knowing it reached
 * `tokenize` and never came back.
 *
 * Same shape as /api/csp-report and for the same reasons: public and
 * unauthenticated, so it is rate limited, size capped, never writes to D1, and
 * always answers 204 — telemetry must never surface an error to a customer.
 */

/** Outcomes worth a distinct log level. Anything else is treated as info. */
const FAILURE_OUTCOMES = new Set(['failed', 'abandoned']);

type Step = { t?: number; s?: string; d?: string };

const noContent = () => new NextResponse(null, { status: 204 });

/** Keep one line readable in the dashboard: "12ms sdk_loaded" etc. */
function renderTrail(trail: Step[]): string {
  return trail
    .slice(0, 40)
    .map((e) => {
      const at = typeof e.t === 'number' ? `${e.t}ms` : '?';
      const stage = String(e.s || '?').slice(0, 40);
      const detail = e.d ? ` (${String(e.d).slice(0, 160)})` : '';
      return `${at} ${stage}${detail}`;
    })
    .join(' → ');
}

export async function POST(request: NextRequest) {
  try {
    if (!rateLimit(`checkout-log:${getClientIp(request)}`, 30, 60_000)) {
      return noContent();
    }

    const raw = await request.text();
    if (!raw || raw.length > 16_000) return noContent();

    const body = JSON.parse(raw) as {
      outcome?: string;
      sessionId?: string;
      reason?: string;
      trail?: Step[];
    };

    const outcome = String(body.outcome || 'unknown').slice(0, 24);
    // Session id ties this back to the payment_sessions row, which is the whole
    // point — it turns an anonymous browser failure into "this customer".
    const session = String(body.sessionId || 'none').slice(0, 64);
    const reason = body.reason ? String(body.reason).slice(0, 240) : '';
    const trail = Array.isArray(body.trail) ? renderTrail(body.trail) : '';

    // The user agent is the server's own view of the caller — never trust a
    // client-supplied one, and it is the only way to spot a device-specific
    // failure (in-app browsers, old iOS Safari).
    const ua = (request.headers.get('user-agent') || 'unknown').slice(0, 200);

    const line =
      `[checkout] outcome=${outcome} session=${session}` +
      (reason ? ` reason="${reason}"` : '') +
      ` ua="${ua}"` +
      (trail ? ` trail: ${trail}` : '');

    if (FAILURE_OUTCOMES.has(outcome)) {
      console.error(line);
    } else {
      console.log(line);
    }
  } catch {
    /* Malformed report — never worth failing the request over. */
  }

  return noContent();
}
