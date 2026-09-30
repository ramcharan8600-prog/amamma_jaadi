// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import InventoryPanel from './InventoryPanel';

it('allows an admin to save an independent stock count for Gongura Chicken', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => Response.json({
    stock: { 'pickle-gongura-chicken': init?.method === 'PATCH' ? 3 : 0 },
  }));
  vi.stubGlobal('fetch', fetchMock);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(InventoryPanel)));
    const label = Array.from(host.querySelectorAll('span')).find(node => node.firstChild?.textContent === 'Gongura Chicken Pickle')!;
    const row = label.parentElement!;
    const input = row.querySelector('input')!;
    expect(row.textContent).toContain('Out of stock');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '3');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => row.querySelector('button')!.click());
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({productId: 'pickle-gongura-chicken', stockCount: 3});
    expect(row.textContent).toContain('3 in stock');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});


it.each([
  ['sweet-bobbatlu', 'Bobbatlu'],
  ['sweet-kova-bobbatlu', 'Kova Bobbatlu'],
])('lets admin maintain %s pieces and shows the made-to-order fallback', async (productId, name) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => Response.json({
    stock: { [productId]: init?.method === 'PATCH' ? 32 : 0 },
  }));
  vi.stubGlobal('fetch', fetchMock);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(InventoryPanel)));
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="Stock count for ${name}"]`)!;
    const row = input.parentElement!;
    expect(row.textContent).toContain('Count individual pieces');
    expect(row.textContent).toContain('1-day preparation');
    expect(row.textContent).not.toContain('Out of stock');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '32');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => row.querySelector('button')!.click());
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({productId, stockCount: 32});
    expect(row.textContent).toContain('32 pieces ready');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('lists both assorted boxes under Box stock, counted in whole boxes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    stock: { 'sweet-assorted-box': 4, 'sweet-assorted-bobbatlu-box': 0, 'sweet-bobbatlu': 10 },
  })));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(InventoryPanel)));
    await act(async () => {});
    const section = host.querySelector('section[aria-labelledby="assorted-box-stock"]')!;
    expect(section.querySelector('h3')?.textContent).toBe('Box stock');
    const rows = Array.from(section.querySelectorAll('div.flex')).map((row) => row.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Count whole boxes (11 Malpuri + 11 Malai Khaja each).');
    expect(rows[0]).toContain('4 boxes in stock');
    expect(rows[1]).toContain('Assorted Bobbatlu Box — Bobbatlu & Kova Bobbatlu');
    expect(rows[1]).toContain('Count whole boxes (8 Bobbatlu + 8 Kova Bobbatlu each).');
    expect(rows[1]).toContain('Out of stock');
    expect(section.querySelector<HTMLInputElement>('input[aria-label="Stock count for Assorted Bobbatlu Box — Bobbatlu & Kova Bobbatlu"]')?.value).toBe('0');
    // Loose Bobbatlu stays in the main list, not under Box stock.
    expect(section.textContent).not.toContain('pieces ready');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
