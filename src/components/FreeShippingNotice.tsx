import { Store, Truck } from 'lucide-react';
import { ACTIVE_PICKUP_LOCATIONS } from '@/data/products';

/** "Plano, Frisco & Irving" — the cities customers can currently pick up from. */
function pickupCities(): string {
  const cities = Array.from(new Set(ACTIVE_PICKUP_LOCATIONS.map((loc) => loc.city)));
  return cities.length > 1 ? `${cities.slice(0, -1).join(', ')} & ${cities.at(-1)}` : cities.join('');
}

/**
 * Two short delivery options shown above the gift boxes: shipping and pickup.
 * Presentation only (no client state), so it works in both server and client
 * components. The actual delivery fee is computed at checkout.
 */
export default function FreeShippingNotice({ className = '' }: { className?: string }) {
  const options = [
    { Icon: Truck, text: 'Nationwide Shipping in 2–3 Days' },
    { Icon: Store, text: `Pickup at ${pickupCities()} on your selected date` },
  ];
  return (
    <div
      className={`grid grid-cols-2 gap-4 bg-brand-gold/10 border border-brand-gold/30 rounded-xl p-5 ${className}`}
    >
      {options.map(({ Icon, text }) => (
        <div key={text} className="flex flex-col items-center text-center gap-2">
          <Icon size={40} strokeWidth={1.5} className="text-brand-gold" aria-hidden="true" />
          <p className="font-body text-sm font-semibold text-brand-charcoal/80">{text}</p>
        </div>
      ))}
    </div>
  );
}
