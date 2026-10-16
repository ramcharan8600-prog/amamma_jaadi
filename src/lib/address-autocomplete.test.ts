import { describe, expect, it, vi } from 'vitest';
import { cleanAddressInput, resolveAddress, suggestAddresses, toDeliveryAddress } from './address-autocomplete';

const TOKEN = '0b6c7f9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f';
const PLACE = 'ChIJ5YQQf1GHhYARPKG7WLIaOko';

describe('suggestAddresses', () => {
  it('asks Google for US street addresses in one billing session and keeps the street and city lines', async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ suggestions: [
      { placePrediction: { placeId: PLACE, text: { text: '123 Main St, Plano, TX, USA' },
        structuredFormat: { mainText: { text: '123 Main St' }, secondaryText: { text: 'Plano, TX, USA' } } } },
      { placePrediction: { placeId: 'bad id!' } },
      { queryPrediction: { text: { text: 'main street' } } },
    ] }));
    const list = await suggestAddresses('123 Main', TOKEN, 'test-key', fetchImpl);
    expect(list).toEqual([{ placeId: PLACE, main: '123 Main St', secondary: 'Plano, TX, USA' }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect((init?.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-key');
    expect(JSON.parse(String(init?.body))).toEqual({
      input: '123 Main', sessionToken: TOKEN, includedRegionCodes: ['us'],
      includedPrimaryTypes: ['street_address', 'premise', 'subpremise'], languageCode: 'en',
    });
  });

  it("ranks addresses near the shopper first when Cloudflare knows roughly where they are", async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ suggestions: [] }));
    await suggestAddresses('123 Main', TOKEN, 'k', fetchImpl, { latitude: 33.02, longitude: -96.7 });
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).locationBias).toEqual({
      circle: { center: { latitude: 33.02, longitude: -96.7 }, radius: 50_000 },
    });
  });

  it('throws on a Google error so the route can answer with no suggestions', async () => {
    await expect(suggestAddresses('123 Main', TOKEN, 'k', async () => new Response('denied', { status: 403 }))).rejects.toThrow('HTTP 403');
  });
});

describe('resolveAddress', () => {
  it('closes the session with an Essentials-only details call and fills the delivery form', async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ addressComponents: [
      { longText: '204', shortText: '204', types: ['subpremise'] },
      { longText: '123', shortText: '123', types: ['street_number'] },
      { longText: 'Main Street', shortText: 'Main St', types: ['route'] },
      { longText: 'Plano', shortText: 'Plano', types: ['locality', 'political'] },
      { longText: 'Texas', shortText: 'TX', types: ['administrative_area_level_1', 'political'] },
      { longText: '75093', shortText: '75093', types: ['postal_code'] },
      { longText: 'United States', shortText: 'US', types: ['country', 'political'] },
    ] }));
    expect(await resolveAddress(PLACE, TOKEN, 'test-key', fetchImpl)).toEqual({
      line1: '123 Main St', line2: '#204', city: 'Plano', state: 'TX', zip: '75093',
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://places.googleapis.com/v1/places/${PLACE}?sessionToken=${TOKEN}&languageCode=en`);
    expect((init?.headers as Record<string, string>)['X-Goog-FieldMask']).toBe('addressComponents');
  });
});

describe('toDeliveryAddress', () => {
  it('uses a neighbourhood when there is no city, and leaves out a missing ZIP', () => {
    expect(toDeliveryAddress([
      { longText: '9', types: ['street_number'] },
      { longText: 'Oak Lane', shortText: 'Oak Ln', types: ['route'] },
      { longText: 'Flushing', types: ['sublocality_level_1'] },
      { shortText: 'NY', types: ['administrative_area_level_1'] },
    ])).toEqual({ line1: '9 Oak Ln', line2: '', city: 'Flushing', state: 'NY', zip: '' });
  });

  it('refuses addresses outside the US or without a street', () => {
    expect(toDeliveryAddress([
      { longText: '1', types: ['street_number'] }, { longText: 'Yonge St', types: ['route'] },
      { shortText: 'CA', types: ['country'] },
    ])).toBeNull();
    expect(toDeliveryAddress([{ longText: 'Dallas', types: ['locality'] }])).toBeNull();
  });
});

it('only looks up 4 to 120 characters of real input', () => {
  expect(cleanAddressInput('  12  Ma ')).toBe('12 Ma');
  expect(cleanAddressInput('12')).toBeNull();
  expect(cleanAddressInput('x'.repeat(121))).toBeNull();
  expect(cleanAddressInput(42)).toBeNull();
});
