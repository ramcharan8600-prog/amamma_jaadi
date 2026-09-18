import { Truck } from 'lucide-react';

/**
 * Informational banner describing typical out-of-state transit times.
 * Presentation only (no client state), so it works in both server and client
 * components. The actual delivery fee is computed at checkout.
 */
export default function FreeShippingNotice({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-start gap-2.5 bg-brand-gold/10 border border-brand-gold/30 rounded-xl p-3.5 ${className}`}
    >
      <Truck size={18} className="text-brand-gold shrink-0 mt-0.5" />
      <p className="font-body text-sm text-brand-charcoal/80">
        <strong>Nationwide shipping:</strong> Pickle-only orders shipped outside Texas use
        Standard shipping. Out-of-state orders containing sweets use UPS 2nd Day Air from
        Dallas and typically arrive within 2 business days after dispatch. Delivery time may
        vary by destination, carrier conditions, and weather. Tracking details will be emailed
        when your order ships.
      </p>
    </div>
  );
}
