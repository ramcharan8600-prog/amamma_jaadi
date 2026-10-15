// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Header from './Header';

const nav = vi.hoisted(() => ({ pathname: '/pickles' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children) }));
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => createElement('img', { alt: props.alt as string }) }));

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Header)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const LABELS = ['Sweets', 'Gift Packs', 'Pickles', 'Events'];

it('shows every link on phones without a menu button, and one row on wide screens', () => {
  const [wide, phone] = [...host.querySelectorAll('nav')];
  expect(wide.className).toContain('hidden lg:flex');
  expect(phone.className).toContain('lg:hidden');
  expect(phone.className).toContain('flex-wrap');
  for (const list of [wide, phone]) expect([...list.querySelectorAll('a')].map((a) => a.textContent)).toEqual(LABELS);
  expect(host.querySelector('button')).toBeNull();
  // About Us is in the footer, not the header.
  expect(host.querySelector('a[href="/about"]')).toBeNull();
});

it('marks the page the shopper is on', () => {
  const current = [...host.querySelectorAll('a[aria-current="page"]')].map((a) => a.textContent);
  expect(current).toEqual(['Pickles', 'Pickles']);
});
