// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discardWarmSquare, loadSquareSdk, squareSdkUrl, takeWarmSquare, type SquareWarmup } from '@/lib/square-client';

const URL_SANDBOX = squareSdkUrl('sandbox');
const tags = () => document.querySelectorAll(`script[src="${URL_SANDBOX}"]`);
const fakeSquare = { payments: () => ({}) } as unknown as SquareSDK;

afterEach(() => {
  document.querySelectorAll('script').forEach((s) => s.remove());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('squareSdkUrl', () => {
  it('picks the production or sandbox SDK', () => {
    expect(squareSdkUrl('production')).toBe('https://web.squarecdn.com/v1/square.js');
    expect(URL_SANDBOX).toBe('https://sandbox.web.squarecdn.com/v1/square.js');
  });
});

describe('loadSquareSdk', () => {
  it('resolves straight away once Square is on the page', async () => {
    vi.stubGlobal('Square', fakeSquare);
    await expect(loadSquareSdk(URL_SANDBOX)).resolves.toBeUndefined();
    expect(tags()).toHaveLength(0);
  });

  it('shares one script tag between the warm-up and the payment step', async () => {
    const first = loadSquareSdk(URL_SANDBOX);
    const second = loadSquareSdk(URL_SANDBOX);
    expect(tags()).toHaveLength(1);
    vi.stubGlobal('Square', fakeSquare);
    tags()[0].dispatchEvent(new Event('load'));
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('removes a script that failed, so the next attempt downloads it again', async () => {
    const first = loadSquareSdk(URL_SANDBOX);
    const waiting = loadSquareSdk(URL_SANDBOX);
    tags()[0].dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow('Square SDK failed to load');
    await expect(waiting).rejects.toThrow('Square SDK failed to load');
    expect(tags()).toHaveLength(0);
    const retry = loadSquareSdk(URL_SANDBOX);
    expect(tags()).toHaveLength(1);
    vi.stubGlobal('Square', fakeSquare);
    tags()[0].dispatchEvent(new Event('load'));
    await expect(retry).resolves.toBeUndefined();
  });

  it('treats a script that loaded without defining Square as failed', async () => {
    const attempt = loadSquareSdk(URL_SANDBOX);
    tags()[0].dispatchEvent(new Event('load'));
    await expect(attempt).rejects.toThrow('Square SDK failed to load');
    expect(tags()).toHaveLength(0);
  });
});

describe('takeWarmSquare', () => {
  const config = { appId: 'app', locationId: 'loc', environment: 'sandbox' as const };
  const warmup = (overrides: Partial<SquareWarmup> = {}): SquareWarmup => ({
    ...config,
    payments: {} as SquarePayments,
    card: Promise.resolve({ destroy: vi.fn(async () => undefined) } as unknown as SquareCard),
    ...overrides,
  });

  it('hands over the warm card once; later calls get only the payments instance', async () => {
    const warm = Promise.resolve(warmup());
    const first = await takeWarmSquare(warm, config);
    expect(first?.card).not.toBeNull();
    const second = await takeWarmSquare(warm, config);
    expect(second?.payments).toBe(first?.payments);
    expect(second?.card).toBeNull();
  });

  it.each([
    ['app id', { appId: 'other' }],
    ['location', { locationId: 'other' }],
    ['environment', { environment: 'production' as const }],
  ])('ignores a warm-up with a different %s', async (_field, overrides) => {
    expect(await takeWarmSquare(Promise.resolve(warmup(overrides)), config)).toBeNull();
  });

  it('ignores a missing, failed or rejected warm-up', async () => {
    expect(await takeWarmSquare(null, config)).toBeNull();
    expect(await takeWarmSquare(Promise.resolve(null), config)).toBeNull();
    expect(await takeWarmSquare(Promise.reject(new Error('boom')), config)).toBeNull();
  });

  it('stops waiting for a slow warm-up so the payment step can load Square itself', async () => {
    vi.useFakeTimers();
    const pending = takeWarmSquare(new Promise<SquareWarmup | null>(() => {}), config, 8000);
    await vi.advanceTimersByTimeAsync(8000);
    await expect(pending).resolves.toBeNull();
  });
});

describe('discardWarmSquare', () => {
  it('destroys a card nobody used, and leaves a taken card alone', async () => {
    const unusedDestroy = vi.fn(async () => undefined);
    discardWarmSquare(Promise.resolve({
      appId: 'a', locationId: 'l', environment: 'sandbox', payments: {} as SquarePayments,
      card: Promise.resolve({ destroy: unusedDestroy } as unknown as SquareCard),
    }));
    await vi.waitFor(() => expect(unusedDestroy).toHaveBeenCalledTimes(1));

    const takenDestroy = vi.fn(async () => undefined);
    const taken: SquareWarmup = {
      appId: 'a', locationId: 'l', environment: 'sandbox', payments: {} as SquarePayments,
      card: Promise.resolve({ destroy: takenDestroy } as unknown as SquareCard),
    };
    await takeWarmSquare(Promise.resolve(taken), { appId: 'a', locationId: 'l', environment: 'sandbox' });
    discardWarmSquare(Promise.resolve(taken));
    await new Promise((r) => setTimeout(r, 0));
    expect(takenDestroy).not.toHaveBeenCalled();
  });

  it('ignores a missing or failed warm-up', () => {
    expect(() => discardWarmSquare(null)).not.toThrow();
    expect(() => discardWarmSquare(Promise.reject(new Error('boom')))).not.toThrow();
  });
});
