import { expect, it } from 'vitest';
import { productionSheet } from './production';

const line = (product_name: string, quantity: number, selected_tier: number | null = null) =>
  ({ product_name, quantity, selected_tier, product_price: 0, line_total: 0 });

it('adds up every sweet in pieces, including what goes inside each kind of box', () => {
  const sheet = productionSheet([
    line('Guntur Malpuri', 2, 24),                                                    // 48 Malpuri
    line('Bobbatlu', 1, 10),                                                          // 10 Bobbatlu
    line('Bobbatlu Taste Pack', 1, 8),                                                // 8 Bobbatlu
    line('Kova', 1, 16),                                                              // 16 Kova
    line('Assorted Box — Malpuri & Malai Khaja', 1, 22),                              // 11 + 11
    line('Assorted Bobbatlu Box — Bobbatlu & Kova Bobbatlu', 1, 16),                  // 8 + 8
    line('Sweet Memories Gift Box (Texas Limited Edition) (Mix: 6 Malpuri + 6 Malai Khaja)', 2), // 12 + 12
    line('Sweet Memories Gift Box (Texas Limited Edition) (12 pcs Guntur Malpuri)', 1),          // 12 Malpuri
    line('Mini Combo Pack - #Delivery (Assorted: 8 Malpuri + 8 Malai Khaja)', 1),     // 8 + 8
    line('Mini Party Box (20 pcs Nellore Malai Khaja)', 1),                           // 20 Malai Khaja
    line('Ultimate Assorted Edition (16 Malpuri + 8 Kova Bobbatlu + 8 Kova)', 1, 32), // 16 + 8 + 8
  ]);
  expect(sheet.sweets).toEqual([
    { sweet: 'Malpuri', pieces: 48 + 11 + 12 + 12 + 8 + 16 },
    { sweet: 'Malai Khaja', pieces: 11 + 12 + 8 + 20 },
    { sweet: 'Bobbatlu', pieces: 10 + 8 + 8 },
    { sweet: 'Kova Bobbatlu', pieces: 8 + 8 },
    { sweet: 'Kova', pieces: 16 + 8 },
  ]);
});

it('lists what to pack with counts and the right units', () => {
  const sheet = productionSheet([
    line('Guntur Malpuri', 1, 16),
    line('Guntur Malpuri', 2, 16),
    line('Chicken Pickle', 1),
    line('Mutton Pickle', 2),
    line('Sweet Memories Gift Box (Texas Limited Edition) (Mix: 6 Malpuri + 6 Malai Khaja)', 2),
  ]);
  expect(sheet.items).toEqual([
    { label: 'Chicken Pickle', count: 1, unit: 'jar' },
    { label: 'Guntur Malpuri (16 pcs)', count: 3, unit: 'packs' },
    { label: 'Mutton Pickle', count: 2, unit: 'jars' },
    { label: 'Sweet Memories Gift Box (Texas Limited Edition) (Mix: 6 Malpuri + 6 Malai Khaja)', count: 2, unit: 'boxes' },
  ]);
  // Pickles are not sweets to make.
  expect(sheet.sweets).toEqual([{ sweet: 'Malpuri', pieces: 48 + 12 }, { sweet: 'Malai Khaja', pieces: 12 }]);
});

it('still counts a renamed or retired product from its name, and handles an empty day', () => {
  expect(productionSheet([line('Old Festival Box (10 Malpuri + 10 Kova)', 1)]).sweets)
    .toEqual([{ sweet: 'Malpuri', pieces: 10 }, { sweet: 'Kova', pieces: 10 }]);
  expect(productionSheet([])).toEqual({ sweets: [], items: [] });
});
