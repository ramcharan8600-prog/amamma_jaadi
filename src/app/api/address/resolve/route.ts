import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { isPlaceId, isSessionToken, resolveAddress } from '@/lib/address-autocomplete';
import { getPlacesApiKey, isSameOriginRequest } from '@/lib/places-key';

/**
 * POST /api/address/resolve — { placeId, sessionToken } → { address } for the
 * suggestion the customer tapped. `address: null` means "fill it in by hand".
 */
export async function POST(request: NextRequest) {
  const none = NextResponse.json({ address: null });
  try {
    const apiKey = getPlacesApiKey();
    if (!apiKey || !isSameOriginRequest(request)) return none;
    if (!rateLimit(`address-resolve:${getClientIp(request)}`, 20, 60_000)) return none;
    const body = await request.json().catch(() => null) as { placeId?: unknown; sessionToken?: unknown } | null;
    if (!isPlaceId(body?.placeId) || !isSessionToken(body?.sessionToken)) return none;
    return NextResponse.json({ address: await resolveAddress(body.placeId, body.sessionToken, apiKey) });
  } catch (e) {
    console.error('Address resolve error:', e instanceof Error ? e.message : e);
    return none;
  }
}
