import { PRODUCTS } from '@/data/products';
import { getShippingZone } from '@/lib/pricing';
import { productionSheet } from '@/lib/production';
import type { OrderItemRecord } from '@/types';

/** Where a delivery order's label comes from: bought here through Shippo, or by hand on Pirate Ship. */
export type ShipRoute = 'shippo' | 'pirate_ship';

type Line = Pick<OrderItemRecord, 'product_name' | 'quantity' | 'selected_tier'>;

/** Sweets that go to far states by hand (Pirate Ship), not by Shippo UPS Ground. */
const HAND_SHIPPED_FAR_SWEETS = new Set(['Malpuri', 'Bobbatlu', 'Kova Bobbatlu', 'Kova']);
const PICKLE_NAMES = new Set(PRODUCTS.filter((p) => p.category === 'pickles').map((p) => p.name));
const MALAI_KHAJA = 'Nellore Malai Khaja';

/** Two-letter state from the saved address text ("Dallas, TX 75201"). */
export function stateFromAddress(address: string | null | undefined): string | null {
  const match = /,\s*([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\b/.exec(address ?? '');
  return match ? match[1].toUpperCase() : null;
}

/**
 * The owner's routing rules. Texas and nearby states → Shippo. Far states →
 * Pirate Ship when the order has Malpuri, Bobbatlu, Kova Bobbatlu or Kova
 * (loose or inside a box), or a Mini Party Box or Ultimate Assorted Edition;
 * otherwise (e.g. Malai Khaja only, pickles) → Shippo.
 */
export function autoShipRoute(state: string | null, items: ReadonlyArray<Line>): { route: ShipRoute; reason: string } {
  const zone = getShippingZone(state ?? '');
  if (zone !== 'far') {
    return { route: 'shippo', reason: zone === 'texas' ? 'Texas order' : 'Nearby state' };
  }
  if (items.some((i) => i.product_name.startsWith('Mini Party Box') || i.product_name.startsWith('Ultimate Assorted Edition'))) {
    return { route: 'pirate_ship', reason: 'Far state with a Mini Party Box or Ultimate Assorted Edition' };
  }
  const sweets = productionSheet(items).sweets.map((s) => s.sweet).filter((s) => HAND_SHIPPED_FAR_SWEETS.has(s));
  if (sweets.length > 0) {
    return { route: 'pirate_ship', reason: `Far state with ${sweets.join(', ')}` };
  }
  return { route: 'shippo', reason: 'Far state, UPS Ground is fine for these items' };
}

/** The route in force: the owner's override if set, else the rules. */
export function effectiveShipRoute(override: string | null | undefined, state: string | null, items: ReadonlyArray<Line>) {
  const auto = autoShipRoute(state, items);
  const route: ShipRoute = override === 'shippo' || override === 'pirate_ship' ? override : auto.route;
  return { route, auto, overridden: route !== auto.route || Boolean(override) };
}

/** Pickle-only orders use UPS Ground Saver (or Ground if not offered); Malai Khaja orders UPS Ground; everything else Ground and 2nd Day Air. */
export function isPickleOnly(items: ReadonlyArray<Line>): boolean {
  return items.length > 0 && items.every((i) => PICKLE_NAMES.has(i.product_name));
}

/** Malai Khaja ships UPS Ground in any state (owner, 2026-10-11): loose Malai Khaja, alone or with pickles. */
export function isMalaiKhajaGround(items: ReadonlyArray<Line>): boolean {
  return items.some((i) => i.product_name === MALAI_KHAJA)
    && items.every((i) => i.product_name === MALAI_KHAJA || PICKLE_NAMES.has(i.product_name));
}
