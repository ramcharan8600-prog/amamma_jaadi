'use client';

import { PHOTO_WIDTHS } from '../data/photo-widths';

/**
 * next/image loader (next.config.ts → images.loaderFile). Workers don't run Next's
 * image optimizer, so product photos are pre-built in several widths by
 * scripts/build-photos.mjs. For each width the browser asks for, this returns the
 * smallest pre-built copy at least that wide — never a blurrier one — or the full
 * original when nothing is wider. Other images (logo, icons) are served as they are.
 */
export default function photoLoader({ src, width }: { src: string; width: number; quality?: number }): string {
  const widths = PHOTO_WIDTHS[src];
  if (!widths) return src;
  const largest = widths[widths.length - 1];
  const pick = widths.find((w) => w >= width) ?? largest;
  return pick === largest ? src : src.replace(/\.webp$/, `-${pick}.webp`);
}
