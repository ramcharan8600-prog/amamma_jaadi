import { describe, expect, it } from 'vitest';
import { getNearbyPickup } from './nearby-pickup';

describe('offline nearby pickup recommendations', () => {
  it.each([['75093', 'Plano'], ['75063', 'Irving'], ['75033', 'Frisco'], ['75056', 'Plano']])(
    'recommends the closest pickup area for %s', (zip, city) => {
      expect(getNearbyPickup('TX', zip)?.city).toBe(city);
    },
  );
  it.each(['77002', '78701', '79901', '99999', '', '750', '750930', '75093abcd'])(
    'does not suggest pickup for distant, unknown or invalid ZIP %s', zip => {
      expect(getNearbyPickup('TX', zip)).toBeNull();
    },
  );
  it('accepts ZIP+4 and rejects a non-Texas destination', () => {
    expect(getNearbyPickup('TX', '75093-1234')?.city).toBe('Plano');
    expect(getNearbyPickup('CA', '75093')).toBeNull();
  });
});
