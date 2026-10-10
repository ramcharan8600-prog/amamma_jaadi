// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toBusinessDateString } from '@/lib/date';
import SoldOutDatesPanel from './SoldOutDatesPanel';

let dates: string[];
const today = toBusinessDateString(new Date());
const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
  if (init?.method === 'POST' || init?.method === 'DELETE') {
    const { date } = JSON.parse(String(init.body));
    dates = init.method === 'POST' ? [...new Set([...dates, date])].sort() : dates.filter((d) => d !== date);
  }
  return Response.json({ dates });
});

beforeEach(() => {
  dates = [];
  fetchMock.mockClear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it('marks today sold out in one tap, lists it, and reopens it', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
  try {
    await act(async () => root.render(createElement(SoldOutDatesPanel)));
    expect(host.textContent).toContain('No dates are sold out.');

    await act(async () => button('Mark today sold out').click());
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]!.body))).toEqual({ date: today });
    expect(fetchMock.mock.calls.at(-1)![1]!.method).toBe('POST');
    expect(button('Today is sold out').disabled).toBe(true);
    const list = host.querySelector('ul[aria-label="Sold-out dates"]')!;
    expect(list.textContent).toContain('(today)');
    expect(list.textContent).toContain('Sold out');

    await act(async () => button('Reopen').click());
    expect(fetchMock.mock.calls.at(-1)![1]!.method).toBe('DELETE');
    expect(host.textContent).toContain('No dates are sold out.');
    expect(button('Mark today sold out').disabled).toBe(false);

    const input = host.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(input.min).toBe(today);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
