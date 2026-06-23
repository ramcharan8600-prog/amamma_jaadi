/**
 * US Address Validation — Google Address Validation API
 *
 * Single source of truth for delivery-address validation, used by BOTH:
 *   - /api/address/validate   (frontend UX pre-check)
 *   - /api/payments/create-session (authoritative server-side gate)
 *
 * Cloudflare-compatible: uses only `fetch` + `btoa` (no Node built-ins).
 * The API key never leaves the server — the browser calls our route, not Google.
 *
 * Setup: enable "Address Validation API" in Google Cloud, then set
 *   GOOGLE_ADDRESS_VALIDATION_API_KEY in the environment.
 */

import { cache } from '@/lib/cache';
import type { AddressValidationResult, NormalizedAddress } from '@/types';

// Read at REQUEST time — on Cloudflare/OpenNext runtime secrets aren't populated
// at module load, so a module-scope read would be empty even when the key is set.
function getGoogleKey(): string {
  return process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY || '';
}
const ENDPOINT = 'https://addressvalidation.googleapis.com/v1:validateAddress';
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h — addresses don't change often

/**
 * Granularities precise enough to deliver to. Anything coarser (ROUTE, BLOCK,
 * OTHER) means we couldn't resolve to a specific building.
 */
const DELIVERABLE_GRANULARITY = new Set(['PREMISE', 'SUB_PREMISE']);

export interface AddressInput {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
}

export function isAddressValidationConfigured(): boolean {
  return !!getGoogleKey();
}

// ── Google response shapes (only the fields we consume) ──────────────────────
interface GoogleVerdict {
  validationGranularity?: string;
  addressComplete?: boolean;
  hasUnconfirmedComponents?: boolean;
  hasInferredComponents?: boolean;
  hasReplacedComponents?: boolean;
}
interface GooglePostalAddress {
  regionCode?: string;
  postalCode?: string;
  administrativeArea?: string;
  locality?: string;
  addressLines?: string[];
}
interface GoogleResult {
  verdict?: GoogleVerdict;
  address?: { formattedAddress?: string; postalAddress?: GooglePostalAddress };
  metadata?: { poBox?: boolean; residential?: boolean; business?: boolean };
  uspsData?: { dpvConfirmation?: string };
}
export interface GoogleAddressResponse {
  result?: GoogleResult;
  responseId?: string;
  error?: { code?: number; message?: string; status?: string };
}

function toNormalized(result: GoogleResult): NormalizedAddress {
  const pa = result.address?.postalAddress ?? {};
  const lines = pa.addressLines ?? [];
  return {
    formatted: result.address?.formattedAddress ?? '',
    addressLine1: lines[0] ?? '',
    addressLine2: lines.slice(1).join(', '),
    city: pa.locality ?? '',
    state: pa.administrativeArea ?? '',
    zip: pa.postalCode ?? '',
    country: 'US',
  };
}

/**
 * Pure interpreter — maps a Google response to our domain result.
 * Exported separately so it can be unit-tested with fixtures (no network).
 */
export function interpretGoogleResponse(raw: GoogleAddressResponse): AddressValidationResult {
  const result = raw.result;
  if (!result?.address?.postalAddress) {
    return {
      status: 'invalid',
      message: 'We could not recognize that address. Please check and try again.',
    };
  }

  const pa = result.address.postalAddress;
  const verdict = result.verdict ?? {};
  const meta = result.metadata ?? {};
  const usps = result.uspsData ?? {};

  // 1. Non-USA
  if ((pa.regionCode ?? '').toUpperCase() !== 'US') {
    return { status: 'invalid', message: 'Only U.S. delivery addresses are supported.' };
  }

  // 2. PO Box — not accepted for delivery
  if (meta.poBox) {
    return {
      status: 'invalid',
      message: 'PO Box addresses are not accepted for delivery. Please enter a street address.',
    };
  }

  // 3. Missing ZIP / City / State combination
  if (!pa.locality || !pa.administrativeArea || !pa.postalCode) {
    return {
      status: 'unconfirmed',
      message: 'Address is missing a city, state, or ZIP code. Please complete all fields.',
      normalized: toNormalized(result),
    };
  }

  // 4. USPS says undeliverable
  if (usps.dpvConfirmation === 'N') {
    return {
      status: 'invalid',
      message: 'This address could not be verified as deliverable. Please double-check it.',
    };
  }

  // 5. Not precise enough (e.g. missing house/building number)
  if (verdict.validationGranularity && !DELIVERABLE_GRANULARITY.has(verdict.validationGranularity)) {
    return {
      status: 'unconfirmed',
      message: 'We could not pinpoint that address. Please include a house or building number.',
      normalized: toNormalized(result),
    };
  }

  // 6. Components Google could not confirm
  if (verdict.hasUnconfirmedComponents) {
    return {
      status: 'unconfirmed',
      message: 'Some parts of the address could not be confirmed. Please review and correct them.',
      normalized: toNormalized(result),
    };
  }

  const normalized = toNormalized(result);

  // 7. Deliverable but Google adjusted it → ask the user to confirm
  if (verdict.hasInferredComponents || verdict.hasReplacedComponents) {
    return { status: 'corrected', normalized, requiresConfirmation: true };
  }

  // 8. Clean, confirmed, deliverable
  return { status: 'valid', normalized, requiresConfirmation: false };
}

function cacheKey(input: AddressInput): string {
  const canonical = [
    input.addressLine1,
    input.addressLine2 ?? '',
    input.city,
    input.state,
    input.zip,
  ]
    .map((s) => s.trim().toLowerCase())
    .join('|');
  // btoa works in Node 18+ and the Cloudflare Workers runtime.
  return `addr:v1:${btoa(unescape(encodeURIComponent(canonical)))}`;
}

/**
 * Validate a US address via Google. Cached by canonical input for 24h.
 * Never throws — failures resolve to a typed 'unavailable'/'invalid' result.
 */
export async function validateUsAddress(input: AddressInput): Promise<AddressValidationResult> {
  if (!isAddressValidationConfigured()) {
    console.error('[address-validation] GOOGLE_ADDRESS_VALIDATION_API_KEY not set — cannot validate');
    return {
      status: 'unavailable',
      message: 'Address validation is temporarily unavailable. Please try again later.',
    };
  }

  // Cheap presence check before spending an API call.
  if (!input.addressLine1?.trim() || !input.city?.trim() || !input.state?.trim() || !input.zip?.trim()) {
    return {
      status: 'unconfirmed',
      message: 'Please complete the street, city, state, and ZIP fields.',
    };
  }

  const key = cacheKey(input);
  const cached = await cache.get<AddressValidationResult>(key);
  if (cached) return cached;

  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(getGoogleKey())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: {
          regionCode: 'US',
          addressLines: [input.addressLine1, input.addressLine2].filter(Boolean),
          locality: input.city,
          administrativeArea: input.state,
          postalCode: input.zip,
        },
        enableUspsCass: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[address-validation] Google API ${res.status}: ${text.slice(0, 300)}`);
      return {
        status: 'unavailable',
        message: 'Address validation is temporarily unavailable. Please try again later.',
      };
    }

    const raw = (await res.json()) as GoogleAddressResponse;
    const result = interpretGoogleResponse(raw);

    // Cache deterministic interpretations only — never cache transient outages.
    if (result.status !== 'unavailable') {
      await cache.set(key, result, CACHE_TTL_SECONDS);
    }
    return result;
  } catch (e) {
    console.error('[address-validation] request failed:', e);
    return {
      status: 'unavailable',
      message: 'Address validation is temporarily unavailable. Please try again later.',
    };
  }
}
