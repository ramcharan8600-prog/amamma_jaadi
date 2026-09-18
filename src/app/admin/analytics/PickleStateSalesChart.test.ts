// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PickleStateSalesChart from './PickleStateSalesChart';
import type { PickleStateSalesRow } from '@/lib/pickle-state-sales';

let host: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

const row = (stateCode: string, stateName: string, chicken: number, mutton = 0): PickleStateSalesRow => ({
  stateCode, stateName, jars: chicken + mutton,
  products: [
    { productId: 'pickle-chicken', productName: 'Chicken Pickle', jars: chicken },
    { productId: 'pickle-mutton', productName: 'Mutton Pickle', jars: mutton },
  ],
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(data: PickleStateSalesRow[], year = 2026) {
  await act(async () => root.render(createElement(PickleStateSalesChart, { data, year })));
}
function bars() {
  return [...host.querySelectorAll<HTMLButtonElement>('ul[aria-label="Pickle Jars Sold by State"] > li > button')];
}
async function selectProduct(value: string) {
  const select = host.querySelector('select')!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it('ranks states by individual jars, hides zero states and shows proportional horizontal bars', async () => {
  await render([row('MI', 'Michigan', 1, 4), row('CA', 'California', 0), row('TX', 'Texas', 7, 3)]);
  expect(bars().map(bar => bar.textContent)).toEqual(['Texas10', 'Michigan5']);
  expect(bars()[0].querySelector<HTMLElement>('[aria-hidden="true"] > span')?.style.width).toBe('100%');
  expect(bars()[1].querySelector<HTMLElement>('[aria-hidden="true"] > span')?.style.width).toBe('50%');
  expect(host.textContent).toContain('15 jars total');
  expect(host.textContent).toContain('July–December 2026');
  expect(host.textContent).toContain('Pickup counts under Texas');
  expect(host.querySelector('label')?.htmlFor).toBe(host.querySelector('select')?.id);
});

it('filters and reorders by product locally and retains the full breakdown for a selected state', async () => {
  await render([row('MI', 'Michigan', 1, 4), row('TX', 'Texas', 7, 3), row('OK', 'Oklahoma', 2)]);
  expect([...host.querySelectorAll('option')].map(option => option.textContent)).toEqual([
    'All Pickles', 'Chicken Pickle', 'Gongura Chicken Pickle', 'Mutton Pickle', 'Prawns Pickle',
  ]);
  await selectProduct('pickle-mutton');
  expect(bars().map(bar => bar.textContent)).toEqual(['Michigan4', 'Texas3']);
  expect(host.textContent).toContain('7 jars total');
  await act(async () => bars()[0].click());
  const details = host.querySelector('[role="region"]')!;
  expect(details.textContent).toContain('Michigan: 5 jars across all pickles');
  expect(details.textContent).toContain('Chicken Pickle1 jar');
  expect(details.textContent).toContain('Mutton Pickle4 jars');
  expect(details.textContent).toContain('Prawns Pickle0 jars');
  expect(bars()[0].getAttribute('aria-expanded')).toBe('true');
  expect(bars()[0].getAttribute('aria-controls')).toBe(details.id);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('shows the top ten first and supports showing all states, with an alphabetical tie break', async () => {
  const data = Array.from({ length: 12 }, (_, index) => row(`S${index}`, `State ${String(index).padStart(2, '0')}`, index + 1));
  data.push(row('AZ', 'Arizona', 12));
  await render(data);
  expect(bars()).toHaveLength(10);
  expect(bars()[0].textContent).toBe('Arizona12');
  expect(bars()[1].textContent).toBe('State 1112');
  let toggle = [...host.querySelectorAll('button')].find(button => button.textContent === 'Show all states (13)')!;
  await act(async () => toggle.click());
  expect(bars()).toHaveLength(13);
  toggle = [...host.querySelectorAll('button')].find(button => button.textContent === 'Show top 10 states')!;
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  await act(async () => toggle.click());
  expect(bars()).toHaveLength(10);
});

it('reveals state details on hover, keyboard focus, and tap without a network request', async () => {
  await render([row('TX', 'Texas', 8), row('MI', 'Michigan', 1)]);
  await act(async () => bars()[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(host.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Texas product breakdown');
  await act(async () => bars()[1].focus());
  expect(host.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Michigan product breakdown');
  await act(async () => bars()[0].click());
  expect(host.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Texas product breakdown');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('shows clear empty states for an empty year or an unsold product', async () => {
  await render([]);
  expect(host.querySelector('[role="status"]')?.textContent).toBe('No pickle jars sold in 2026 yet.');
  expect(bars()).toHaveLength(0);
  await render([row('TX', 'Texas', 5)]);
  await selectProduct('pickle-prawns');
  expect(host.querySelector('[role="status"]')?.textContent).toBe('No Prawns Pickle jars sold in 2026 yet.');
  expect(bars()).toHaveLength(0);
});

it('formats large and singular jar totals clearly', async () => {
  await render([row('TX', 'Texas', 1234)]);
  expect(bars()[0].textContent).toBe('Texas1,234');
  expect(bars()[0].getAttribute('aria-label')).toContain('1,234 jars');
  expect(host.textContent).toContain('1,234 jars total');
  await render([row('TX', 'Texas', 1)]);
  expect(host.textContent).toContain('1 jar total');
});

it('explains Unknown destinations without counting them as states, only when the filter includes them', async () => {
  await render([row('Unknown', 'Unknown', 12), row('TX', 'Texas', 0, 2)]);
  expect(host.textContent).toContain('14 jars total');
  expect(host.textContent).not.toContain('2 states');
  expect(host.textContent).toContain('Orders without a recognized delivery state are grouped as Unknown.');
  expect(bars()[0].textContent).toBe('Unknown12');
  await selectProduct('pickle-mutton');
  expect(host.textContent).toContain('2 jars total');
  expect(host.textContent).not.toContain('Orders without a recognized delivery state');
});

it('clears the selected breakdown and expansion when changing product or year', async () => {
  const data = Array.from({ length: 12 }, (_, index) => row(`S${index}`, `State ${index}`, index + 1, index + 1));
  await render(data);
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Show all states (12)')!.click());
  await act(async () => bars()[0].click());
  await selectProduct('pickle-mutton');
  expect(host.querySelector('[role="region"]')).toBeNull();
  expect(bars()).toHaveLength(10);
  await act(async () => bars()[0].click());
  await render(data, 2027);
  expect(host.querySelector('[role="region"]')).toBeNull();
  expect(host.querySelector('select')?.value).toBe('all');
  expect(bars()).toHaveLength(10);
  expect(host.textContent).toContain('January–December 2027');
});
