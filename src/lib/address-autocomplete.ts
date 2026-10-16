/**
 * US delivery address suggestions from Google Places API (New), called from
 * our Worker so the key stays a secret and the checkout page loads no Google
 * code. Each typing session shares one session token and ends with a single
 * Place Details call asking only for addressComponents (Essentials SKU), so a
 * looked-up address costs at most 12 suggestion requests + 1 details request.
 *
 * Without GOOGLE_PLACES_API_KEY the feature is off and checkout behaves as before.
 */

export interface AddressSuggestion {
  placeId: string;
  /** "123 Main St" */
  main: string;
  /** "Plano, TX, USA" */
  secondary: string;
}

export interface ResolvedAddress {
  line1: string;
  line2: string;
  city: string;
  /** Two-letter code, e.g. "TX". */
  state: string;
  zip: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_URL = 'https://places.googleapis.com/v1/places/';

const SESSION_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
export const MIN_ADDRESS_INPUT = 4;
export const MAX_ADDRESS_INPUT = 120;

export function isSessionToken(value: unknown): value is string {
  return typeof value === 'string' && SESSION_TOKEN.test(value);
}

export function isPlaceId(value: unknown): value is string {
  return typeof value === 'string' && PLACE_ID.test(value);
}

/** Trimmed input worth a lookup, or null. */
export function cleanAddressInput(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const input = value.replace(/\s+/g, ' ').trim();
  return input.length >= MIN_ADDRESS_INPUT && input.length <= MAX_ADDRESS_INPUT ? input : null;
}

/** Up to five US street-address suggestions for what the customer has typed. */
export async function suggestAddresses(
  input: string,
  sessionToken: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<AddressSuggestion[]> {
  const res = await fetchImpl(AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat',
    },
    body: JSON.stringify({
      input,
      sessionToken,
      includedRegionCodes: ['us'],
      includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
      languageCode: 'en',
    }),
  });
  if (!res.ok) throw new Error(`Places autocomplete failed: HTTP ${res.status}`);
  const data = await res.json() as {
    suggestions?: Array<{ placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    } }>;
  };
  const suggestions: AddressSuggestion[] = [];
  for (const { placePrediction: p } of data.suggestions ?? []) {
    if (!p || !isPlaceId(p.placeId)) continue;
    const main = p.structuredFormat?.mainText?.text ?? p.text?.text ?? '';
    if (!main) continue;
    suggestions.push({ placeId: p.placeId, main, secondary: p.structuredFormat?.secondaryText?.text ?? '' });
  }
  return suggestions.slice(0, 5);
}

type AddressComponent = { longText?: string; shortText?: string; types?: string[] };

/** Turn Google's address components into our delivery form fields. */
export function toDeliveryAddress(components: AddressComponent[]): ResolvedAddress | null {
  const find = (...types: string[]) => {
    for (const type of types) {
      const hit = components.find((c) => c.types?.includes(type));
      if (hit) return hit;
    }
    return undefined;
  };
  const number = find('street_number')?.longText ?? '';
  const route = find('route')?.shortText ?? find('route')?.longText ?? '';
  const unit = find('subpremise')?.longText ?? '';
  const city = find('locality', 'postal_town', 'sublocality_level_1', 'sublocality', 'neighborhood', 'administrative_area_level_3')?.longText ?? '';
  const state = find('administrative_area_level_1')?.shortText ?? '';
  const zip = find('postal_code')?.longText ?? '';
  const country = find('country')?.shortText ?? '';
  if (country && country !== 'US') return null;
  const line1 = [number, route].filter(Boolean).join(' ');
  if (!line1) return null;
  return {
    line1,
    line2: unit ? (/^[A-Za-z]/.test(unit) ? unit : `#${unit}`) : '',
    city,
    state: /^[A-Z]{2}$/.test(state) ? state : '',
    zip: /^\d{5}$/.test(zip) ? zip : '',
  };
}

/** The chosen suggestion's address; this call closes the billing session. */
export async function resolveAddress(
  placeId: string,
  sessionToken: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<ResolvedAddress | null> {
  const url = `${DETAILS_URL}${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}&languageCode=en`;
  const res = await fetchImpl(url, {
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'addressComponents' },
  });
  if (!res.ok) throw new Error(`Places details failed: HTTP ${res.status}`);
  const data = await res.json() as { addressComponents?: AddressComponent[] };
  return toDeliveryAddress(data.addressComponents ?? []);
}
