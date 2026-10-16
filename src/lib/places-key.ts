import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * GOOGLE_PLACES_API_KEY, a Worker secret (the repo is public). Undefined turns
 * address suggestions off. Kept apart from address-autocomplete.ts so the
 * checkout page can import that file's constants without bundling this.
 */
export function getPlacesApiKey(): string | undefined {
  let cf: Record<string, unknown> = {};
  try {
    cf = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    // Outside a request (build, tests): process.env only.
  }
  const key = cf.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY;
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

/** Only our own checkout page may spend the Google quota. */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/** The shopper's approximate location from Cloudflare (city level), or null. */
export function visitorLocation(): { latitude: number; longitude: number } | null {
  try {
    const cf = getCloudflareContext().cf as { latitude?: string; longitude?: string; country?: string } | undefined;
    const latitude = Number(cf?.latitude);
    const longitude = Number(cf?.longitude);
    if (cf?.country !== 'US' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
}
