import nearbyZips from '@/data/nearby-pickup-zips.json';
import { ACTIVE_PICKUP_LOCATIONS } from '@/data/products';

/** Offline 30-mile ZCTA lookup; see scripts/build-pickup-zips.py for provenance. */
export function getNearbyPickup(state: string, zip: string) {
  if (state.trim().toUpperCase() !== 'TX' || !/^\d{5}(-\d{4})?$/.test(zip.trim())) return null;
  const nearestZip = (nearbyZips as Record<string, string>)[zip.trim().slice(0, 5)];
  if (!nearestZip) return null;
  return ACTIVE_PICKUP_LOCATIONS.find(location => location.zip === nearestZip) ?? null;
}
