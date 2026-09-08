/** Only a checkout reference is stored in the browser, never a card/token. */
export const PENDING_PAYMENT_KEY = 'amamma-jaadi-pending-payment-v1';

export interface PendingPayment {
  sessionId: string;
  startedAt: number;
}

type PaymentOutcome =
  | { kind: 'completed'; orderNumber: string }
  | { kind: 'released'; message: string }
  | { kind: 'pending'; message: string };

export const PAYMENT_PENDING_MESSAGE =
  'We are confirming your existing payment. Please do not place another order or pay again. You can safely check this same payment below.';

export function readPendingPayment(storage: Pick<Storage, 'getItem'>): PendingPayment | null {
  const raw = storage.getItem(PENDING_PAYMENT_KEY);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('sessionId' in value) ||
      typeof value.sessionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.sessionId) ||
      !('startedAt' in value) || typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt)) {
    // Fail closed: corrupt recovery state is not proof there was no payment.
    throw new Error('The saved payment reference could not be read. Please contact us before paying again.');
  }
  return { sessionId: value.sessionId, startedAt: value.startedAt };
}

export function rememberPendingPayment(storage: Storage, sessionId: string): PendingPayment {
  const existing = readPendingPayment(storage);
  if (existing && existing.sessionId !== sessionId) {
    throw new Error('An earlier payment still needs confirmation. Please check that payment first.');
  }
  const value = existing ?? { sessionId, startedAt: Date.now() };
  storage.setItem(PENDING_PAYMENT_KEY, JSON.stringify(value));
  if (readPendingPayment(storage)?.sessionId !== sessionId) {
    throw new Error('Your browser could not save the payment reference. Please enable website storage before paying.');
  }
  return value;
}

export function forgetPendingPayment(storage: Storage, sessionId: string): void {
  // A late response from another tab must not clear a newer payment reference.
  if (readPendingPayment(storage)?.sessionId === sessionId) storage.removeItem(PENDING_PAYMENT_KEY);
}

export async function claimPendingPayment(storage: Storage, sessionId: string, locks?: LockManager): Promise<PendingPayment> {
  // Web Locks serialize competing tabs; older browsers retain the saved-ref
  // guard. The server independently serializes all attempts for one session.
  if (locks) return locks.request(PENDING_PAYMENT_KEY, () => rememberPendingPayment(storage, sessionId));
  return rememberPendingPayment(storage, sessionId);
}

export async function requestPaymentStatus(path: string, body: object, timeoutMs = 25_000): Promise<{ status: number; body: unknown }> {
  // AbortSignal.timeout is absent from some otherwise supported Safari builds.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    const data: unknown = await response.json().catch(() => null);
    return { status: response.status, body: data };
  } finally {
    clearTimeout(timer);
  }
}

export function classifyPaymentOutcome(status: number, body: unknown): PaymentOutcome {
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  if (status === 200 && data.success === true && data.status === 'completed' &&
      typeof data.orderNumber === 'string' && /^AJ-\d+$/.test(data.orderNumber)) {
    return { kind: 'completed', orderNumber: data.orderNumber };
  }
  const confirmedDecline = status === 402 && data.code === 'PAYMENT_DECLINED' && data.status === 'declined';
  const safelyExpired = (status === 409 || status === 200) && data.code === 'SESSION_EXPIRED' && data.status === 'expired';
  if (data.canStartNewSession === true && (confirmedDecline || safelyExpired)) {
    return {
      kind: 'released',
      message: typeof data.error === 'string' ? data.error : 'Please review your details and start a new payment attempt.',
    };
  }
  // A network failure, 5xx, generic 409, bad JSON, or missing fields never
  // authorizes another charge. Only the explicit terminal contracts above do.
  return {
    kind: 'pending',
    message: typeof data.error === 'string' &&
      ['PAYMENT_PENDING', 'PAYMENT_REVIEW_REQUIRED', 'ORDER_FINALIZING'].includes(String(data.code))
      ? data.error : PAYMENT_PENDING_MESSAGE,
  };
}
