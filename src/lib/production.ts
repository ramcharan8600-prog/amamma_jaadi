import { PRODUCTS } from '@/data/products';
import type { OrderItemRecord, Product } from '@/types';

/** The kitchen's sweets, in the order the production sheet lists them. */
export const PRODUCTION_SWEETS = ['Malpuri', 'Malai Khaja', 'Bobbatlu', 'Kova Bobbatlu', 'Kova'] as const;
export type ProductionSweet = typeof PRODUCTION_SWEETS[number];

/** Loose sweets sold by the piece (the Taste Pack is Bobbatlu). */
const LOOSE_SWEET: Record<string, ProductionSweet> = {
  'sweet-malpuri': 'Malpuri',
  'sweet-malai-khaja': 'Malai Khaja',
  'sweet-bobbatlu': 'Bobbatlu',
  'sweet-kova-bobbatlu': 'Kova Bobbatlu',
  'sweet-kova': 'Kova',
  'sweet-bobbatlu-taste-pack': 'Bobbatlu',
};

/** "8 Kova Bobbatlu", "12 pcs Guntur Malpuri", "• 11 Nellore Malai Khaja" (Kova Bobbatlu tried first). */
const CONTENTS = /(\d+)\s*(?:pcs\s+)?(?:Guntur |Nellore )?(Kova Bobbatlu|Malai Khaja|Malpuri|Bobbatlu|Kova)\b/g;

/** Units by product category (categories not in this catalog are simply never looked up). */
const UNITS: Record<string, [string, string] | undefined> = {
  pickles: ['jar', 'jars'],
  juices: ['can', 'cans'],
  cakes: ['slice', 'slices'],
  drinks: ['cup', 'cups'],
  'gift-boxes': ['box', 'boxes'],
};

/** A box's email contents line ("• 8 Bobbatlu"), not its tagline ("Made for your 8:8 Bobbatlu cravings"). */
function isContentsLine(detail: string): boolean {
  return detail.trim().startsWith('•') && piecesIn(detail).length > 0;
}

function piecesIn(text: string): Array<[ProductionSweet, number]> {
  return [...text.matchAll(CONTENTS)].map((m) => [m[2] as ProductionSweet, Number(m[1])]);
}

/** An order line's catalog product, and the contents chosen for a box ("Box (8 Malpuri + …)"). */
function lineProduct(name: string): { product?: Product; contents?: string } {
  const exact = PRODUCTS.find((p) => p.name === name);
  if (exact) return { product: exact };
  const boxed = PRODUCTS
    .filter((p) => name.startsWith(`${p.name} (`) && name.endsWith(')'))
    .sort((a, b) => b.name.length - a.name.length)[0];
  return boxed ? { product: boxed, contents: name.slice(boxed.name.length + 2, -1) } : {};
}

export interface ProductionSheet {
  /** Every sweet to make, in pieces, counting what goes inside boxes. */
  sweets: Array<{ sweet: ProductionSweet; pieces: number }>;
  /** Every distinct line to pack, with how many. */
  items: Array<{ label: string; count: number; unit: string }>;
}

/** What the kitchen makes and packs for a set of order lines. */
export function productionSheet(
  lines: ReadonlyArray<Pick<OrderItemRecord, 'product_name' | 'quantity' | 'selected_tier'>>,
): ProductionSheet {
  const pieces = new Map<ProductionSweet, number>();
  const items = new Map<string, { count: number; units: [string, string] }>();
  const addPieces = (found: Array<[ProductionSweet, number]>, times: number) => {
    for (const [sweet, n] of found) pieces.set(sweet, (pieces.get(sweet) ?? 0) + n * times);
  };

  for (const line of lines) {
    const quantity = Number(line.quantity) || 0;
    const tier = line.selected_tier ? Number(line.selected_tier) : null;
    const { product, contents } = lineProduct(line.product_name);
    let label = line.product_name;
    let units: [string, string] = ['item', 'items'];

    if (product && LOOSE_SWEET[product.id]) {
      if (tier) addPieces([[LOOSE_SWEET[product.id], tier]], quantity);
      label = tier ? `${product.name} (${tier} pcs)` : product.name;
      units = ['pack', 'packs'];
    } else if (product?.emailDetails?.some(isContentsLine)) {
      // Fixed assorted boxes list their contents for emails ("• 11 Guntur Malpuri").
      addPieces(product.emailDetails.filter(isContentsLine).flatMap(piecesIn), quantity);
      units = ['box', 'boxes'];
    } else if (contents) {
      addPieces(piecesIn(contents), quantity);
      units = ['box', 'boxes'];
    } else if (product) {
      units = UNITS[product.category] ?? units;
    } else {
      // A renamed or retired product: still count any sweets its name spells out.
      addPieces(piecesIn(line.product_name), quantity);
    }

    const entry = items.get(label) ?? { count: 0, units };
    entry.count += quantity;
    items.set(label, entry);
  }

  return {
    sweets: PRODUCTION_SWEETS.filter((sweet) => pieces.get(sweet)).map((sweet) => ({ sweet, pieces: pieces.get(sweet)! })),
    items: [...items].map(([label, { count, units }]) => ({ label, count, unit: count === 1 ? units[0] : units[1] }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}
