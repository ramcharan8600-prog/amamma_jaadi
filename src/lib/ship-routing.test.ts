import { expect, it } from 'vitest';
import { autoShipRoute, effectiveShipRoute, isMalaiKhajaGround, isPickleOnly, stateFromAddress } from './ship-routing';

const line = (product_name: string, quantity = 1, selected_tier: number | null = null) => ({ product_name, quantity, selected_tier });

it('reads the state from the saved address text', () => {
  expect(stateFromAddress('100 Main St\nDallas, TX 75201\nUSA')).toBe('TX');
  expect(stateFromAddress('1 Way\nNew York, ny 10001-1234')).toBe('NY');
  expect(stateFromAddress('no state here')).toBeNull();
});

it('sends Texas and nearby-state orders through Shippo', () => {
  expect(autoShipRoute('TX', [line('Guntur Malpuri', 1, 16)]).route).toBe('shippo');
  expect(autoShipRoute('OK', [line('Kova', 1, 16), line('Bobbatlu', 1, 10)]).route).toBe('shippo');
});

it('hand-ships far orders with Malpuri, Bobbatlu, Kova Bobbatlu or Kova (loose or boxed) on Pirate Ship', () => {
  for (const items of [
    [line('Guntur Malpuri', 1, 16)],
    [line('Kova', 1, 16)],
    [line('Assorted Box — Malpuri & Malai Khaja', 1, 22)],
    [line('Assorted Bobbatlu Box — Bobbatlu & Kova Bobbatlu', 1, 16)],
    [line('Nellore Malai Khaja', 1, 16), line('Bobbatlu', 1, 10)],
    [line('Mini Party Box (20 pcs Nellore Malai Khaja)')],
    [line('Ultimate Assorted Edition (24 Malai Khaja)', 1, 24)],
  ]) {
    expect(autoShipRoute('NY', items).route).toBe('pirate_ship');
  }
});

it('keeps far Malai Khaja-only and pickle orders on Shippo UPS Ground', () => {
  expect(autoShipRoute('CA', [line('Nellore Malai Khaja', 2, 25)]).route).toBe('shippo');
  expect(autoShipRoute('CA', [line('Chicken Pickle', 2), line('Nellore Malai Khaja', 1, 16)]).route).toBe('shippo');
});

it('lets the owner override the rules either way', () => {
  expect(effectiveShipRoute('pirate_ship', 'TX', [line('Guntur Malpuri', 1, 16)])).toMatchObject({ route: 'pirate_ship', overridden: true });
  expect(effectiveShipRoute('shippo', 'NY', [line('Guntur Malpuri', 1, 16)])).toMatchObject({ route: 'shippo', overridden: true });
  expect(effectiveShipRoute(null, 'NY', [line('Guntur Malpuri', 1, 16)])).toMatchObject({ route: 'pirate_ship', overridden: false });
});

it('knows pickle-only orders', () => {
  expect(isPickleOnly([line('Chicken Pickle'), line('Mutton Pickle')])).toBe(true);
  expect(isPickleOnly([line('Chicken Pickle'), line('Guntur Malpuri', 1, 16)])).toBe(false);
  expect(isPickleOnly([])).toBe(false);
});

it('knows Malai Khaja orders that ship UPS Ground in any state', () => {
  expect(isMalaiKhajaGround([line('Nellore Malai Khaja', 2, 16)])).toBe(true);
  expect(isMalaiKhajaGround([line('Nellore Malai Khaja', 1, 16), line('Chicken Pickle')])).toBe(true);
  expect(isMalaiKhajaGround([line('Nellore Malai Khaja', 1, 16), line('Guntur Malpuri', 1, 16)])).toBe(false);
  expect(isMalaiKhajaGround([line('Assorted Box — Malpuri & Malai Khaja', 1, 22)])).toBe(false);
  expect(isMalaiKhajaGround([line('Chicken Pickle')])).toBe(false);
  expect(isMalaiKhajaGround([])).toBe(false);
});
