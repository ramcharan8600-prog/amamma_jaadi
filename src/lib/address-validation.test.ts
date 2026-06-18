import { describe, it, expect } from 'vitest';
import { interpretGoogleResponse, type GoogleAddressResponse } from '@/lib/address-validation';

/** Build a Google response with a deliverable base, overridable per-test. */
function googleResponse(overrides: Partial<GoogleAddressResponse['result']> = {}): GoogleAddressResponse {
  return {
    result: {
      verdict: { validationGranularity: 'PREMISE', addressComplete: true },
      address: {
        formattedAddress: '3310 N Central Expy, Plano, TX 75074, USA',
        postalAddress: {
          regionCode: 'US',
          postalCode: '75074',
          administrativeArea: 'TX',
          locality: 'Plano',
          addressLines: ['3310 N Central Expy'],
        },
      },
      metadata: {},
      uspsData: { dpvConfirmation: 'Y' },
      ...overrides,
    },
  };
}

describe('interpretGoogleResponse', () => {
  it('accepts a clean, confirmed US address as valid', () => {
    const r = interpretGoogleResponse(googleResponse());
    expect(r.status).toBe('valid');
    if (r.status === 'valid') {
      expect(r.requiresConfirmation).toBe(false);
      expect(r.normalized.state).toBe('TX');
      expect(r.normalized.zip).toBe('75074');
      expect(r.normalized.country).toBe('US');
    }
  });

  it('flags an inferred/replaced address as corrected (needs confirmation)', () => {
    const r = interpretGoogleResponse(
      googleResponse({ verdict: { validationGranularity: 'PREMISE', hasInferredComponents: true } })
    );
    expect(r.status).toBe('corrected');
    if (r.status === 'corrected') expect(r.requiresConfirmation).toBe(true);
  });

  it('rejects PO boxes', () => {
    const r = interpretGoogleResponse(googleResponse({ metadata: { poBox: true } }));
    expect(r.status).toBe('invalid');
    expect((r as { message: string }).message).toMatch(/PO Box/i);
  });

  it('rejects non-US addresses', () => {
    const r = interpretGoogleResponse(
      googleResponse({
        address: {
          formattedAddress: '1 Yonge St, Toronto, ON, Canada',
          postalAddress: {
            regionCode: 'CA',
            postalCode: 'M5E',
            administrativeArea: 'ON',
            locality: 'Toronto',
            addressLines: ['1 Yonge St'],
          },
        },
      })
    );
    expect(r.status).toBe('invalid');
    expect((r as { message: string }).message).toMatch(/U\.S\./i);
  });

  it('marks a missing ZIP/city/state as unconfirmed', () => {
    const r = interpretGoogleResponse(
      googleResponse({
        address: {
          formattedAddress: '3310 N Central Expy, TX, USA',
          postalAddress: {
            regionCode: 'US',
            administrativeArea: 'TX',
            locality: 'Plano',
            addressLines: ['3310 N Central Expy'],
            // postalCode missing
          },
        },
      })
    );
    expect(r.status).toBe('unconfirmed');
  });

  it('rejects USPS-undeliverable addresses (dpvConfirmation N)', () => {
    const r = interpretGoogleResponse(googleResponse({ uspsData: { dpvConfirmation: 'N' } }));
    expect(r.status).toBe('invalid');
  });

  it('treats coarse granularity (ROUTE) as unconfirmed', () => {
    const r = interpretGoogleResponse(
      googleResponse({ verdict: { validationGranularity: 'ROUTE' } })
    );
    expect(r.status).toBe('unconfirmed');
  });

  it('treats unconfirmed components as unconfirmed', () => {
    const r = interpretGoogleResponse(
      googleResponse({ verdict: { validationGranularity: 'PREMISE', hasUnconfirmedComponents: true } })
    );
    expect(r.status).toBe('unconfirmed');
  });

  it('rejects an empty/unparseable response', () => {
    expect(interpretGoogleResponse({}).status).toBe('invalid');
    expect(interpretGoogleResponse({ result: {} }).status).toBe('invalid');
  });
});
