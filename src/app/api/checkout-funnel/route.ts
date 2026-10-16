import { NextRequest, NextResponse } from 'next/server';
import { getDb, isDbConfigured } from '@/lib/db';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { parseFunnelReport, recordFunnelStep } from '@/lib/checkout-funnel';

const noContent = () => new NextResponse(null, { status: 204 });

/**
 * POST /api/checkout-funnel — { visitId, step, detail? } from the checkout page.
 *
 * Public and unauthenticated like /api/checkout-log, so it is rate limited,
 * size capped, accepts only known steps and short codes, writes at most one
 * row per checkout and step, and always answers 204: tracking must never
 * surface an error to a customer.
 */
export async function POST(request: NextRequest) {
  try {
    if (!rateLimit(`checkout-funnel:${getClientIp(request)}`, 60, 60_000)) return noContent();
    const raw = await request.text();
    if (!raw || raw.length > 512) return noContent();
    const report = parseFunnelReport(JSON.parse(raw));
    if (!report || !isDbConfigured()) return noContent();
    await recordFunnelStep(getDb(), report.visitId, report.step, report.detail);
  } catch (e) {
    console.error('Checkout funnel record error:', e);
  }
  return noContent();
}
