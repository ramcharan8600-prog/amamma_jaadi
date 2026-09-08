// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentRecoveryPanel from './PaymentRecoveryPanel';

const payment = { sessionId: '11111111-1111-4111-8111-111111111111', startedAt: 1 };
let root: Root;
let host: HTMLDivElement;
const onCompleted = vi.fn();
const onReleased = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  onCompleted.mockReset();
  onReleased.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(submitting = false) {
  await act(async () => root.render(createElement(PaymentRecoveryPanel, { payment, submitting, onCompleted, onReleased })));
}

describe('payment recovery UI', () => {
  it('checks the saved reference on reload and completes without another payment request', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, status: 'completed', orderNumber: 'AJ-1234' }));
    vi.stubGlobal('fetch', fetch);
    await render();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/payments/verify');
    expect(onCompleted).toHaveBeenCalledWith(payment.sessionId, 'AJ-1234');
    expect(onReleased).not.toHaveBeenCalled();
  });
  it('does not race the original in-flight submission', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await render(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(host.querySelector('button')?.disabled).toBe(true);
  });
  it('keeps checkout recoverable after network loss and retries only the original attempt', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('network lost'))
      .mockResolvedValueOnce(Response.json({ status: 'unknown', code: 'PAYMENT_PENDING' }, { status: 202 }));
    vi.stubGlobal('fetch', fetch);
    await render();
    expect(host.textContent).toContain('do not submit a new payment');
    await act(async () => host.querySelector('button')!.click());
    expect(fetch.mock.calls[1][0]).toBe('/api/payments/create-payment');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ sessionId: payment.sessionId, retry: true });
    expect(onCompleted).not.toHaveBeenCalled();
    expect(onReleased).not.toHaveBeenCalled();
  });
  it('does not release on generic 409 or malformed response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Invalid session' }, { status: 409 })));
    await render();
    expect(onReleased).not.toHaveBeenCalled();
    expect(host.textContent).toContain('do not place another order');
  });
  it('releases a confirmed decline for explicit customer retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'declined', code: 'PAYMENT_DECLINED', canStartNewSession: true, error: 'Card declined' }, { status: 402 })));
    await render();
    expect(onReleased).toHaveBeenCalledWith(payment.sessionId, 'Card declined');
  });
  it('ignores a stale result after the recovery panel unmounts', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(resolve => { finish = resolve; })));
    await render();
    await act(async () => root.render(null));
    await act(async () => finish(Response.json({ success: true, status: 'completed', orderNumber: 'AJ-1234' })));
    expect(onCompleted).not.toHaveBeenCalled();
    expect(onReleased).not.toHaveBeenCalled();
  });
});
