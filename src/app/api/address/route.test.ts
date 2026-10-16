import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as suggest } from './suggest/route';
import { POST as resolve } from './resolve/route';

const TOKEN = '0b6c7f9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f';
const PLACE = 'ChIJ5YQQf1GHhYARPKG7WLIaOko';
const google = vi.fn(async (url: string) => url.includes(':autocomplete')
  ? Response.json({ suggestions: [{ placePrediction: { placeId: PLACE, structuredFormat: { mainText: { text: '123 Main St' }, secondaryText: { text: 'Plano, TX, USA' } } } }] })
  : Response.json({ addressComponents: [
    { longText: '123', types: ['street_number'] }, { shortText: 'Main St', types: ['route'] },
    { longText: 'Plano', types: ['locality'] }, { shortText: 'TX', types: ['administrative_area_level_1'] },
    { longText: '75093', types: ['postal_code'] },
  ] }));

beforeEach(() => {
  vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
  vi.stubGlobal('fetch', google);
  google.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

let ip = 0;
const call = (handler: (request: NextRequest) => Promise<Response>, body: unknown, origin = 'https://shop.test') =>
  handler(new NextRequest('https://shop.test/api/address', {
    method: 'POST',
    headers: { origin, 'cf-connecting-ip': `203.0.113.${++ip}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));

it('suggests addresses and resolves the tapped one for our own checkout page', async () => {
  const s = await (await call(suggest, { input: '123 Main', sessionToken: TOKEN })).json();
  expect(s).toEqual({ enabled: true, suggestions: [{ placeId: PLACE, main: '123 Main St', secondary: 'Plano, TX, USA' }] });
  const r = await (await call(resolve, { placeId: PLACE, sessionToken: TOKEN })).json();
  expect(r.address).toEqual({ line1: '123 Main St', line2: '', city: 'Plano', state: 'TX', zip: '75093' });
  expect(google).toHaveBeenCalledTimes(2);
});

it('is off without the key, and never calls Google for other sites, short input or bad tokens', async () => {
  vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
  expect(await (await call(suggest, { input: '123 Main', sessionToken: TOKEN })).json()).toEqual({ enabled: false, suggestions: [] });
  expect((await (await call(resolve, { placeId: PLACE, sessionToken: TOKEN })).json()).address).toBeNull();
  vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
  for (const [body, origin] of [
    [{ input: '123 Main', sessionToken: TOKEN }, 'https://evil.test'],
    [{ input: '12', sessionToken: TOKEN }, undefined],
    [{ input: '123 Main', sessionToken: 'not-a-token' }, undefined],
  ] as const) {
    expect((await (await call(suggest, body, origin)).json()).suggestions).toEqual([]);
  }
  expect((await (await call(resolve, { placeId: '../../x', sessionToken: TOKEN })).json()).address).toBeNull();
  expect(google).not.toHaveBeenCalled();
});

it('answers with no suggestions when Google fails, so checkout carries on', async () => {
  google.mockImplementationOnce(async () => new Response('quota', { status: 429 }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(await (await call(suggest, { input: '123 Main', sessionToken: TOKEN })).json()).toEqual({ enabled: true, suggestions: [] });
});
