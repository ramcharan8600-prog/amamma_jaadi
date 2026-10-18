import { expect, it } from 'vitest';
import photoLoader from './image-loader';

it('serves the smallest pre-built photo at least as wide as the screen needs, never a blurrier one', () => {
  const src = '/images/web/bobbatlu.webp'; // built at 480, 640, 960, 1280 and 1320 (full)
  expect(photoLoader({ src, width: 384 })).toBe('/images/web/bobbatlu-480.webp');
  expect(photoLoader({ src, width: 640 })).toBe('/images/web/bobbatlu-640.webp');
  expect(photoLoader({ src, width: 750 })).toBe('/images/web/bobbatlu-960.webp');
  expect(photoLoader({ src, width: 1200 })).toBe('/images/web/bobbatlu-1280.webp');
  expect(photoLoader({ src, width: 1300 })).toBe('/images/web/bobbatlu.webp');
  expect(photoLoader({ src, width: 3840 })).toBe('/images/web/bobbatlu.webp');
});

it('leaves other images alone', () => {
  expect(photoLoader({ src: '/images/web/logo-192.webp', width: 640 })).toBe('/images/web/logo-192.webp');
});
