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
        <strong>Fast nationwide shipping:</strong> We usually select an expedited air service for
        out-of-state orders. Most packages arrive within 2–3 business days after dispatch. Delivery
        time may vary by destination, carrier conditions, and weather. Tracking details will be
        emailed when your order ships.
      </p>
    </div>
  );
}
