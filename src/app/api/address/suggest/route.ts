import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { cleanAddressInput, isSessionToken, suggestAddresses } from '@/lib/address-autocomplete';
import { getPlacesApiKey, isSameOriginRequest } from '@/lib/places-key';

/**
 * POST /api/address/suggest — { input, sessionToken } → { enabled, suggestions }.
 * Never fails checkout: errors, limits and a missing key all answer with no
 * suggestions, and the customer keeps typing the address by hand.
 */
export async function POST(request: NextRequest) {
  const apiKey = getPlacesApiKey();
  if (!apiKey) return NextResponse.json({ enabled: false, suggestions: [] });
  const none = NextResponse.json({ enabled: true, suggestions: [] });
  try {
    if (!isSameOriginRequest(request)) return none;
    if (!rateLimit(`address-suggest:${getClientIp(request)}`, 60, 60_000)) return none;
    const body = await request.json().catch(() => null) as { input?: unknown; sessionToken?: unknown } | null;
    const input = cleanAddressInput(body?.input);
    if (!input || !isSessionToken(body?.sessionToken)) return none;
    const suggestions = await suggestAddresses(input, body.sessionToken, apiKey);
    return NextResponse.json({ enabled: true, suggestions });
  } catch (e) {
    console.error('Address suggest error:', e instanceof Error ? e.message : e);
    return none;
  }
}
