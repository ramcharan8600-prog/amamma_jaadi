/**
 * Browser-side Square Web Payments helpers for checkout.
 *
 * Square's SDK (~480 KB) and its card iframe take about two seconds to set up.
 * Checkout warms them up while the customer fills in the details step, so the
 * payment step only has to attach the card form. Every step here is optional:
 * if warming fails or doesn't match the session, the payment step loads Square
 * itself, exactly as it did before.
 */

export type SquareEnvironment = 'production' | 'sandbox';

export interface SquarePublicConfig {
  appId: string;
  locationId: string;
  environment: SquareEnvironment;
}

export interface SquareWarmup extends SquarePublicConfig {
  payments: SquarePayments;
  /** A card form created ahead of time; the first payment step that uses it takes it (sets it to null). */
  card: Promise<SquareCard> | null;
}

export function squareSdkUrl(environment: SquareEnvironment): string {
  return environment === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js';
}

/**
 * Load the SDK once. A failed load removes its script tag, so a later call
 * (the payment step after a failed warm-up) starts a fresh download instead
 * of waiting on a tag that already errored.
 */
export function loadSquareSdk(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (window.Square) return resolve();
    const failed = (script: HTMLScriptElement) => {
      script.remove();
      reject(new Error('Square SDK failed to load'));
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') return failed(existing);
      existing.addEventListener('load', () => (window.Square ? resolve() : failed(existing)));
      existing.addEventListener('error', () => failed(existing));
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      if (window.Square) resolve();
      else failed(script);
    };
    script.onerror = () => failed(script);
    document.body.appendChild(script);
  });
}

/** Fetch the public Square config, load the SDK and start a card form. Never throws. */
export async function warmSquare(): Promise<SquareWarmup | null> {
  try {
    const res = await fetch('/api/payments/config', { cache: 'no-store' });
    const data = res.ok ? await res.json() : null;
    if (!data?.squareEnabled || !data.squareAppId || !data.squareLocationId) return null;
    const environment: SquareEnvironment = data.squareEnvironment === 'production' ? 'production' : 'sandbox';
    await loadSquareSdk(squareSdkUrl(environment));
    if (!window.Square) return null;
    const payments = window.Square.payments(data.squareAppId, data.squareLocationId);
    const card = payments.card();
    // A warm card that fails is rebuilt on the payment step; don't report it twice.
    card.catch(() => {});
    return { appId: data.squareAppId, locationId: data.squareLocationId, environment, payments, card };
  } catch {
    return null;
  }
}

/**
 * The warmed-up Square instance, if it matches this session's config. Waits at
 * most `waitMs` for a warm-up still in progress, then gives up so the payment
 * step can load Square itself.
 */
export async function takeWarmSquare(
  warm: Promise<SquareWarmup | null> | null,
  config: SquarePublicConfig,
  waitMs = 8000
): Promise<{ payments: SquarePayments; card: Promise<SquareCard> | null } | null> {
  if (!warm) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = await Promise.race([
    warm.catch(() => null),
    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), waitMs); }),
  ]);
  clearTimeout(timer);
  if (!ready || ready.appId !== config.appId || ready.locationId !== config.locationId ||
      ready.environment !== config.environment) return null;
  const card = ready.card;
  ready.card = null;
  return { payments: ready.payments, card };
}

/** Destroy a warm card nobody used (checkout closed before the payment step). */
export function discardWarmSquare(warm: Promise<SquareWarmup | null> | null): void {
  warm
    ?.then((ready) => {
      const card = ready?.card;
      if (ready) ready.card = null;
      return card;
    })
    .then((card) => card?.destroy())
    .catch(() => {});
}
