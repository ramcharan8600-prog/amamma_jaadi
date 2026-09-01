import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * POST /api/csp-report
 *
 * Collector for browser CSP violation reports. Exists so a blocked resource on
 * a *real customer's* device becomes a log line we can read, instead of an
 * invisible failure we have to guess at from support messages.
 *
 * Deliberately cheap and boring:
 *  - never touches D1 — this endpoint is unauthenticated and public, so a
 *    database write here would be a free way for anyone to flood the store's
 *    only database. `console.error` lands in Cloudflare's observability logs
 *    (already enabled in wrangler.jsonc), which is all we need.
 *  - rate limited per IP, since a single wedged page can emit hundreds.
 *  - only logs directives we actually care about; browser extensions inject
 *    scripts constantly and would otherwise bury the real signal.
 *  - always returns 204, even on malformed input. A violation report is
 *    telemetry, and telemetry must never surface an error to the customer.
 */

/** Directives worth waking up for. Everything else is almost always noise. */
const DIRECTIVES_OF_INTEREST = ['frame-src', 'child-src', 'connect-src', 'script-src', 'font-src'];

/** Browsers send either the legacy `csp-report` shape or the modern array. */
type LegacyReport = {
  'csp-report'?: {
    'effective-directive'?: string;
    'violated-directive'?: string;
    'blocked-uri'?: string;
    'document-uri'?: string;
  };
};
type ModernReport = {
  type?: string;
  body?: { effectiveDirective?: string; blockedURL?: string; documentURL?: string };
};

const noContent = () => new NextResponse(null, { status: 204 });

export async function POST(request: NextRequest) {
  try {
    if (!rateLimit(`csp-report:${getClientIp(request)}`, 20, 60_000)) {
      return noContent();
    }

    // Cap the body: this is public, and we never need more than a few KB.
    const raw = await request.text();
    if (!raw || raw.length > 8_000) return noContent();

    const parsed: unknown = JSON.parse(raw);
    const entries: Array<LegacyReport | ModernReport> = Array.isArray(parsed) ? parsed : [parsed];

    for (const entry of entries) {
      const legacy = (entry as LegacyReport)['csp-report'];
      const modern = (entry as ModernReport).body;

      const directive =
        legacy?.['effective-directive'] || legacy?.['violated-directive'] || modern?.effectiveDirective || '';
      const blocked = legacy?.['blocked-uri'] || modern?.blockedURL || '';
      const document = legacy?.['document-uri'] || modern?.documentURL || '';

      // `directive` can arrive as "frame-src 'self' https:" — match the name only.
      const name = directive.split(/\s+/)[0];
      if (!DIRECTIVES_OF_INTEREST.includes(name)) continue;

      console.error(
        `[csp-violation] directive=${name} blocked=${blocked || '(none)'} page=${document || '(unknown)'}`
      );
    }
  } catch {
    /* Malformed report — nothing to do, and never worth failing the request. */
  }

  return noContent();
}
