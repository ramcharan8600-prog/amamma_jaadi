import { Truck, type LucideProps } from 'lucide-react';
import { ACTIVE_PICKUP_LOCATIONS } from '@/data/products';

/** "Plano, Frisco & Irving" — the cities customers can currently pick up from. */
function pickupCities(): string {
  const cities = Array.from(new Set(ACTIVE_PICKUP_LOCATIONS.map((loc) => loc.city)));
  return cities.length > 1 ? `${cities.slice(0, -1).join(', ')} & ${cities.at(-1)}` : cities.join('');
}

/** A person carrying a box, drawn in the same outline style as the Lucide truck. */
function PickupIcon({ size = 24, strokeWidth = 2, className, ...props }: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <circle cx="8.5" cy="3.5" r="2" />
      <path d="M8.5 7 7.5 13.5" />
      <path d="M7.5 13.5 5 17.5H2.5" />
      <path d="M7.5 13.5 11 16l1 5" />
      <path d="M8.3 8.5 12 11.5h2.5" />
      <rect x="12.5" y="7" width="9" height="7.5" rx="1" />
      <path d="M12.5 9.5h9M17 7v2.5" />
    </svg>
  );
}

/**
 * Two short delivery options shown above the gift boxes: shipping and pickup.
 * Presentation only (no client state), so it works in both server and client
 * components. The actual delivery fee is computed at checkout.
 */
export default function FreeShippingNotice({ className = '' }: { className?: string }) {
  const options = [
    { Icon: Truck, lines: ['Nationwide Shipping in 2–3 Days'] },
    { Icon: PickupIcon, lines: [`Pickup at ${pickupCities()}`, 'on your selected date'] },
  ];
  return (
    <div className={`grid grid-cols-2 gap-4 ${className}`}>
      {options.map(({ Icon, lines }) => (
        <div
          key={lines[0]}
          className="flex flex-col items-center text-center gap-2 bg-brand-gold/10 border border-brand-gold/30 rounded-xl p-5"
        >
          <Icon size={40} strokeWidth={1.5} className="text-brand-gold" aria-hidden="true" />
          <p className="font-body text-sm font-semibold text-brand-charcoal/80">
            {lines.map((line) => <span key={line} className="block">{line}</span>)}
          </p>
        </div>
      ))}
    </div>
  );
}
